import crypto from "node:crypto";
import jwt, { type SignOptions } from "jsonwebtoken";

export interface JwtPayload {
  role: "admin" | "user";
}

export function deriveSecret(adminPassword: string): string {
  return crypto
    .createHmac("sha256", "tsmusicbot-salt")
    .update(adminPassword)
    .digest("hex");
}

export function signToken(
  role: "admin" | "user",
  secret: string,
  expiresIn: string = "24h"
): string {
  return jwt.sign({ role }, secret, { expiresIn } as SignOptions);
}

export function verifyToken(token: string, secret: string): JwtPayload | null {
  try {
    return jwt.verify(token, secret) as JwtPayload;
  } catch {
    return null;
  }
}
