import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../database/prisma.service";
import { ReconciliationExceptionKind } from "../database/prisma";
import { ResolveReconciliationExceptionDto } from "./dto/resolve-reconciliation-exception.dto";

const INCLUDE_TRANSACTION_REFERENCE = { transaction: { select: { reference: true } } } as const;

/** Tout sauf LATE_ACKNOWLEDGMENT, réservé au chemin automatique de TransactionsService.transition() (ADR 0007). */
type DiscrepancyKind = Exclude<ReconciliationExceptionKind, "LATE_ACKNOWLEDGMENT">;

export type ReportDiscrepancyInput = {
  kind: DiscrepancyKind;
  /** Obligatoire sauf pour MISSING_LOCALLY (par définition, aucune transaction locale ne correspond). */
  transactionId?: string;
  providerReference?: string;
  detail: string;
};

@Injectable()
export class ReconciliationService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async list(onlyUnresolved: boolean) {
    return this.prisma.client.reconciliationException.findMany({
      where: onlyUnresolved ? { resolvedAt: null } : {},
      include: INCLUDE_TRANSACTION_REFERENCE,
      orderBy: { detectedAt: "desc" },
    });
  }

  async findByIdOrThrow(id: string) {
    const exception = await this.prisma.client.reconciliationException.findUnique({
      where: { id },
      include: INCLUDE_TRANSACTION_REFERENCE,
    });
    if (!exception) {
      throw new NotFoundException(`Exception de rapprochement ${id} introuvable`);
    }
    return exception;
  }

  /**
   * Pas de withActor : cette table n'alimente pas transaction_status_history
   * et n'a pas besoin d'acteur déclaré au sens des triggers sur `transactions`
   * — resolvedBy EST l'acteur, porté par la ligne elle-même. Le trigger
   * `fn_reconciliation_exceptions_before_update` refuse toute seconde
   * résolution (LX006) : le contrôle explicite ci-dessous donne un message
   * clair plutôt que de laisser remonter l'erreur base brute.
   */
  async resolve(id: string, dto: ResolveReconciliationExceptionDto, resolvedBy: string) {
    const exception = await this.findByIdOrThrow(id);
    if (exception.resolvedAt) {
      throw new ConflictException(`Exception de rapprochement ${id} déjà résolue`);
    }

    return this.prisma.client.reconciliationException.update({
      where: { id },
      data: {
        resolvedAt: new Date(),
        resolvedBy,
        resolution: dto.resolution,
      },
      include: INCLUDE_TRANSACTION_REFERENCE,
    });
  }

  /**
   * Écart avec un relevé opérateur, hors acquittement tardif (ADR 0008).
   * Volontairement minimal : pas de modèle "relevé opérateur", pas de moteur
   * de diff, pas d'import — juste le type d'exception, à appeler quand un
   * écart est constaté par ailleurs (aujourd'hui : le seed de démo ; demain,
   * potentiellement un vrai rapprochement — hors périmètre ici).
   */
  async reportDiscrepancy(input: ReportDiscrepancyInput) {
    const isMissingLocally = input.kind === ReconciliationExceptionKind.MISSING_LOCALLY;
    if (isMissingLocally && input.transactionId) {
      throw new BadRequestException(
        "transactionId n'a pas de sens pour MISSING_LOCALLY : par définition, aucune transaction locale ne correspond",
      );
    }
    if (!isMissingLocally && !input.transactionId) {
      throw new BadRequestException(`transactionId est obligatoire pour ${input.kind}`);
    }

    return this.prisma.client.reconciliationException.create({
      data: {
        kind: input.kind,
        transactionId: input.transactionId ?? null,
        providerReference: input.providerReference ?? null,
        detail: input.detail,
      },
      include: INCLUDE_TRANSACTION_REFERENCE,
    });
  }
}
