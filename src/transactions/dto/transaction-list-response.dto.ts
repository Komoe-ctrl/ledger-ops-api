import { ApiProperty } from "@nestjs/swagger";
import { TransactionResponseDto } from "./transaction-response.dto";

export class TransactionListResponseDto {
  @ApiProperty({ type: [TransactionResponseDto] })
  data!: TransactionResponseDto[];

  @ApiProperty({
    nullable: true,
    description: "Opaque — à repasser tel quel en ?cursor= pour la page suivante. null = dernière page.",
    example: null,
  })
  nextCursor!: string | null;
}
