import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsEnum, IsOptional, IsUUID, MaxLength } from "class-validator";
import { ApiRole } from "../../database/prisma";

export class CreateApiKeyDto {
  @ApiProperty({ example: "Boutique Akwaba — clé de production" })
  @MaxLength(200)
  label!: string;

  @ApiProperty({ enum: ApiRole })
  @IsEnum(ApiRole)
  role!: ApiRole;

  /** Obligatoire si role=MERCHANT, refusé sinon — vérifié par ApiKeysService (pas ici : dépend d'un autre champ). */
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  merchantId?: string;
}
