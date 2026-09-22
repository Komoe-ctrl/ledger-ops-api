import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from "@nestjs/common";
import type { Request, Response } from "express";
import { extractLedgerErrorCode, extractLedgerErrorMessage, LedgerErrorCode } from "../../database/prisma";

/**
 * Deux familles de codes LX0xx, deux traitements différents :
 *
 * - Invariants INTERNES (LX001-004, 006-008) : l'application n'a normalement
 *   aucun chemin qui puisse les déclencher — s'ils apparaissent, c'est un
 *   bug côté API, pas une requête client illégitime. 500, détail masqué
 *   (on ne décrit pas notre bug au client), logué côté serveur.
 * - Conflits d'ÉTAT atteignables par une requête légitime (LX005 transition
 *   interdite, LX009 compte inactif, LX010 règle métier) : le client PEUT
 *   provoquer ça en agissant sur une ressource dont l'état a changé sous
 *   lui, ou en enfreignant une règle métier connue. 409, détail exposé —
 *   c'est une information utile, pas une fuite d'interne.
 */
const LX_ERROR_MAP: Record<LedgerErrorCode, { status: number; title: string }> = {
  [LedgerErrorCode.APPEND_ONLY]: { status: 500, title: "Violation d'invariant interne (ajout seul)" },
  [LedgerErrorCode.UNBALANCED_ENTRY]: { status: 500, title: "Violation d'invariant interne (écriture déséquilibrée)" },
  [LedgerErrorCode.CURRENCY_MISMATCH]: { status: 500, title: "Violation d'invariant interne (devise incohérente)" },
  [LedgerErrorCode.SEALED_ENTRY]: { status: 500, title: "Violation d'invariant interne (écriture scellée)" },
  [LedgerErrorCode.INVALID_TRANSITION]: { status: 409, title: "Transition de statut interdite" },
  [LedgerErrorCode.FROZEN_FIELD]: { status: 500, title: "Violation d'invariant interne (champ figé)" },
  [LedgerErrorCode.MISSING_ACTOR]: { status: 500, title: "Violation d'invariant interne (acteur manquant)" },
  [LedgerErrorCode.INVALID_REVERSAL]: {
    status: 500,
    title: "Violation d'invariant interne (contre-écriture non conforme)",
  },
  [LedgerErrorCode.INACTIVE_ACCOUNT]: { status: 409, title: "Compte comptable inactif" },
  [LedgerErrorCode.BUSINESS_RULE]: { status: 409, title: "Règle métier violée" },
};

type ProblemDetails = {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance: string;
  code?: string;
};

/** RFC 9457 (Problem Details for HTTP APIs) : un seul format d'erreur pour toute l'API. */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemDetailsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const problem = this.toProblem(exception, request.originalUrl ?? request.url);

    response
      .status(problem.status)
      .setHeader("Content-Type", "application/problem+json")
      .send(JSON.stringify(problem));
  }

  private toProblem(exception: unknown, instance: string): ProblemDetails {
    const ledgerCode = extractLedgerErrorCode(exception);
    if (ledgerCode) {
      return this.fromLedgerError(ledgerCode, exception, instance);
    }

    if (exception instanceof HttpException) {
      return this.fromHttpException(exception, instance);
    }

    this.logger.error(exception instanceof Error ? (exception.stack ?? exception.message) : String(exception));
    return {
      type: "about:blank",
      title: "Internal Server Error",
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      instance,
    };
  }

  private fromLedgerError(code: LedgerErrorCode, exception: unknown, instance: string): ProblemDetails {
    const mapped = LX_ERROR_MAP[code];
    const isInternal = mapped.status >= 500;

    if (isInternal) {
      this.logger.error(`[${code}] ${extractLedgerErrorMessage(exception) ?? String(exception)}`);
    }

    // Un LX0xx "conflit d'état" est sûr à exposer : c'est le contenu même
    // de l'erreur métier (ex. "Transition interdite pour TXN-...: SUCCEEDED
    // -> PENDING"), pas un détail d'implémentation.
    const detail = isInternal ? null : extractLedgerErrorMessage(exception);

    return {
      type: `https://ledger-ops.internal/errors/${code.toLowerCase()}`,
      title: mapped.title,
      status: mapped.status,
      ...(detail ? { detail } : {}),
      instance,
      code,
    };
  }

  private fromHttpException(exception: HttpException, instance: string): ProblemDetails {
    const status = exception.getStatus();
    const body = exception.getResponse();
    const rawDetail = typeof body === "string" ? body : (body as { message?: string | string[] }).message;
    const detail = Array.isArray(rawDetail) ? rawDetail.join("; ") : rawDetail;

    return {
      type: "about:blank",
      title: exception.name.replace(/Exception$/, ""),
      status,
      ...(detail ? { detail } : {}),
      instance,
    };
  }
}
