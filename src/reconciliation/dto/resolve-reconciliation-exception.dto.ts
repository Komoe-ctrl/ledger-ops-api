import { ApiProperty } from "@nestjs/swagger";
import { IsString, Matches, MaxLength } from "class-validator";

export class ResolveReconciliationExceptionDto {
  /**
   * Justification obligatoire — jamais vide (au moins un caractère non
   * blanc, comme le CHECK en base : échec propre en 400 plutôt qu'un 500
   * brut sur la contrainte Postgres).
   */
  @ApiProperty({ example: "Confirmé côté opérateur (rapport OM du 24/09), booké manuellement en correction." })
  @IsString()
  @MaxLength(2000)
  @Matches(/\S/, { message: "resolution ne peut pas être vide" })
  resolution!: string;
}
