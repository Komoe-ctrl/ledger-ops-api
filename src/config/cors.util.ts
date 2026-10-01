/**
 * Liste blanche configurable (CORS_ALLOWED_ORIGINS, séparée par des
 * virgules) — on ne connaît pas le domaine Vercel du front avant qu'il ne
 * soit lui-même déployé. Non configuré (dev local) : pas de restriction,
 * cohérent avec Swagger déjà public sans garde — restreindre par défaut
 * casserait le développement local du front sans bénéfice de sécurité réel
 * tant que l'API elle-même n'expose que des routes protégées par clé API.
 */
export function resolveCorsOrigins(raw: string | undefined): boolean | string[] {
  const trimmed = raw?.trim();
  if (!trimmed) {
    return true;
  }
  return trimmed
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}
