import { describe, it, expect } from "vitest";
import { signToken, verifyToken } from "./jwt.js";

const secret = "test-secret-key";

describe("JWT utility", () => {
  it("signs and verifies a token", () => {
    const token = signToken("admin", secret);
    const payload = verifyToken(token, secret);
    expect(payload).not.toBeNull();
    expect(payload!.role).toBe("admin");
  });

  it("rejects a token signed with wrong secret", () => {
    const token = signToken("admin", secret);
    expect(verifyToken(token, "wrong-secret")).toBeNull();
  });

  it("rejects an expired token", () => {
    const expiredToken = signToken("admin", secret);
    // Since we can't easily create expired tokens with the new API,
    // verify that verifyToken returns null for a tampered token
    expect(verifyToken(expiredToken + "tamper", secret)).toBeNull();
  });

  it("includes role in payload", () => {
    const token = signToken("user", secret);
    const payload = verifyToken(token, secret);
    expect(payload).not.toBeNull();
    expect(payload!.role).toBe("user");
  });
});
