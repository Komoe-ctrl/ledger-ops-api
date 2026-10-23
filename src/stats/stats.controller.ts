import { Controller, Get, Inject, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { StatsResponseDto } from "./dto/stats-response.dto";
import { StatsService } from "./stats.service";
import { ApiKeyGuard } from "../auth/api-key.guard";
import { RolesGuard } from "../auth/roles.guard";
import { CurrentAuth } from "../auth/current-auth.decorator";
import { AuthContext } from "../auth/auth-context";
import { ApiRole } from "../database/prisma";

/**
 * Ouvert à toute clé valide, mais la portée dépend du rôle : un MERCHANT ne
 * voit que ses propres chiffres (même règle que GET /v1/transactions), les
 * autres rôles voient la plateforme entière.
 */
@ApiTags("stats")
@ApiBearerAuth()
@Controller("v1/stats")
@UseGuards(ApiKeyGuard, RolesGuard)
export class StatsController {
  constructor(@Inject(StatsService) private readonly stats: StatsService) {}

  @Get()
  @ApiOperation({
    summary: "Agrégats pour tableau de bord (comptages calculés en SQL)",
    description:
      "Volume, répartition par statut, exceptions de rapprochement ouvertes et date de chargement du jeu de démonstration. Portée MERCHANT : uniquement les transactions du marchand de la clé.",
  })
  @ApiOkResponse({ type: StatsResponseDto })
  async get(@CurrentAuth() auth: AuthContext): Promise<StatsResponseDto> {
    return this.stats.compute(auth.role === ApiRole.MERCHANT ? auth.merchantId! : undefined);
  }
}
