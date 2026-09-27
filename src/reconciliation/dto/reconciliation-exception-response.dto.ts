import { ApiProperty } from "@nestjs/swagger";
import { TransactionStatus } from "../../database/prisma";

export class ReconciliationExceptionResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ description: "Référence de la transaction concernée." })
  transactionReference!: string;

  @ApiProperty({ enum: TransactionStatus, description: "Ce que l'opérateur prétend." })
  reportedStatus!: TransactionStatus;

  @ApiProperty({ nullable: true })
  providerReference!: string | null;

  @ApiProperty()
  detectedAt!: Date;

  @ApiProperty({ nullable: true })
  resolvedAt!: Date | null;

  @ApiProperty({ nullable: true })
  resolvedBy!: string | null;

  @ApiProperty({ nullable: true })
  resolution!: string | null;
}
