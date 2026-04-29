import { signToken } from "./jwt.js";
import { createRateLimiter, type RateLimiter } from "./rate-limit.js";
import type { Logger } from "../logger.js";

interface LoginBody {
  password?: string;
}

/**
 * Create an Express handler for POST /api/auth/login.
 * Validates the password against config, returns JWT on success.
 */
export function createAdminLoginHandler(
  adminPassword: string,
  jwtSecret: string,
  logger: Logger,
) {
  const limiter: RateLimiter = createRateLimiter({
    maxAttempts: 5,
    windowMs: 5000,
  });

  return function handleLogin(req: import("express").Request, res: import("express").Response): void {
    // NOTE: req.ip uses the direct connection IP by default. If the bot is
    // behind a reverse proxy (nginx/Caddy/Cloudflare), set `trustProxy: true`
    // in config.json so Express reads X-Forwarded-For instead. Otherwise the
    // rate limiter sees all requests from the same proxy IP and is ineffective.
    const ip = req.ip ?? "unknown";

    if (limiter.isLimited(ip)) {
      logger.warn({ ip }, "Login rate limited");
      res.status(429).json({ success: false, error: "Too many login attempts" });
      return;
    }

    const { password } = req.body as LoginBody;
    if (!password) {
      res.status(400).json({ success: false, error: "Password is required" });
      return;
    }

    if (password !== adminPassword) {
      logger.warn({ ip }, "Login failed: wrong password");
      limiter.recordFailure(ip);
      res.status(401).json({ success: false, error: "Invalid password" });
      return;
    }

    const token = signToken({ role: "admin" }, jwtSecret, "24h");
    logger.info({ ip }, "Admin login successful");
    res.json({ success: true, token, expiresIn: "24h" });
  };
}
