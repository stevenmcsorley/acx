import type { UserRole } from "@prisma/client";

declare module "fastify" {
  interface FastifyRequest {
    authUser?: {
      id: string;
      email: string;
      role: UserRole;
      displayName: string;
    };
  }
}
