import { HttpException, HttpStatus } from "@nestjs/common";

/**
 * Distincte d'un 409 générique de transition interdite (LX005) : celui-là
 * dit "tu as fait une erreur", celle-ci dit "le monde extérieur n'est pas
 * d'accord avec nos registres, et ce n'est plus une décision automatique"
 * — voir ADR 0007. On ne tente jamais EXPIRED -> SUCCEEDED, on capture le
 * désaccord pour qu'un analyste tranche.
 */
export class ReconciliationRequiredException extends HttpException {
  constructor(reference: string, exceptionId: string) {
    super(
      `Transaction ${reference} déjà EXPIRED : acquittement tardif capturé pour rapprochement manuel ` +
        `(exception ${exceptionId}, voir GET /v1/reconciliation-exceptions/${exceptionId})`,
      HttpStatus.CONFLICT,
    );
  }
}
