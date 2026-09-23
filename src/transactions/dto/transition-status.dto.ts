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
}
