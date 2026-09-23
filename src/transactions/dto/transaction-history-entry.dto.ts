import { ApiProperty } from "@nestjs/swagger";
import { ActorType, TransactionStatus } from "../../database/prisma";

export class TransactionHistoryEntryDto {
  @ApiProperty({ enum: TransactionStatus, nullable: true })
  fromStatus!: TransactionStatus | null;

  @ApiProperty({ enum: TransactionStatus })
  toStatus!: TransactionStatus;

  @ApiProperty({ enum: ActorType })
  actorType!: ActorType;

  @ApiProperty({ nullable: true, example: "api:transactions" })
  actorId!: string | null;

  @ApiProperty({ nullable: true, example: "ack opérateur" })
  reason!: string | null;

  @ApiProperty()
  createdAt!: Date;
}
