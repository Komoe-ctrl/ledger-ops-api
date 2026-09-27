import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../database/prisma.service";
import { ResolveReconciliationExceptionDto } from "./dto/resolve-reconciliation-exception.dto";

const INCLUDE_TRANSACTION_REFERENCE = { transaction: { select: { reference: true } } } as const;

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
  async resolve(id: string, dto: ResolveReconciliationExceptionDto) {
    const exception = await this.findByIdOrThrow(id);
    if (exception.resolvedAt) {
      throw new ConflictException(`Exception de rapprochement ${id} déjà résolue`);
    }

    return this.prisma.client.reconciliationException.update({
      where: { id },
      data: {
        resolvedAt: new Date(),
        resolvedBy: dto.resolvedBy,
        resolution: dto.resolution,
      },
      include: INCLUDE_TRANSACTION_REFERENCE,
    });
  }
}
