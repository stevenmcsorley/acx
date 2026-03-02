import jwt from "jsonwebtoken";
import type { UserRole } from "@prisma/client";
import { env } from "../config/env";

export interface JwtUserClaims {
  sub: string;
  email: string;
  role: UserRole;
  displayName: string;
}

export function signAccessToken(claims: JwtUserClaims): string {
  return jwt.sign(claims, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions["expiresIn"],
    issuer: "sgc-x"
  });
}

export function verifyAccessToken(token: string): JwtUserClaims {
  return jwt.verify(token, env.JWT_SECRET, {
    issuer: "sgc-x"
  }) as JwtUserClaims;
}
