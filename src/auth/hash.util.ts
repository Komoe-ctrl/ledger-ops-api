import { createHash, randomBytes } from "node:crypto";

/**
 * SHA-256, pas bcrypt/argon2 : ces algorithmes lents existent pour résister
 * au brute-force sur un FAIBLE espace de valeurs (les mots de passe humains
 * se ressemblent, se devinent, se réutilisent). Une clé API générée ici a
 * 256 bits d'aléa dès la naissance — l'espace de recherche est déjà
 * astronomique, un hachage rapide ne l'affaiblit pas.
 */
export function generateApiKey(): string {
  return randomBytes(32).toString("base64url");
}

export function hashApiKey(rawKey: string): string {
  return createHash("sha256").update(rawKey).digest("hex");
}
