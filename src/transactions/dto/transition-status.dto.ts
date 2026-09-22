import { IsEnum, IsOptional, IsString, MaxLength } from "class-validator";
import { TransactionStatus } from "../../database/prisma";

export class TransitionStatusDto {
  @IsEnum(TransactionStatus)
  status!: TransactionStatus;

  /** Devient app.reason (lu par le trigger d'historique) ; jamais une colonne métier. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
