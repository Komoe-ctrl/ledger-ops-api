import { ApiRole } from "../database/prisma";

/** Posé sur `request.auth` par ApiKeyGuard ; lu par RolesGuard et les contrôleurs. */
export type AuthContext = {
  apiKeyId: string;
  role: ApiRole;
  /** Seulement pour le rôle MERCHANT — borne l'accès à ce marchand. */
  merchantId: string | null;
};

export type AuthenticatedRequest = { auth?: AuthContext };
