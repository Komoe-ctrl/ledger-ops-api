import { ApiProperty } from "@nestjs/swagger";
import { Matches, MaxLength } from "class-validator";

export class CreateMerchantDto {
  /** Même format que les codes de compte comptable (schema.prisma, code ~ '^[a-z0-9_]+$'). */
  @ApiProperty({ example: "boutique-akwaba" })
  @Matches(/^[a-z0-9_]+$/, { message: "code doit être en minuscules, chiffres et underscores uniquement" })
  @MaxLength(50)
  code!: string;

  @ApiProperty({ example: "Boutique Akwaba" })
  @MaxLength(200)
  name!: string;
}
