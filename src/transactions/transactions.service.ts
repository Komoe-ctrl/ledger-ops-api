import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../database/prisma.service";
import { Prisma } from "../database/prisma";
import { ListTransactionsQueryDto } from "./dto/list-transactions.query.dto";
import { decodeCursor, encodeCursor } from "./cursor.util";

@Injectable()
export class TransactionsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async list(query: ListTransactionsQueryDto) {
    const limit = query.limit ?? 20;
    const cursor = query.cursor ? decodeCursor(query.cursor) : null;

    const where: Prisma.TransactionWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.provider ? { provider: query.provider } : {}),
      ...(query.dateFrom || query.dateTo
        ? {
            createdAt: {
              ...(query.dateFrom ? { gte: new Date(query.dateFrom) } : {}),
              ...(query.dateTo ? { lte: new Date(query.dateTo) } : {}),
            },
          }
        : {}),
      // Keyset : continue strictement après (cursor.createdAt, cursor.id),
      // dans l'ordre de tri (createdAt DESC, id DESC).
      ...(cursor
        ? {
            OR: [
              { createdAt: { lt: new Date(cursor.createdAt) } },
              { createdAt: new Date(cursor.createdAt), id: { lt: cursor.id } },
            ],
          }
        : {}),
    };

    // On demande une ligne de plus que la page : si elle existe, il y a une
    // page suivante, et elle ne fait pas partie de la page rendue.
    const rows = await this.prisma.client.transaction.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page.at(-1);
    const nextCursor = hasMore && last ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id }) : null;

    return { data: page, nextCursor };
  }

  async findByReferenceOrThrow(reference: string) {
    const transaction = await this.prisma.client.transaction.findUnique({ where: { reference } });
    if (!transaction) {
      throw new NotFoundException(`Transaction ${reference} introuvable`);
    }
    return transaction;
  }

  async history(reference: string) {
    const transaction = await this.findByReferenceOrThrow(reference);
    return this.prisma.client.transactionStatusHistory.findMany({
      where: { transactionId: transaction.id },
      orderBy: { createdAt: "asc" },
    });
  }
}
