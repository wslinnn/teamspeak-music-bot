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

export function signToken(role: "admin" | "user", secret: string): string;
export function signToken(payload: JwtPayload, secret: string, expiresIn: string): string;
export function signToken(
  roleOrPayload: "admin" | "user" | JwtPayload,
  secret: string,
  expiresIn?: string,
): string {
  if (typeof roleOrPayload === "string") {
    return jwt.sign({ role: roleOrPayload }, secret, { expiresIn: JWT_EXPIRES_IN });
  }
  return jwt.sign(roleOrPayload, secret, { expiresIn: expiresIn as jwt.SignOptions["expiresIn"] });
}

export function verifyToken(token: string, secret: string): JwtPayload | null {
  try {
    return jwt.verify(token, secret) as JwtPayload;
  } catch {
    return null;
  }
}
