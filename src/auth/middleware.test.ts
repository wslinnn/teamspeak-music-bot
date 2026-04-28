import { describe, it, expect } from "vitest";
import { createRequireAuth } from "./middleware.js";
import { signToken } from "./jwt.js";
import type { Request, Response, NextFunction } from "express";

const secret = "test-secret";

function mockReq(headers: Record<string, string> = {}): Partial<Request> {
  return { headers };
}

function mockRes(): { statusCode: number; body: unknown } & Response {
  const res: Record<string, unknown> = {
    statusCode: 200,
    body: null,
    status(code: number) {
      res.statusCode = code;
      return this;
    },
    json(data: unknown) {
      res.body = data;
      return this;
    },
  };
  return res as unknown as ({ statusCode: number; body: unknown } & Response);
}

describe("requireAuth middleware", () => {
  const requireAuth = createRequireAuth(secret);

  it("passes through with valid token", () => {
    const token = signToken({ role: "admin" }, secret, "1h");
    const req = mockReq({ authorization: `Bearer ${token}` });
    const res = mockRes();
    let nextCalled = false;
    const next: NextFunction = () => { nextCalled = true; };

    requireAuth(req as Request, res as Response, next);
    expect(nextCalled).toBe(true);
  });

  it("rejects request with no authorization header", () => {
    const req = mockReq();
    const res = mockRes();
    let nextCalled = false;
    const next: NextFunction = () => { nextCalled = true; };

    requireAuth(req as Request, res as Response, next);
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(401);
  });

  it("rejects request with invalid token", () => {
    const req = mockReq({ authorization: "Bearer invalid-token" });
    const res = mockRes();
    let nextCalled = false;
    const next: NextFunction = () => { nextCalled = true; };

    requireAuth(req as Request, res as Response, next);
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(401);
  });

  it("rejects request with wrong scheme", () => {
    const token = signToken({ role: "admin" }, secret, "1h");
    const req = mockReq({ authorization: `Token ${token}` });
    const res = mockRes();
    let nextCalled = false;
    const next: NextFunction = () => { nextCalled = true; };

    requireAuth(req as Request, res as Response, next);
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(401);
  });
});
