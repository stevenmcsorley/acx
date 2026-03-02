import type { FastifyInstance } from "fastify";
import { UserRole } from "@prisma/client";
import { z } from "zod";
import { requireAuth, requireRoles } from "../auth/rbac";

const sessionSchema = z.object({
  droneId: z.string().min(2),
  codec: z.enum(["h264", "vp9", "av1"]).default("h264")
});

const offerSchema = z.object({
  droneId: z.string().min(2),
  sdp: z.string().min(1)
});

const candidateSchema = z.object({
  droneId: z.string().min(2),
  candidate: z.string().min(1),
  sdpMid: z.string().optional(),
  sdpMLineIndex: z.number().optional()
});

// In-memory signaling store (production would use Redis)
const pendingOffers = new Map<string, { sdp: string; timestamp: number }>();
const pendingAnswers = new Map<string, { sdp: string; timestamp: number }>();
const pendingCandidates = new Map<string, Array<{ candidate: string; sdpMid?: string; sdpMLineIndex?: number }>>();

export async function videoRoutes(server: FastifyInstance): Promise<void> {
  // Create video session (existing endpoint, improved)
  server.post(
    "/api/video/session",
    { preHandler: [requireAuth, requireRoles(UserRole.ADMIN, UserRole.OPERATOR, UserRole.SUPERVISOR)] },
    async (request, reply) => {
      const parsed = sessionSchema.safeParse(request.body);
      if (!parsed.success) {
        reply.status(400).send({ message: "Invalid request", errors: parsed.error.flatten() });
        return;
      }

      const now = Date.now();
      reply.send({
        session: {
          droneId: parsed.data.droneId,
          codec: parsed.data.codec,
          endpoint: `/api/video/rtc/${parsed.data.droneId}`,
          offerSdpStub: `v=0\r\no=- ${now} ${now} IN IP4 127.0.0.1\r\ns=SGC-X Video Stub\r\nt=0 0\r\na=recvonly\r\n`,
          status: "stub-ready",
          signalingEndpoints: {
            offer: `/api/video/rtc/${parsed.data.droneId}/offer`,
            answer: `/api/video/rtc/${parsed.data.droneId}/answer`,
            candidate: `/api/video/rtc/${parsed.data.droneId}/candidate`
          }
        }
      });
    }
  );

  // WebRTC offer (browser -> server)
  server.post(
    "/api/video/rtc/:droneId/offer",
    { preHandler: [requireAuth, requireRoles(UserRole.ADMIN, UserRole.OPERATOR, UserRole.SUPERVISOR)] },
    async (request, reply) => {
      const { droneId } = request.params as { droneId: string };
      const parsed = offerSchema.safeParse({ ...request.body as object, droneId });
      if (!parsed.success) {
        reply.status(400).send({ message: "Invalid offer", errors: parsed.error.flatten() });
        return;
      }

      pendingOffers.set(droneId, { sdp: parsed.data.sdp, timestamp: Date.now() });

      // In a real implementation, this would be forwarded to the drone's
      // video streaming service. For now, return a stub answer.
      const stubAnswer = parsed.data.sdp
        .replace("a=sendrecv", "a=recvonly")
        .replace("a=sendonly", "a=recvonly");

      pendingAnswers.set(droneId, { sdp: stubAnswer, timestamp: Date.now() });

      reply.send({
        status: "offer-received",
        answer: {
          sdp: stubAnswer,
          type: "answer"
        }
      });
    }
  );

  // WebRTC answer (polling for drone-side answer)
  server.get(
    "/api/video/rtc/:droneId/answer",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { droneId } = request.params as { droneId: string };
      const answer = pendingAnswers.get(droneId);

      if (!answer) {
        reply.status(404).send({ message: "No answer available" });
        return;
      }

      reply.send({ answer: { sdp: answer.sdp, type: "answer" } });
    }
  );

  // ICE candidate exchange
  server.post(
    "/api/video/rtc/:droneId/candidate",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { droneId } = request.params as { droneId: string };
      const parsed = candidateSchema.safeParse({ ...request.body as object, droneId });
      if (!parsed.success) {
        reply.status(400).send({ message: "Invalid candidate", errors: parsed.error.flatten() });
        return;
      }

      if (!pendingCandidates.has(droneId)) {
        pendingCandidates.set(droneId, []);
      }
      pendingCandidates.get(droneId)!.push({
        candidate: parsed.data.candidate,
        sdpMid: parsed.data.sdpMid,
        sdpMLineIndex: parsed.data.sdpMLineIndex
      });

      reply.send({ accepted: true });
    }
  );

  // Get pending ICE candidates
  server.get(
    "/api/video/rtc/:droneId/candidates",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { droneId } = request.params as { droneId: string };
      const candidates = pendingCandidates.get(droneId) ?? [];
      reply.send({ candidates });
    }
  );
}
