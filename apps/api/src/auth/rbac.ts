import type { FastifyReply, FastifyRequest } from "fastify";
import type { UserRole } from "@prisma/client";
import { verifyAccessToken } from "./jwt";

function extractBearerToken(request: FastifyRequest): string | null {
  const authHeader = request.headers.authorization;
  if (!authHeader) {
    return null;
  }

  const [scheme, token] = authHeader.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) {
    return null;
  }

  return token;
}

export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const token = extractBearerToken(request);
  if (!token) {
    reply.status(401).send({ message: "Missing bearer token" });
    return;
  }

  try {
    const claims = verifyAccessToken(token);
    request.authUser = {
      id: claims.sub,
      email: claims.email,
      role: claims.role,
      displayName: claims.displayName
    };
  } catch {
    reply.status(401).send({ message: "Invalid token" });
  }
}

export function requireRoles(...roles: UserRole[]) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!request.authUser) {
      reply.status(401).send({ message: "Not authenticated" });
      return;
    }

    if (!roles.includes(request.authUser.role)) {
      reply.status(403).send({ message: "Forbidden" });
    }
  };
}
