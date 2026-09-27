import { Prisma } from "../database/prisma";
import { ReconciliationExceptionResponseDto } from "./dto/reconciliation-exception-response.dto";

type ReconciliationExceptionWithTransaction = Prisma.ReconciliationExceptionGetPayload<{
  include: { transaction: { select: { reference: true } } };
}>;

export function toReconciliationExceptionResponse(
  exception: ReconciliationExceptionWithTransaction,
): ReconciliationExceptionResponseDto {
  return {
    id: exception.id,
    transactionReference: exception.transaction.reference,
    reportedStatus: exception.reportedStatus,
    providerReference: exception.providerReference,
    detectedAt: exception.detectedAt,
    resolvedAt: exception.resolvedAt,
    resolvedBy: exception.resolvedBy,
    resolution: exception.resolution,
  };
}
