import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { ApiRole } from "../../database/prisma";

export class CreatedApiKeyResponseDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty()
  label!: string;

  @ApiProperty({ enum: ApiRole })
  role!: ApiRole;

  @ApiPropertyOptional({ format: "uuid" })
  merchantId!: string | null;

  @ApiProperty({
    description: "Clé en clair — affichée UNE SEULE FOIS. Rien côté serveur ne permet de la retrouver ensuite.",
  })
  rawKey!: string;
}
