import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import type { Request } from "express";
import { ApiKeysService } from "./api-keys.service";
import { AuthenticatedRequest } from "./auth-context";

const BEARER_PREFIX = "Bearer ";

/**
 * Authentification, pas autorisation : établit QUI appelle (rôle,
 * marchand), ne décide pas ce que ce rôle a le droit de faire — ça,
 * c'est RolesGuard, appliqué APRÈS (l'ordre dans @UseGuards compte,
 * RolesGuard lit request.auth que celui-ci vient de poser).
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(@Inject(ApiKeysService) private readonly apiKeys: ApiKeysService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & AuthenticatedRequest>();
    const header = request.headers.authorization;

    if (!header || !header.startsWith(BEARER_PREFIX)) {
      throw new UnauthorizedException("En-tête Authorization: Bearer <clé> obligatoire");
    }

    const rawKey = header.slice(BEARER_PREFIX.length);
    const apiKey = await this.apiKeys.validate(rawKey);
    if (!apiKey) {
      // Un seul message pour "absente", "révoquée" et "désactivée" : ne
      // jamais donner à un appelant non authentifié un moyen de distinguer
      // ces cas (ça révélerait si une clé donnée a existé).
      throw new UnauthorizedException("Clé API invalide, révoquée ou désactivée");
    }

    request.auth = {
      apiKeyId: apiKey.id,
      role: apiKey.role,
      merchantId: apiKey.merchantId,
    };
    return true;
  }
}
