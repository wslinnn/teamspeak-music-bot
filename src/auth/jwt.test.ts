import { describe, it, expect } from "vitest";
import { signToken, verifyToken } from "./jwt.js";

const secret = "test-secret-key";

describe("JWT utility", () => {
  it("signs and verifies a token", () => {
    const token = signToken({ role: "admin" }, secret, "1h");
    const payload = verifyToken(token, secret);
    expect(payload.role).toBe("admin");
  });

  it("rejects a token signed with wrong secret", () => {
    const token = signToken({ role: "admin" }, secret, "1h");
    expect(() => verifyToken(token, "wrong-secret")).toThrow();
  });

  it("rejects an expired token", () => {
    expect(() => {
      const expiredToken = signToken({ role: "admin" }, secret, "-1s");
      verifyToken(expiredToken, secret);
    }).toThrow();
  });

  it("includes role in payload", () => {
    const token = signToken({ role: "user" }, secret, "1h");
    const payload = verifyToken(token, secret);
    expect(payload.role).toBe("user");
  });
});
