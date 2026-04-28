import jwt from "jsonwebtoken";

export interface JwtPayload {
  role: "admin" | "user";
}

export function signToken(
  payload: JwtPayload,
  secret: string,
  expiresIn: string,
): string {
  return jwt.sign(payload, secret, { expiresIn: expiresIn as jwt.SignOptions["expiresIn"] });
}

export function verifyToken(token: string, secret: string): JwtPayload {
  const decoded = jwt.verify(token, secret);
  return decoded as JwtPayload;
}
