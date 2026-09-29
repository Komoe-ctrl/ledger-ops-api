import { ApiProperty } from "@nestjs/swagger";
import { ReconciliationExceptionKind, TransactionStatus } from "../../database/prisma";

export class ReconciliationExceptionResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: ReconciliationExceptionKind })
  kind!: ReconciliationExceptionKind;

  @ApiProperty({
    nullable: true,
    description: "Référence de la transaction concernée. Absente seulement pour MISSING_LOCALLY.",
  })
  transactionReference!: string | null;

  @ApiProperty({ enum: TransactionStatus, nullable: true, description: "Ce que l'opérateur prétend — seulement pour LATE_ACKNOWLEDGMENT." })
  reportedStatus!: TransactionStatus | null;

  @ApiProperty({ nullable: true })
  providerReference!: string | null;

  @ApiProperty({ nullable: true, description: "Description libre de l'écart — seulement pour les types autres que LATE_ACKNOWLEDGMENT." })
  detail!: string | null;

  @ApiProperty()
  detectedAt!: Date;

  @ApiProperty({ nullable: true })
  resolvedAt!: Date | null;

  @ApiProperty({ nullable: true })
  resolvedBy!: string | null;

  @ApiProperty({ nullable: true })
  resolution!: string | null;
}
