import crypto from "node:crypto";
import jwt from "jsonwebtoken";

const JWT_EXPIRES_IN = "24h";

export interface JwtPayload {
  role: "admin" | "user";
}

export function deriveSecret(adminPassword: string): string {
  return crypto
    .createHmac("sha256", "tsmusicbot-salt")
    .update(adminPassword)
    .digest("hex");
}

export function signToken(role: "admin" | "user", secret: string): string {
  return jwt.sign({ role }, secret, { expiresIn: JWT_EXPIRES_IN });
}

export function verifyToken(token: string, secret: string): JwtPayload | null {
  try {
    return jwt.verify(token, secret) as JwtPayload;
  } catch {
    return null;
  }
}
