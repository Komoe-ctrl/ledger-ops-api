import { BadRequestException } from "@nestjs/common";

/**
 * Pagination par curseur (keyset), pas par OFFSET : un OFFSET recompte les
 * lignes à chaque page — sous écritures concurrentes, ça saute ou répète
 * des lignes selon ce qui a été inséré/modifié entre deux appels. Le
 * curseur, lui, dit "continue strictement après ce point précis", ce qui
 * reste correct quoi qu'il se passe ailleurs dans la table pendant qu'on
 * pagine.
 *
 * Tri : (createdAt DESC, id DESC). `createdAt` seul ne suffit pas comme
 * clé de tri stable — deux lignes peuvent partager le même horodatage à la
 * milliseconde près ; `id` (UUID) sert uniquement de départage arbitraire
 * mais total, pas à être lu comme une donnée métier.
 */
export type TransactionCursor = { createdAt: string; id: string };

export function encodeCursor(cursor: TransactionCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeCursor(raw: string): TransactionCursor {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as TransactionCursor).createdAt === "string" &&
      typeof (parsed as TransactionCursor).id === "string"
    ) {
      return parsed as TransactionCursor;
    }
    throw new Error("forme de curseur inattendue");
  } catch {
    throw new BadRequestException("cursor invalide");
  }
}
