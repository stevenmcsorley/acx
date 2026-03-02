import type { FastifyInstance } from "fastify";

export async function healthRoutes(server: FastifyInstance): Promise<void> {
  server.get("/health", async () => {
    return {
      status: "ok",
      service: "sgcx-api",
      timestamp: new Date().toISOString()
    };
  });
}
