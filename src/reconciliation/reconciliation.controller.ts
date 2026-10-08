import { Body, Controller, Get, Inject, Param, Patch, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiQuery, ApiTags } from "@nestjs/swagger";
import { ResolveReconciliationExceptionDto } from "./dto/resolve-reconciliation-exception.dto";
import { ReconciliationExceptionResponseDto } from "./dto/reconciliation-exception-response.dto";
import { ReconciliationService } from "./reconciliation.service";
import { toReconciliationExceptionResponse } from "./reconciliation.presenter";
import { ApiKeyGuard } from "../auth/api-key.guard";
import { RolesGuard } from "../auth/roles.guard";
import { Roles } from "../auth/roles.decorator";
import { CurrentAuth } from "../auth/current-auth.decorator";
import { AuthContext } from "../auth/auth-context";
import { ApiRole } from "../database/prisma";

/**
 * Réservé aux analystes/admins. Voir ADR 0007 : un acquittement opérateur
 * tardif sur une transaction déjà EXPIRED atterrit ici plutôt que d'essayer
 * une transition EXPIRED -> SUCCEEDED (toujours fermée).
 */
@ApiTags("reconciliation")
@ApiBearerAuth()
@Controller("v1/reconciliation-exceptions")
@UseGuards(ApiKeyGuard, RolesGuard)
@Roles(ApiRole.ANALYST, ApiRole.ADMIN)
export class ReconciliationController {
  constructor(@Inject(ReconciliationService) private readonly reconciliation: ReconciliationService) {}

  @Get()
  @ApiOperation({ summary: "Lister les exceptions de rapprochement" })
  @ApiQuery({ name: "onlyUnresolved", required: false, type: Boolean })
  @ApiOkResponse({ type: [ReconciliationExceptionResponseDto] })
  async list(@Query("onlyUnresolved") onlyUnresolved?: string): Promise<ReconciliationExceptionResponseDto[]> {
    const exceptions = await this.reconciliation.list(onlyUnresolved === "true");
    return exceptions.map(toReconciliationExceptionResponse);
  }

  @Get(":id")
  @ApiOperation({ summary: "Lire une exception de rapprochement" })
  @ApiOkResponse({ type: ReconciliationExceptionResponseDto })
  async getOne(@Param("id") id: string): Promise<ReconciliationExceptionResponseDto> {
    const exception = await this.reconciliation.findByIdOrThrow(id);
    return toReconciliationExceptionResponse(exception);
  }

  @Patch(":id/resolve")
  @ApiOperation({
    summary: "Résoudre une exception de rapprochement",
    description: "Justification obligatoire. Ne peut être fait qu'une seule fois — le trigger base (LX006) l'impose.",
  })
  @ApiParam({ name: "id" })
  @ApiOkResponse({ type: ReconciliationExceptionResponseDto })
  async resolve(
    @Param("id") id: string,
    @Body() dto: ResolveReconciliationExceptionDto,
    @CurrentAuth() auth: AuthContext,
  ): Promise<ReconciliationExceptionResponseDto> {
    const exception = await this.reconciliation.resolve(id, dto, auth.apiKeyId);
    return toReconciliationExceptionResponse(exception);
  }
}
