import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { ApiRole } from "../database/prisma";
import { AuthenticatedRequest } from "./auth-context";
import { ROLES_KEY } from "./roles.decorator";

/**
 * Suppose que ApiKeyGuard a déjà tourné et posé `request.auth` — l'ordre
 * dans @UseGuards() n'est pas arbitraire : ApiKeyGuard doit toujours
 * précéder RolesGuard.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<ApiRole[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request & AuthenticatedRequest>();
    if (!request.auth || !required.includes(request.auth.role)) {
      throw new ForbiddenException(`Rôle requis : ${required.join(" ou ")}`);
    }
    return true;
  }
}
