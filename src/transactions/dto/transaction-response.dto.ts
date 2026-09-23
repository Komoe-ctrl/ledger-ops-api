import { ApiProperty } from "@nestjs/swagger";
import { Provider, TransactionStatus, TransactionType } from "../../database/prisma";

/**
 * Forme de réponse HTTP, pas le modèle Prisma : classe dédiée (plutôt que
 * documenter le type inféré de `toTransactionResponse`) parce que Swagger
 * ne peut générer un schéma exploitable par un générateur de types front
 * qu'à partir d'une classe décorée, pas d'un objet brut retourné au runtime.
 */
export class TransactionResponseDto {
  @ApiProperty({ example: "TXN-20260922-8F3K2Q" })
  reference!: string;

  @ApiProperty({ enum: TransactionType })
  type!: TransactionType;

  @ApiProperty({ enum: TransactionStatus })
  status!: TransactionStatus;

  @ApiProperty({ enum: Provider })
  provider!: Provider;

  @ApiProperty({
    description: "Montant en unité mineure, en chaîne (jamais un number JSON — voir ADR 0002).",
    example: "10000",
  })
  amount!: string;

  @ApiProperty({ example: "XOF" })
  currency!: string;

  @ApiProperty({ example: "+2250700000000" })
  customerMsisdn!: string;

  @ApiProperty({ description: "Cumul des remboursements réussis, en chaîne.", example: "0" })
  refundedAmount!: string;

  @ApiProperty({ description: "Verrouillage optimiste — à renvoyer dans If-Match pour une transition.", example: 1 })
  version!: number;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}
