import { describe, it, expect } from "vitest";
import { normalizeCookie, isNormalizedCookie } from "./cookie-normalize.js";

describe("normalizeCookie", () => {
  it("strips Set-Cookie attributes, keeping only name=value pairs", () => {
    const raw =
      "MUSIC_A_T=1492331774178; Max-Age=2147483647; Expires=Mon, 06 Dec 2094 04:18:36 GMT; Path=/eapi/feedback;" +
      ";MUSIC_R_T=1492334946290; Max-Age=2147483647; Expires=Mon, 06 Dec 2094 04:18:36 GMT; Path=/wapi/clientlog";
    expect(normalizeCookie(raw)).toBe("MUSIC_A_T=1492331774178; MUSIC_R_T=1492334946290");
  });

  it("handles a pasted Set-Cookie: header line", () => {
    const raw = "Set-Cookie: MUSIC_U=abc123; Path=/; HttpOnly; Secure";
    expect(normalizeCookie(raw)).toBe("MUSIC_U=abc123");
  });

  it("handles a pasted Cookie: header line", () => {
    expect(normalizeCookie("Cookie: MUSIC_U=abc123; __csrf=xyz")).toBe("MUSIC_U=abc123; __csrf=xyz");
  });

  it("strips multiple header prefixes from a multi-line paste", () => {
    const raw = "Cookie: A=1; Path=/\nCookie: B=2; Path=/";
    expect(normalizeCookie(raw)).toBe("A=1; B=2");
  });

  it("keeps '=' inside values (base64 padding)", () => {
    expect(normalizeCookie("MUSIC_U=abc==; Path=/")).toBe("MUSIC_U=abc==");
  });

  it("de-duplicates repeated names, last one wins", () => {
    const raw = "MUSIC_A_T=111; Path=/a; MUSIC_A_T=222; Path=/b; MUSIC_A_T=333";
    expect(normalizeCookie(raw)).toBe("MUSIC_A_T=333");
  });

  it("drops fragments without '=', empty values, and trailing separators", () => {
    expect(normalizeCookie(";;A=1;; ;B=;C=3;")).toBe("A=1; C=3");
  });

  it("strips CR/LF left inside values by a wrapped paste", () => {
    expect(normalizeCookie("A=va\r\nlue; B=2")).toBe("A=value; B=2");
  });

  it("drops names that are not RFC 6265 tokens", () => {
    expect(normalizeCookie("A=1; bad name=2; B=3")).toBe("A=1; B=3");
  });

  it("leaves a valid cookie untouched", () => {
    const valid = "MUSIC_U=abc123; __csrf=xyz789; NMTID=00Oabc";
    expect(normalizeCookie(valid)).toBe(valid);
  });

  it("is idempotent", () => {
    const raw = "MUSIC_U=abc; Max-Age=1; Path=/;;__csrf=x";
    const once = normalizeCookie(raw);
    expect(normalizeCookie(once)).toBe(once);
  });

  it("returns empty string for empty / whitespace input", () => {
    expect(normalizeCookie("")).toBe("");
    expect(normalizeCookie("   ")).toBe("");
  });

  it("shrinks a realistic polluted blob to a sane length", () => {
    const fragments = Array.from({ length: 20 }, (_, i) => `MUSIC_A_T=${i}; Max-Age=2147483647; Expires=Mon, 06 Dec 2094 04:18:36 GMT; Path=/api/p${i}`);
    const out = normalizeCookie(fragments.join(";"));
    expect(out).toBe("MUSIC_A_T=19");
    expect(out.length).toBeLessThan(40);
  });
});

describe("isNormalizedCookie", () => {
  it("true for a clean header", () => {
    expect(isNormalizedCookie("A=1; B=2")).toBe(true);
  });

  it("false for a polluted blob", () => {
    expect(isNormalizedCookie("A=1; Max-Age=5")).toBe(false);
  });
});
