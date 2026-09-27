import { Body, Controller, Get, Inject, Param, Patch, Query } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiParam, ApiQuery, ApiTags } from "@nestjs/swagger";
import { ResolveReconciliationExceptionDto } from "./dto/resolve-reconciliation-exception.dto";
import { ReconciliationExceptionResponseDto } from "./dto/reconciliation-exception-response.dto";
import { ReconciliationService } from "./reconciliation.service";
import { toReconciliationExceptionResponse } from "./reconciliation.presenter";

/**
 * Interne pour l'instant (pas de garde RBAC — jalon 4), comme la
 * transition de statut. Voir ADR 0007 : un acquittement opérateur tardif
 * sur une transaction déjà EXPIRED atterrit ici plutôt que d'essayer une
 * transition EXPIRED -> SUCCEEDED (toujours fermée).
 */
@ApiTags("reconciliation")
@Controller("v1/reconciliation-exceptions")
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
  ): Promise<ReconciliationExceptionResponseDto> {
    const exception = await this.reconciliation.resolve(id, dto);
    return toReconciliationExceptionResponse(exception);
  }
}
