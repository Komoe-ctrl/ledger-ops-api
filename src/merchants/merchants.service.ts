import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../database/prisma.service";
import { AccountType } from "../database/prisma";
import { CreateMerchantDto } from "./dto/create-merchant.dto";
import { merchantPayableAccountCode } from "./merchant-account.util";

/** XOF pour l'instant, comme le reste du système — pas de multi-devise par marchand. */
const DEFAULT_CURRENCY = "XOF";

@Injectable()
export class MerchantsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * Crée le marchand ET son compte payable dans la même transaction SQL :
   * un marchand sans compte comptable ne devrait jamais pouvoir exister,
   * même un instant (sinon un paiement créé entre les deux échouerait au
   * moment de chercher un compte qui n'existe pas encore).
   */
  async create(dto: CreateMerchantDto) {
    return this.prisma.client.$transaction(async (tx) => {
      const merchant = await tx.merchant.create({
        data: { code: dto.code, name: dto.name },
      });

      await tx.ledgerAccount.create({
        data: {
          code: merchantPayableAccountCode(dto.code),
          name: `Dû au marchand ${dto.name}`,
          type: AccountType.LIABILITY,
          currency: DEFAULT_CURRENCY,
        },
      });

      return merchant;
    });
  }

  async findByCodeOrThrow(code: string) {
    const merchant = await this.prisma.client.merchant.findUnique({ where: { code } });
    if (!merchant) {
      throw new NotFoundException(`Marchand ${code} introuvable`);
    }
    return merchant;
  }
}
