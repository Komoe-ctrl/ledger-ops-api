import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { PrismaService } from "../database/prisma.service";
import { ApiRole } from "../database/prisma";
import { CreateApiKeyDto } from "./dto/create-api-key.dto";
import { generateApiKey, hashApiKey } from "./hash.util";

export type CreatedApiKey = {
  apiKey: { id: string; label: string; role: ApiRole; merchantId: string | null };
  /** En clair, une seule fois : jamais récupérable après ce retour. */
  rawKey: string;
};

@Injectable()
export class ApiKeysService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async create(dto: CreateApiKeyDto): Promise<CreatedApiKey> {
    const isMerchantRole = dto.role === ApiRole.MERCHANT;
    if (isMerchantRole && !dto.merchantId) {
      throw new BadRequestException("merchantId est obligatoire pour le rôle MERCHANT");
    }
    if (!isMerchantRole && dto.merchantId) {
      throw new BadRequestException(`merchantId n'a pas de sens pour le rôle ${dto.role}`);
    }

    const rawKey = generateApiKey();
    const apiKey = await this.prisma.client.apiKey.create({
      data: {
        label: dto.label,
        role: dto.role,
        hashedKey: hashApiKey(rawKey),
        merchantId: dto.merchantId ?? null,
      },
    });

    return {
      apiKey: { id: apiKey.id, label: apiKey.label, role: apiKey.role, merchantId: apiKey.merchantId },
      rawKey,
    };
  }

  /** Renvoie null si absente, révoquée, ou désactivée — jamais de distinction entre ces trois cas côté appelant. */
  async validate(rawKey: string) {
    return this.prisma.client.apiKey.findFirst({
      where: { hashedKey: hashApiKey(rawKey), isActive: true },
    });
  }

  async revoke(id: string): Promise<void> {
    await this.prisma.client.apiKey.update({
      where: { id },
      data: { isActive: false, revokedAt: new Date() },
    });
  }
}
