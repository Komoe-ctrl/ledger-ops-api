import { Inject, Injectable, NotFoundException, PreconditionFailedException } from "@nestjs/common";
import { PrismaService } from "../database/prisma.service";
import { Prisma, withActor } from "../database/prisma";
import { ListTransactionsQueryDto } from "./dto/list-transactions.query.dto";
import { TransitionStatusDto } from "./dto/transition-status.dto";
import { decodeCursor, encodeCursor } from "./cursor.util";

@Injectable()
export class TransactionsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async list(query: ListTransactionsQueryDto) {
    const limit = query.limit ?? 20;
    const cursor = query.cursor ? decodeCursor(query.cursor) : null;

    const where: Prisma.TransactionWhereInput = {
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
    return withActor(
      this.prisma.client,
      { type: "SYSTEM", id: "api:transactions", ...(dto.reason ? { reason: dto.reason } : {}) },
      async (tx) => {
        const rows = await tx.$queryRaw<{ id: string; version: number }[]>`
          SELECT "id", "version" FROM "transactions" WHERE "reference" = ${reference} FOR UPDATE
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

        return tx.transaction.update({
          where: { id: row.id },
          data: { status: dto.status },
        });
      },
    );
  }
}
