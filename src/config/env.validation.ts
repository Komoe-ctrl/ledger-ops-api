import { plainToInstance } from "class-transformer";
import { IsIn, IsInt, IsOptional, IsString, IsUrl, Matches, Max, Min, validateSync } from "class-validator";

/** base64url, 43 caractères minimum — même forme que generateApiKey() (32 octets d'aléa, sans padding). */
const API_KEY_FORMAT = /^[A-Za-z0-9_-]{43,}$/;

/**
 * Contrat des variables d'environnement attendues par l'API.
 * Seule APP_DATABASE_URL est une dépendance dure au démarrage de
 * l'application elle-même. REDIS_URL n'est requis que si
 * PROVIDER_SIMULATOR_ENABLED=true (voir ConditionalModule dans
 * app.module.ts — sinon Redis n'est jamais sollicité, donc jamais requis).
 */
class EnvironmentVariables {
  /**
   * Rôle propriétaire : jamais lu par le code applicatif (voir PrismaService,
   * qui n'utilise que APP_DATABASE_URL), seulement par la CLI Prisma
   * (prisma.config.ts, validé indépendamment par elle) au moment des
   * migrations. Optionnel ICI à dessein : en déploiement, le service web qui
   * tourne en continu ne doit même pas avoir cette variable dans son
   * environnement (voir docs/DEPLOIEMENT.md) — la rendre obligatoire au
   * bootstrap de l'app la forcerait à exister partout, y compris là où on
   * veut spécifiquement qu'elle soit absente.
   */
  @IsOptional()
  @IsUrl({ protocols: ["postgresql", "postgres"], require_tld: false, require_protocol: true })
  DATABASE_URL?: string;

  /**
   * Rôle applicatif à privilèges minimaux (migration least_privilege_app_role,
   * ADR 0003) : c'est CETTE variable que PrismaService utilise au runtime,
   * jamais DATABASE_URL — un bug ou une injection SQL ne doit pas pouvoir,
   * par exemple, UPDATE une ligne de grand livre, même si les triggers LX001
   * le bloquent déjà (deuxième ligne de défense indépendante du code).
   */
  @IsUrl({ protocols: ["postgresql", "postgres"], require_tld: false, require_protocol: true })
  APP_DATABASE_URL!: string;

  /**
   * Borne le pool `pg` sous-jacent (voir docs/DEPLOIEMENT.md) — une base
   * Postgres managée gratuite tolère peu de connexions simultanées. 5 par
   * défaut si absent (voir createPrismaClient).
   */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  DATABASE_POOL_MAX?: number;

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

  /**
   * Activé par défaut (voir app.module.ts) : à mettre à "false" seulement
   * dans un contexte qui pilote expireOverduePending() lui-même (tests e2e,
   * scripts one-shot) et ne veut pas du vrai cron en concurrence.
   */
  @IsOptional()
  @IsIn(["true", "false"])
  EXPIRATION_CRON_ENABLED?: string;

  /** Liste d'origines séparées par des virgules (voir resolveCorsOrigins). Non configuré = pas de restriction. */
  @IsOptional()
  @IsString()
  CORS_ALLOWED_ORIGINS?: string;

  /**
   * Valeur fixe optionnelle pour les clés API de démo (scripts/seed-demo.ts)
   * — des clés stables d'une remise à zéro nocturne à l'autre, pour que le
   * README et le front n'aient pas une clé invalide chaque matin. Non
   * défini = comportement précédent (clé aléatoire, révoquée puis réémise
   * à chaque exécution).
   */
  @IsOptional()
  @Matches(API_KEY_FORMAT, { message: "DEMO_MERCHANT_API_KEY doit être au format base64url, 43 caractères minimum" })
  DEMO_MERCHANT_API_KEY?: string;

  /** Voir DEMO_MERCHANT_API_KEY — doit être différente de celle-ci (vérifié par le seed, pas ici : dépend d'un autre champ). */
  @IsOptional()
  @Matches(API_KEY_FORMAT, { message: "DEMO_ANALYST_API_KEY doit être au format base64url, 43 caractères minimum" })
  DEMO_ANALYST_API_KEY?: string;
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
