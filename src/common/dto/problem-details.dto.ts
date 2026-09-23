import { ApiProperty } from "@nestjs/swagger";

/** Forme exacte de ProblemDetailsFilter — toutes les erreurs de l'API suivent ce contrat. */
export class ProblemDetailsDto {
  @ApiProperty({ example: "about:blank" })
  type!: string;

  @ApiProperty({ example: "Transition de statut interdite" })
  title!: string;

  @ApiProperty({ example: 409 })
  status!: number;

  @ApiProperty({ required: false, example: "Transition interdite pour TXN-...: SUCCEEDED -> PENDING" })
  detail?: string;

  @ApiProperty({ example: "/v1/transactions/TXN-.../status" })
  instance!: string;

  @ApiProperty({ required: false, description: "Code LX0xx, présent uniquement pour les erreurs d'origine base.", example: "LX005" })
  code?: string;
}
