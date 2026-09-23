import { ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsEnum, IsInt, IsISO8601, IsOptional, IsString, Max, Min } from "class-validator";
import { Provider, TransactionStatus } from "../../database/prisma";

export class ListTransactionsQueryDto {
  @ApiPropertyOptional({ enum: TransactionStatus })
  @IsOptional()
  @IsEnum(TransactionStatus)
  status?: TransactionStatus;

  @ApiPropertyOptional({ enum: Provider })
  @IsOptional()
  @IsEnum(Provider)
  provider?: Provider;

  /** Borne inférieure sur createdAt, incluse (ISO 8601). */
  @ApiPropertyOptional({ description: "Borne inférieure sur createdAt, incluse.", example: "2026-09-01T00:00:00Z" })
  @IsOptional()
  @IsISO8601()
  dateFrom?: string;

  /** Borne supérieure sur createdAt, incluse (ISO 8601). */
  @ApiPropertyOptional({ description: "Borne supérieure sur createdAt, incluse.", example: "2026-09-30T23:59:59Z" })
  @IsOptional()
  @IsISO8601()
  dateTo?: string;

  @ApiPropertyOptional({ description: "Opaque, renvoyé par la page précédente (nextCursor)." })
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}
