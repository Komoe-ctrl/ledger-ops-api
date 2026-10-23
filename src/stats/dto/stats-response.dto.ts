import { ApiProperty } from "@nestjs/swagger";
import { TransactionStatus } from "../../database/prisma";

export class StatusCountDto {
  @ApiProperty({ enum: TransactionStatus, enumName: "TransactionStatus" })
  status!: TransactionStatus;

  @ApiProperty({ type: Number, example: 42 })
  count!: number;
}

export class PaymentStatsDto {
  @ApiProperty({ type: Number, example: 70 })
  total!: number;

  @ApiProperty({
    type: [StatusCountDto],
    description: "Paiements seulement (hors remboursements) ; tous les statuts sont présents, à 0 si vide.",
  })
  byStatus!: StatusCountDto[];
}

export class StatsResponseDto {
  @ApiProperty({
    enum: ["GLOBAL", "MERCHANT"],
    description: "GLOBAL : toute la plateforme. MERCHANT : uniquement les transactions du marchand de la clé.",
  })
  scope!: "GLOBAL" | "MERCHANT";

  @ApiProperty({ type: Number, example: 72, description: "Nombre de transactions (paiements et remboursements)." })
  totalTransactions!: number;

  @ApiProperty({
    type: [StatusCountDto],
    description: "Répartition de toutes les transactions par statut ; tous les statuts sont présents, à 0 si vide.",
  })
  byStatus!: StatusCountDto[];

  @ApiProperty({ type: PaymentStatsDto, description: "Mêmes comptages, restreints aux paiements (base du taux de réussite)." })
  payments!: PaymentStatsDto;

  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      "Exceptions de rapprochement non résolues. null pour un MERCHANT : le rapprochement est réservé aux rôles ANALYST/OPERATOR/ADMIN.",
  })
  openReconciliationExceptions!: number | null;

  @ApiProperty({
    type: String,
    format: "date-time",
    nullable: true,
    description: "Dernier chargement enregistré du jeu de démonstration (registre demo_dataset_loads). null si jamais chargé.",
  })
  demoDatasetLoadedAt!: string | null;
}
