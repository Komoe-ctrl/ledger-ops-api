import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsEnum, IsOptional, IsString, MaxLength } from "class-validator";
import { TransactionStatus } from "../../database/prisma";

export class TransitionStatusDto {
  @ApiProperty({ enum: TransactionStatus })
  @IsEnum(TransactionStatus)
  status!: TransactionStatus;

  /** Devient app.reason (lu par le trigger d'historique) ; jamais une colonne métier. */
  @ApiPropertyOptional({ maxLength: 500, example: "ack opérateur" })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;

  /**
   * Référence opérateur accompagnant l'acquittement. Utile même quand la
   * transition échoue (ex. acquittement tardif sur une transaction déjà
   * EXPIRED — voir ADR 0007) : c'est ce qui va dans l'exception de
   * rapprochement, pour que l'analyste sache à quoi ça correspond côté opérateur.
   */
  @ApiPropertyOptional({ maxLength: 100, example: "OM-998877" })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  providerReference?: string;
}
