import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional, IsString, Matches, MaxLength } from "class-validator";

export class CreateRefundDto {
  /** Même contrainte que le montant d'un paiement (ADR 0002) : chaîne, jamais un number. */
  @ApiProperty({
    description: "Montant à rembourser, en unité mineure, en chaîne. Doit être <= reste remboursable.",
    example: "4000",
  })
  @Matches(/^[1-9][0-9]*$/, {
    message: "amount doit être un entier positif, en unité mineure, sans zéro initial (ex. \"4000\")",
  })
  amount!: string;

  @ApiPropertyOptional({ maxLength: 500, example: "Produit défectueux" })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
