import { Controller, Get, Inject, ServiceUnavailableException } from "@nestjs/common";
import { PrismaService } from "../database/prisma.service";

/**
 * Vérifie que l'API peut réellement parler à PostgreSQL, pas seulement que
 * le process Node tourne. Un load balancer ou un orchestrateur qui router
 * du trafic vers une instance dont la base est injoignable enverrait des
 * 500 en boucle sans que rien ne l'avertisse autrement.
 */
@Controller("health")
export class HealthController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Get()
  async check(): Promise<{ status: "ok" }> {
    try {
      await this.prisma.client.$queryRaw`SELECT 1`;
      return { status: "ok" };
    } catch {
      throw new ServiceUnavailableException({ status: "error", detail: "database unreachable" });
    }
  }
}
