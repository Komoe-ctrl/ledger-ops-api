import { SetMetadata } from "@nestjs/common";
import { ApiRole } from "../database/prisma";

export const ROLES_KEY = "roles";

/** Posé sur une route/un contrôleur ; lu par RolesGuard. Aucun rôle = accessible à toute clé valide. */
export const Roles = (...roles: ApiRole[]) => SetMetadata(ROLES_KEY, roles);
