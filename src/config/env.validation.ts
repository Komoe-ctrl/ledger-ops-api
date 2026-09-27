import { plainToInstance } from "class-transformer";
import { IsIn, IsInt, IsOptional, IsUrl, Max, Min, validateSync } from "class-validator";

/**
 * Contrat des variables d'environnement attendues par l'API.
 * Seul DATABASE_URL est obligatoire : c'est la seule dépendance dure au
 * démarrage. REDIS_URL n'est requis que si PROVIDER_SIMULATOR_ENABLED=true
 * (voir ConditionalModule dans app.module.ts — sinon Redis n'est jamais
 * sollicité, donc jamais requis).
 */
class EnvironmentVariables {
  @IsUrl({ protocols: ["postgresql", "postgres"], require_tld: false, require_protocol: true })
  DATABASE_URL!: string;

  @IsOptional()
  @IsUrl({ protocols: ["redis"], require_tld: false, require_protocol: true })
  REDIS_URL?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  PORT?: number;

  /**
   * Un push USSD réel expire plutôt entre 2 et 5 min selon l'opérateur ;
   * voir docs/adr/0007-acquittement-tardif.md.
   */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1440)
  PAYMENT_EXPIRY_MINUTES_DEFAULT?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1440)
  PAYMENT_EXPIRY_MINUTES_ORANGE_MONEY?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1440)
  PAYMENT_EXPIRY_MINUTES_MTN_MOMO?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1440)
  PAYMENT_EXPIRY_MINUTES_WAVE?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1440)
  PAYMENT_EXPIRY_MINUTES_MOOV_MONEY?: number;

  /**
   * Désactivé par défaut — jamais activé pendant les tests e2e, qui pilotent
   * les transitions à la main et deviendraient imprévisibles si le
   * simulateur transitionnait en même temps en arrière-plan.
   */
  @IsOptional()
  @IsIn(["true", "false"])
  PROVIDER_SIMULATOR_ENABLED?: string;

  /** Probabilité (0-100) qu'un règlement simulé se conclue en FAILED plutôt que SUCCEEDED. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  PROVIDER_SIMULATOR_FAILURE_RATE?: number;
}

/**
 * Appelée par ConfigModule.forRoot() pendant le bootstrap, AVANT que
 * l'application ne se mette à écouter. Si elle lève, Nest arrête le
 * démarrage : c'est ce qui rend l'échec "fail-fast" plutôt qu'une erreur
 * au premier appel à PrismaService.
 */
export function validate(config: Record<string, unknown>): EnvironmentVariables {
  const validatedConfig = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });

  const errors = validateSync(validatedConfig, { skipMissingProperties: false });

  if (errors.length > 0) {
    const details = errors
      .map((error) => Object.values(error.constraints ?? {}).join(", "))
      .join("\n  - ");
    throw new Error(`Variables d'environnement invalides :\n  - ${details}`);
  }

  return validatedConfig;
}
