import { describe, it, expect } from "vitest";
import { resolvePlaylistUrl, UnsupportedPlaylistUrlError } from "./youtube.js";

// Regression (security audit SEC-02): yt-dlp fetches whatever URL it is given
// from this server, so caller-supplied URLs must be pinned to YouTube hosts —
// anything else would be an SSRF primitive against the LAN/metadata endpoints.
describe("resolvePlaylistUrl", () => {
  it("treats a bare id as a youtube.com playlist URL", () => {
    expect(resolvePlaylistUrl("PL12345")).toBe(
      "https://www.youtube.com/playlist?list=PL12345"
    );
  });

  it("passes through URLs on whitelisted YouTube hosts", () => {
    for (const host of [
      "https://www.youtube.com/playlist?list=PL12345",
      "https://youtube.com/playlist?list=PL12345",
      "https://music.youtube.com/playlist?list=PL12345",
      "https://m.youtube.com/playlist?list=PL12345",
      "https://youtu.be/playlist?list=PL12345",
    ]) {
      expect(resolvePlaylistUrl(host)).toBe(host);
    }
  });

  it("rejects URLs pointing at other hosts (SSRF guard)", () => {
    for (const url of [
      "http://192.168.1.1/some page",
      "http://127.0.0.1:3000/",
      "https://evil.example.com/playlist",
      "http://169.254.169.254/latest/meta-data",
    ]) {
      expect(() => resolvePlaylistUrl(url)).toThrow(UnsupportedPlaylistUrlError);
    }
  });

  it("rejects a malformed URL", () => {
    expect(() => resolvePlaylistUrl("http://")).toThrow(UnsupportedPlaylistUrlError);
  });
});
