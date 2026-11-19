import pino from "pino";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

export type Logger = pino.Logger;

/**
 * Redact an Axios error before it reaches a log sink.
 *
 * `axios` errors carry the full request config, so `logger.error({ err }, …)`
 * used to write `config.params.cookie` (a live account credential), the
 * `Authorization` header and the complete URL including `?cookie=` into both
 * stdout and bot.log. Only typed status fields are forwarded.
 */
function serializeHttpError(error: unknown): unknown {
  const e = error as {
    isAxiosError?: boolean;
    code?: unknown;
    name?: unknown;
    message?: unknown;
    response?: { status?: unknown; data?: { code?: unknown } };
  } | null;

  if (e?.isAxiosError) {
    const status = e.response?.status;
    const upstream = e.response?.data?.code;
    return {
      type: "AxiosError",
      code: typeof e.code === "string" ? e.code : undefined,
      status: typeof status === "number" ? status : undefined,
      // NetEase reports risk control as a numeric body code (-460); that is the
      // one body field worth keeping, and it is not secret.
      upstreamCode: typeof upstream === "number" ? upstream : undefined,
    };
  }

  // pino's own serializer handles plain Errors (stack, type, message).
  return pino.stdSerializers.err(error as Error);
}

export function createLogger(logDir?: string): Logger {
  const serializers = { err: serializeHttpError, reason: serializeHttpError };

  if (!logDir) {
    return pino({ level: "info", serializers });
  }

  mkdirSync(logDir, { recursive: true });

  const transport = pino.transport({
    targets: [
      {
        target: "pino/file",
        options: { destination: 1 }, // stdout
        level: "info",
      },
      {
        // Audit PERF-09: roll by size instead of appending forever — a 24/7
        // FM instance otherwise grows bot.log unbounded. Keep 1 rotated file.
        target: "pino-roll",
        options: { file: join(logDir, "bot.log"), size: "50m", roll: 1, mkdir: true },
        level: "debug",
      },
    ],
  });

  // Prevent EINTR errors from crashing the process (known pino/thread-stream issue on Linux)
  transport.on("error", (err: Error) => {
    if ((err as NodeJS.ErrnoException).code === "EINTR") return;
    console.error("Logger transport error:", err);
  });

  return pino({ level: "debug", serializers }, transport);
}
