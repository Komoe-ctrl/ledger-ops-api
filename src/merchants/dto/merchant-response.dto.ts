import { ApiProperty } from "@nestjs/swagger";

export class MerchantResponseDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty({ example: "boutique-akwaba" })
  code!: string;

  @ApiProperty({ example: "Boutique Akwaba" })
  name!: string;

  @ApiProperty()
  isActive!: boolean;

  @ApiProperty()
  createdAt!: Date;
}
