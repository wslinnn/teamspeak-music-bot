import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Run a snippet in a real Node process so we assert the ACTUAL serialized
 *  stdout, not a mock. A serializer bug that only shows up at encode time
 *  (e.g. pino dropping an undefined replacer) would slip past a unit test. */
function runSnippet(source: string): string {
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "--eval", source],
    { cwd: repoRoot, encoding: "utf-8", timeout: 60_000 },
  );
  if (result.error) throw result.error;
  return `${result.stdout ?? ""}${result.stderr ?? ""}`;
}

describe("logger redaction", () => {
  it("omits Axios request config and response data from a logged error", () => {
    const out = runSnippet(`
      import { createLogger } from "./src/logger.ts";
      const logger = createLogger();
      const err = Object.assign(new Error("Request failed with status code 400"), {
        isAxiosError: true,
        code: "ERR_BAD_REQUEST",
        config: { params: { cookie: "MUSIC_U=SECRET-COOKIE-VALUE" }, headers: { Authorization: "Bearer SECRET-TOKEN" } },
        response: { status: 400, data: { code: -460, message: "risk" } },
      });
      logger.error({ err }, "probe");
    `);
    expect(out).not.toContain("SECRET-COOKIE-VALUE");
    expect(out).not.toContain("SECRET-TOKEN");
    expect(out).toContain("ERR_BAD_REQUEST");
    expect(out).toContain("400");
    expect(out).toContain("-460");
  });

  it("keeps the useful fields of a plain Error", () => {
    const out = runSnippet(`
      import { createLogger } from "./src/logger.ts";
      createLogger().error({ err: new Error("plain failure") }, "probe");
    `);
    expect(out).toContain("plain failure");
    expect(out).toContain("stack");
  });

  it("does not break string `reason` fields already in use", () => {
    const out = runSnippet(`
      import { createLogger } from "./src/logger.ts";
      createLogger().warn({ sessionId: 1, reason: "recovery-error" }, "probe");
    `);
    expect(out).toContain("recovery-error");
  });
});
