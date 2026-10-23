import { ApiProperty } from "@nestjs/swagger";
import { ActorType, EntryDirection, TransactionStatus, TransactionType } from "../../database/prisma";
import { TransactionResponseDto } from "./transaction-response.dto";

/** Un changement de statut de la transaction OU d'un de ses remboursements (voir `transactionReference`). */
export class AuditTimelineEventDto {
  @ApiProperty({ type: String, description: "Transaction concernée : la transaction elle-même ou l'un de ses remboursements." })
  transactionReference!: string;

  @ApiProperty({ enum: TransactionType, enumName: "TransactionType" })
  transactionType!: TransactionType;

  @ApiProperty({ enum: TransactionStatus, enumName: "TransactionStatus", nullable: true })
  fromStatus!: TransactionStatus | null;

  @ApiProperty({ enum: TransactionStatus, enumName: "TransactionStatus" })
  toStatus!: TransactionStatus;

  @ApiProperty({ enum: ActorType, enumName: "ActorType" })
  actorType!: ActorType;

  @ApiProperty({ type: String, nullable: true })
  actorId!: string | null;

  @ApiProperty({ type: String, nullable: true, description: "Motif du changement, quand il existe." })
  reason!: string | null;

  @ApiProperty({ type: String, format: "date-time" })
  createdAt!: Date;
}

export class AuditPostingDto {
  @ApiProperty({ type: String, example: "provider:wave:clearing" })
  accountCode!: string;

  @ApiProperty({ type: String, example: "Créance Wave" })
  accountName!: string;

  @ApiProperty({ enum: EntryDirection, enumName: "EntryDirection" })
  direction!: EntryDirection;

  @ApiProperty({ type: String, example: "10000", description: "Unité mineure, en chaîne (ADR 0002)." })
  amount!: string;

  @ApiProperty({ type: String, example: "XOF" })
  currency!: string;
}

export class AuditJournalEntryDto {
  @ApiProperty({ type: String })
  id!: string;

  @ApiProperty({ type: String, example: "Paiement réussi TXN-20260922-8F3K2Q" })
  description!: string;

  @ApiProperty({ type: String, description: "Transaction à laquelle l'écriture est rattachée (elle-même ou un remboursement)." })
  transactionReference!: string;

  @ApiProperty({ type: String, format: "date-time" })
  createdAt!: Date;

  @ApiProperty({ type: [AuditPostingDto], description: "Débits d'abord, puis crédits." })
  postings!: AuditPostingDto[];

  @ApiProperty({ type: String, example: "10000", description: "Somme des débits, calculée par PostgreSQL." })
  totalDebit!: string;

  @ApiProperty({ type: String, example: "10000", description: "Somme des crédits, calculée par PostgreSQL." })
  totalCredit!: string;

  @ApiProperty({ type: Boolean, description: "totalDebit = totalCredit, évalué par PostgreSQL (partie double, ADR 0001)." })
  balanced!: boolean;
}

export class AuditRefundDto {
  @ApiProperty({ type: String })
  reference!: string;

  @ApiProperty({ enum: TransactionStatus, enumName: "TransactionStatus" })
  status!: TransactionStatus;

  @ApiProperty({ type: String, example: "4000" })
  amount!: string;

  @ApiProperty({ type: String, example: "XOF" })
  currency!: string;

  @ApiProperty({ type: String, format: "date-time" })
  createdAt!: Date;
}

export class TransactionAuditResponseDto {
  @ApiProperty({ type: TransactionResponseDto })
  transaction!: TransactionResponseDto;

  @ApiProperty({ type: String, nullable: true, description: "Pour un remboursement : le paiement remboursé." })
  parentReference!: string | null;

  @ApiProperty({ type: [AuditRefundDto], description: "Remboursements de ce paiement (vide pour un remboursement)." })
  refunds!: AuditRefundDto[];

  @ApiProperty({
    type: [AuditTimelineEventDto],
    description: "Changements de statut de la transaction et de ses remboursements, du plus ancien au plus récent (litige compris : DISPUTED, REVERSED).",
  })
  timeline!: AuditTimelineEventDto[];

  @ApiProperty({
    type: [AuditJournalEntryDto],
    nullable: true,
    description: "Écritures comptables de la transaction et de ses remboursements. null pour un MERCHANT : le plan comptable interne n'est pas exposé aux marchands.",
  })
  entries!: AuditJournalEntryDto[] | null;
}
