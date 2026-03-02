import type { FastifyInstance } from "fastify";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../db/prisma";
import { signAccessToken } from "../auth/jwt";
import { requireAuth } from "../auth/rbac";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8)
});

export async function authRoutes(server: FastifyInstance): Promise<void> {
  server.post("/api/auth/login", async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.status(400).send({ message: "Invalid request", errors: parsed.error.flatten() });
      return;
    }

    const user = await prisma.user.findUnique({ where: { email: parsed.data.email.toLowerCase() } });
    if (!user) {
      reply.status(401).send({ message: "Invalid credentials" });
      return;
    }

    const passwordOk = await bcrypt.compare(parsed.data.password, user.passwordHash);
    if (!passwordOk) {
      reply.status(401).send({ message: "Invalid credentials" });
      return;
    }

    const token = signAccessToken({
      sub: user.id,
      email: user.email,
      role: user.role,
      displayName: user.displayName
    });

    reply.send({
      token,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        displayName: user.displayName
      }
    });
  });

  server.get("/api/auth/me", { preHandler: [requireAuth] }, async (request) => {
    return {
      user: request.authUser
    };
  });
}
