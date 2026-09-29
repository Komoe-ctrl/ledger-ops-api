import { Inject, Injectable, NotFoundException, PreconditionFailedException } from "@nestjs/common";
import { Clock } from "../common/clock";
import { PrismaService } from "../database/prisma.service";
import { Prisma, TransactionStatus, TransactionType, withActor } from "../database/prisma";
import { ListTransactionsQueryDto } from "./dto/list-transactions.query.dto";
import { TransitionStatusDto } from "./dto/transition-status.dto";
import { decodeCursor, encodeCursor } from "./cursor.util";
import { bookPaymentSuccess } from "./payment-success-booking";
import { bookRefundSuccess } from "./refund-success-booking";
import { bookDisputeReversal } from "./dispute-reversal-booking";
import { ReconciliationRequiredException } from "./reconciliation-required.exception";

@Injectable()
export class TransactionsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(Clock) private readonly clock: Clock,
  ) {}

  async list(query: ListTransactionsQueryDto, merchantId?: string) {
    const limit = query.limit ?? 20;
    const cursor = query.cursor ? decodeCursor(query.cursor) : null;

    const where: Prisma.TransactionWhereInput = {
      ...(merchantId ? { merchantId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.provider ? { provider: query.provider } : {}),
      ...(query.dateFrom || query.dateTo
        ? {
            createdAt: {
              ...(query.dateFrom ? { gte: new Date(query.dateFrom) } : {}),
              ...(query.dateTo ? { lte: new Date(query.dateTo) } : {}),
            },
          }
        : {}),
      // Keyset : continue strictement après (cursor.createdAt, cursor.id),
      // dans l'ordre de tri (createdAt DESC, id DESC).
      ...(cursor
        ? {
            OR: [
              { createdAt: { lt: new Date(cursor.createdAt) } },
              { createdAt: new Date(cursor.createdAt), id: { lt: cursor.id } },
            ],
          }
        : {}),
    };

    // On demande une ligne de plus que la page : si elle existe, il y a une
    // page suivante, et elle ne fait pas partie de la page rendue.
    const rows = await this.prisma.client.transaction.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page.at(-1);
    const nextCursor = hasMore && last ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id }) : null;

    return { data: page, nextCursor };
  }

  async findByReferenceOrThrow(reference: string) {
    const transaction = await this.prisma.client.transaction.findUnique({ where: { reference } });
    if (!transaction) {
      throw new NotFoundException(`Transaction ${reference} introuvable`);
    }
    return transaction;
  }

  async history(reference: string) {
    const transaction = await this.findByReferenceOrThrow(reference);
    return this.prisma.client.transactionStatusHistory.findMany({
      where: { transactionId: transaction.id },
      orderBy: { createdAt: "asc" },
    });
  }

  /**
   * Transition de statut interne. Deux protections différentes, pas
   * redondantes :
   * - `SELECT ... FOR UPDATE` (verrou pessimiste) : dans CETTE transaction
   *   SQL, personne d'autre ne peut lire/modifier la même ligne tant qu'on
   *   n'a pas fini. Sans ça, deux requêtes concurrentes pourraient toutes
   *   les deux lire version=3, valider leur If-Match contre 3, et l'une des
   *   deux écraserait la décision de l'autre sans le savoir.
   * - Comparaison à `expectedVersion` (verrouillage optimiste, ETag/If-Match) :
   *   protège contre un CLIENT dont la vue est déjà périmée (il a lu la
   *   transaction à la version 3, quelqu'un d'autre l'a fait passer à 5
   *   entre-temps). Le trigger `fn_transactions_before_update` incrémente
   *   `version` quoi qu'on envoie — il ne fait PAS ce contrôle : c'est
   *   uniquement une garantie applicative, pas une garantie base.
   */
  async transition(reference: string, dto: TransitionStatusDto, expectedVersion: number) {
    // Lever ReconciliationRequiredException DEPUIS l'intérieur de withActor
    // annulerait la transaction SQL entière — y compris la création de
    // l'exception qu'on veut justement garder. On renvoie donc un résultat
    // "marqué" depuis la transaction (qui, elle, doit committer normalement),
    // et on lève l'erreur HTTP APRÈS, une fois le commit fait.
    const outcome = await withActor(
      this.prisma.client,
      { type: "SYSTEM", id: "api:transactions", ...(dto.reason ? { reason: dto.reason } : {}) },
      async (tx) => {
        const rows = await tx.$queryRaw<
          { id: string; version: number; status: TransactionStatus; type: TransactionType }[]
        >`
          SELECT "id", "version", "status", "type" FROM "transactions" WHERE "reference" = ${reference} FOR UPDATE
        `;
        const row = rows[0];
        if (!row) {
          throw new NotFoundException(`Transaction ${reference} introuvable`);
        }
        if (row.version !== expectedVersion) {
          throw new PreconditionFailedException(
            `If-Match périmé : version attendue ${expectedVersion}, version actuelle ${row.version}`,
          );
        }

        // Acquittement tardif (ADR 0007) : l'opérateur confirme après notre
        // délai. EXPIRED reste un cul-de-sac — jamais EXPIRED -> SUCCEEDED,
        // même ici — mais le désaccord (l'opérateur a de l'argent chez lui
        // pour cette transaction, nous non) doit être capturé pour qu'un
        // analyste tranche, pas juste rejeté silencieusement en LX005.
        if (row.status === TransactionStatus.EXPIRED && dto.status === TransactionStatus.SUCCEEDED) {
          const exception = await tx.reconciliationException.create({
            data: {
              transactionId: row.id,
              reportedStatus: dto.status,
              providerReference: dto.providerReference ?? null,
            },
          });
          return { kind: "reconciliation" as const, exceptionId: exception.id };
        }

        let updated = await tx.transaction.update({
          where: { id: row.id },
          data: { status: dto.status },
        });

        // Écriture comptable uniquement au passage PENDING -> SUCCEEDED :
        // c'est le seul moment où l'argent bouge réellement, que ce soit un
        // paiement (ADR 0004) ou un remboursement (ADR 0005). Un futur
        // DISPUTED -> SUCCEEDED (litige gagné) ne doit PAS rebooker les
        // mêmes fonds — d'où la garde sur le statut de DÉPART (`row.status`,
        // lu par le SELECT FOR UPDATE avant la mise à jour).
        if (dto.status === TransactionStatus.SUCCEEDED && row.status === TransactionStatus.PENDING) {
          if (row.type === TransactionType.PAYMENT) {
            await bookPaymentSuccess(tx, updated);
          } else {
            await bookRefundSuccess(tx, updated);
          }
        }

        // Litige perdu (ADR 0006) : reprend le reste dû au marchand. Litige
        // gagné (DISPUTED -> SUCCEEDED / -> PARTIALLY_REFUNDED) ne passe pas
        // ici : c'est déjà couvert par la garde ci-dessus (row.status doit
        // être PENDING, jamais DISPUTED, pour la branche SUCCEEDED).
        if (dto.status === TransactionStatus.REVERSED && row.status === TransactionStatus.DISPUTED) {
          // bookDisputeReversal met à jour refunded_amount sur CETTE même
          // ligne : il faut réutiliser son retour, pas l'`updated` d'avant,
          // sous peine de renvoyer au client un refundedAmount/version périmés
          // (constaté en testant — la réponse HTTP mentait, la base était juste).
          updated = await bookDisputeReversal(tx, updated);
        }

        return { kind: "updated" as const, transaction: updated };
      },
    );

    if (outcome.kind === "reconciliation") {
      throw new ReconciliationRequiredException(reference, outcome.exceptionId);
    }
    return outcome.transaction;
  }

  /**
   * Borné en petits paquets, chacun sa propre transaction courte — jamais
   * un seul UPDATE non borné sur tout ce qui est en retard. Sans ça, un
   * cron qui n'aurait pas tourné pendant un moment (déploiement gelé, bug)
   * pourrait se retrouver à verrouiller des dizaines de milliers de lignes
   * d'un coup, bloquant tout accès concurrent à ces transactions le temps
   * que ça tourne, et perdant tout le travail si ça échoue à mi-parcours.
   *
   * `FOR UPDATE SKIP LOCKED` : si deux exécutions de ce job se chevauchent
   * (deux instances de l'API, ou un déclenchement manuel qui recoupe le
   * cron), la seconde ne bloque pas sur les lignes que la première a déjà
   * prises — elle saute et prend ce qui reste libre. Sûr sous exécution
   * concurrente sans coordination explicite entre les deux.
   */
  private static readonly EXPIRATION_BATCH_SIZE = 200;

  async expireOverduePending(): Promise<number> {
    let total = 0;
    let expiredInBatch: number;
    do {
      expiredInBatch = await this.expireOneBatch();
      total += expiredInBatch;
    } while (expiredInBatch > 0);
    return total;
  }

  private async expireOneBatch(): Promise<number> {
    return withActor(
      this.prisma.client,
      { type: "SYSTEM", id: "expiration-job", reason: "Expiration automatique (délai dépassé)" },
      async (tx) => {
        // this.clock.now(), pas le now() SQL de Postgres : "maintenant" doit
        // être la même notion partout dans l'app, et substituable en test —
        // contrairement à created_at (toujours l'heure réelle du serveur,
        // imposée par fn_transactions_before_insert), rien n'exige que
        // "l'instant présent du point de vue du balayage" le soit aussi.
        const rows = await tx.$queryRaw<{ id: string }[]>`
          SELECT "id" FROM "transactions"
          WHERE "status" = 'PENDING' AND "expires_at" < ${this.clock.now()}
          ORDER BY "expires_at"
          LIMIT ${TransactionsService.EXPIRATION_BATCH_SIZE}
          FOR UPDATE SKIP LOCKED
        `;
        if (rows.length === 0) {
          return 0;
        }

        await tx.transaction.updateMany({
          where: { id: { in: rows.map((r) => r.id) } },
          data: { status: TransactionStatus.EXPIRED },
        });

        return rows.length;
      },
    );
  }
}
