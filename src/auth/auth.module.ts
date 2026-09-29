import { Global, Module } from "@nestjs/common";
import { ApiKeysController } from "./api-keys.controller";
import { ApiKeysService } from "./api-keys.service";
import { ApiKeyGuard } from "./api-key.guard";
import { RolesGuard } from "./roles.guard";

// @Global() : ApiKeyGuard/RolesGuard sont posés route par route (@UseGuards)
// dans des contrôleurs qui n'ont pas à importer ce module pour ça.
@Global()
@Module({
  controllers: [ApiKeysController],
  providers: [ApiKeysService, ApiKeyGuard, RolesGuard],
  exports: [ApiKeysService, ApiKeyGuard, RolesGuard],
})
export class AuthModule {}
