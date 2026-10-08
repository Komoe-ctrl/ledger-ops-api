import { Body, Controller, HttpCode, Inject, Param, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiCreatedResponse, ApiOperation, ApiParam, ApiTags } from "@nestjs/swagger";
import { CreateApiKeyDto } from "./dto/create-api-key.dto";
import { CreatedApiKeyResponseDto } from "./dto/created-api-key-response.dto";
import { ApiKeysService } from "./api-keys.service";
import { ApiKeyGuard } from "./api-key.guard";
import { RolesGuard } from "./roles.guard";
import { Roles } from "./roles.decorator";
import { ApiRole } from "../database/prisma";

@ApiTags("api-keys")
@ApiBearerAuth()
@Controller("v1/api-keys")
@UseGuards(ApiKeyGuard, RolesGuard)
@Roles(ApiRole.ADMIN)
export class ApiKeysController {
  constructor(@Inject(ApiKeysService) private readonly apiKeys: ApiKeysService) {}

  @Post()
  @HttpCode(201)
  @ApiOperation({
    summary: "Émettre une clé API (admin)",
    description: "La clé en clair n'est renvoyée qu'ici, une seule fois. Réservé à ADMIN.",
  })
  @ApiCreatedResponse({ type: CreatedApiKeyResponseDto })
  async create(@Body() dto: CreateApiKeyDto): Promise<CreatedApiKeyResponseDto> {
    const { apiKey, rawKey } = await this.apiKeys.create(dto);
    return { ...apiKey, rawKey };
  }

  @Post(":id/revoke")
  @HttpCode(204)
  @ApiOperation({
    summary: "Révoquer une clé API (admin)",
    description: "Irréversible — une clé révoquée ne peut jamais être réactivée (LX006 en base). Réservé à ADMIN.",
  })
  @ApiParam({ name: "id", format: "uuid" })
  async revoke(@Param("id") id: string): Promise<void> {
    await this.apiKeys.revoke(id);
  }
}
