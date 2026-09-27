import { Global, Module } from "@nestjs/common";
import { ApiKeysService } from "./api-keys.service";
import { ApiKeyGuard } from "./api-key.guard";
import { RolesGuard } from "./roles.guard";

// @Global() : ApiKeyGuard/RolesGuard seront posés route par route (@UseGuards,
// étape 4) dans des contrôleurs qui n'ont pas à importer ce module pour ça.
@Global()
@Module({
  providers: [ApiKeysService, ApiKeyGuard, RolesGuard],
  exports: [ApiKeysService, ApiKeyGuard, RolesGuard],
})
export class AuthModule {}
