import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import { AuthenticatedRequest } from "./auth-context";

/**
 * Suppose ApiKeyGuard déjà passé (request.auth posé) — n'a de sens que sur
 * une route qui porte @UseGuards(ApiKeyGuard, ...).
 */
export const CurrentAuth = createParamDecorator((_: unknown, ctx: ExecutionContext) => {
  const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
  return request.auth!;
});
