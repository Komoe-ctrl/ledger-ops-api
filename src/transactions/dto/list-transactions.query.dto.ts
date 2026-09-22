import { Type } from "class-transformer";
import { IsEnum, IsInt, IsISO8601, IsOptional, IsString, Max, Min } from "class-validator";
import { Provider, TransactionStatus } from "../../database/prisma";

export class ListTransactionsQueryDto {
  @IsOptional()
  @IsEnum(TransactionStatus)
  status?: TransactionStatus;

  @IsOptional()
  @IsEnum(Provider)
  provider?: Provider;

  /** Borne inférieure sur createdAt, incluse (ISO 8601). */
  @IsOptional()
  @IsISO8601()
  dateFrom?: string;

  /** Borne supérieure sur createdAt, incluse (ISO 8601). */
  @IsOptional()
  @IsISO8601()
  dateTo?: string;

  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}
