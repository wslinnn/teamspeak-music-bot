import { describe, it, expect } from "vitest";
import { BiliBiliProvider } from "./bilibili.js";
import { KugouProvider } from "./kugou.js";
import { QQMusicProvider } from "./qq.js";
import { NeteaseProvider } from "./netease.js";

/** `withCookie` must hand back an independent view: the shared instance's
 *  credentials (and thus room playback) are never disturbed. */

describe("provider withCookie — isolation", () => {
  it("netease: the view carries its own cookie, the shared one is untouched", () => {
    const base = new NeteaseProvider("http://127.0.0.1:3001");
    base.setCookie("MUSIC_U=shared");
    base.setQuality("lossless");

    const view = base.withCookie("MUSIC_U=personal");
    expect(view.getCookie()).toBe("MUSIC_U=personal");
    expect(base.getCookie()).toBe("MUSIC_U=shared");
    expect(view.getQuality()).toBe("lossless");
    expect(view).not.toBe(base);
  });

  it("qq: the view carries its own cookie and keeps the quality", () => {
    const base = new QQMusicProvider("http://127.0.0.1:3200");
    base.setCookie("qqmusic_key=shared");
    base.setQuality("flac");

    const view = base.withCookie("qqmusic_key=personal");
    expect(view.getCookie()).toBe("qqmusic_key=personal");
    expect(base.getCookie()).toBe("qqmusic_key=shared");
    expect(view.getQuality()).toBe("flac");
    expect(view).not.toBe(base);
  });

  it("bilibili: the view carries its own cookie", () => {
    const base = new BiliBiliProvider();
    base.setCookie("SESSDATA=shared");

    const view = base.withCookie("SESSDATA=personal");
    expect(view.getCookie()).toBe("SESSDATA=personal");
    expect(base.getCookie()).toBe("SESSDATA=shared");
    expect(view).not.toBe(base);
  });

  it("kugou: the view carries its own cookie map", () => {
    const base = new KugouProvider();
    base.setCookie("token=shared; userid=1");
    base.setQuality("320");

    const view = base.withCookie("token=personal; userid=2");
    expect(view.getCookie()).toContain("token=personal");
    expect(base.getCookie()).toContain("token=shared");
    expect(view.getQuality()).toBe("320");
    expect(view).not.toBe(base);
  });
});

describe("provider withCookie — cookie normalisation carries through", () => {
  it("a polluted Set-Cookie blob is cleaned on the way in", () => {
    const view = new NeteaseProvider("http://x").withCookie(
      "MUSIC_U=abc; Max-Age=100; Path=/; Expires=Mon, 06 Dec 2094 04:18:36 GMT",
    );
    expect(view.getCookie()).toBe("MUSIC_U=abc");
  });

  it("kugou drops the Set-Cookie attributes instead of storing them as keys", () => {
    const view = new KugouProvider().withCookie("token=abc; Max-Age=100; Path=/");
    expect(view.getCookie()).toBe("token=abc");
  });
});
