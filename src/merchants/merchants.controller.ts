import { Body, Controller, HttpCode, Inject, Post, UseGuards } from "@nestjs/common";
import { ApiCreatedResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { CreateMerchantDto } from "./dto/create-merchant.dto";
import { MerchantResponseDto } from "./dto/merchant-response.dto";
import { MerchantsService } from "./merchants.service";
import { ApiKeyGuard } from "../auth/api-key.guard";
import { RolesGuard } from "../auth/roles.guard";
import { Roles } from "../auth/roles.decorator";
import { ApiRole } from "../database/prisma";

@ApiTags("merchants")
@Controller("v1/merchants")
@UseGuards(ApiKeyGuard, RolesGuard)
@Roles(ApiRole.ADMIN)
export class MerchantsController {
  constructor(@Inject(MerchantsService) private readonly merchants: MerchantsService) {}

  @Post()
  @HttpCode(201)
  @ApiOperation({
    summary: "Créer un marchand (admin)",
    description: "Crée le marchand et son compte comptable payable dans la même transaction. Réservé à ADMIN.",
  })
  @ApiCreatedResponse({ type: MerchantResponseDto })
  async create(@Body() dto: CreateMerchantDto): Promise<MerchantResponseDto> {
    return this.merchants.create(dto);
  }
}
