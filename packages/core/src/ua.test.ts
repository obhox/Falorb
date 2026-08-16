import { describe, expect, it } from "vitest";
import { parseUserAgent } from "./ua";

describe("parseUserAgent", () => {
  it("identifies Chrome on Windows", () => {
    const r = parseUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    );
    expect(r.browser).toBe("Chrome");
    expect(r.browserVersion).toBe("131");
    expect(r.os).toBe("Windows");
    expect(r.osVersion).toBe("10/11");
    expect(r.deviceType).toBe("desktop");
    expect(r.isBot).toBe(false);
  });

  it("prefers Edge over the Chrome token it also advertises", () => {
    const r = parseUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.2903.86",
    );
    expect(r.browser).toBe("Edge");
    expect(r.browserVersion).toBe("131");
  });

  it("prefers Opera over Chrome", () => {
    const r = parseUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 OPR/115.0.0.0",
    );
    expect(r.browser).toBe("Opera");
    expect(r.os).toBe("macOS");
  });

  it("identifies Safari on iPhone as mobile", () => {
    const r = parseUserAgent(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1",
    );
    expect(r.browser).toBe("Safari");
    expect(r.browserVersion).toBe("18");
    expect(r.os).toBe("iOS");
    expect(r.deviceType).toBe("mobile");
  });

  it("identifies Chrome on iOS via the CriOS token", () => {
    const r = parseUserAgent(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.108 Mobile/15E148 Safari/604.1",
    );
    expect(r.browser).toBe("Chrome");
    expect(r.os).toBe("iOS");
    expect(r.deviceType).toBe("mobile");
  });

  it("treats an iPad as a tablet", () => {
    const r = parseUserAgent(
      "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
    );
    expect(r.deviceType).toBe("tablet");
  });

  it("treats Android without a Mobile token as a tablet", () => {
    const r = parseUserAgent(
      "Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
    );
    expect(r.os).toBe("Android");
    expect(r.deviceType).toBe("tablet");
  });

  it("treats Android with a Mobile token as mobile", () => {
    const r = parseUserAgent(
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36",
    );
    expect(r.deviceType).toBe("mobile");
    expect(r.osVersion).toBe("14");
  });

  it("identifies Firefox", () => {
    const r = parseUserAgent(
      "Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0",
    );
    expect(r.browser).toBe("Firefox");
    expect(r.browserVersion).toBe("133");
    expect(r.os).toBe("Linux");
  });

  describe("bot detection", () => {
    const cases: Array<[string, string]> = [
      ["Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)", "Googlebot"],
      ["Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)", "Bingbot"],
      ["Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.2", "GPTBot"],
      ["Mozilla/5.0 (compatible; ClaudeBot/1.0)", "ClaudeBot"],
      ["Mozilla/5.0 (compatible; AhrefsBot/7.0)", "AhrefsBot"],
      ["curl/8.7.1", "HTTP client"],
      ["Mozilla/5.0 (X11; Linux x86_64) HeadlessChrome/131.0.0.0", "Headless browser"],
      ["Mozilla/5.0 (compatible; SomeUnknownCrawler/1.0)", "Other bot"],
    ];

    for (const [ua, expected] of cases) {
      it(`flags ${expected}`, () => {
        const r = parseUserAgent(ua);
        expect(r.isBot).toBe(true);
        expect(r.botName).toBe(expected);
        expect(r.deviceType).toBe("bot");
      });
    }

    it("does not flag an ordinary browser", () => {
      const r = parseUserAgent(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      );
      expect(r.isBot).toBe(false);
    });
  });

  it("degrades safely on empty or junk input", () => {
    expect(parseUserAgent(undefined).browser).toBe("Other");
    expect(parseUserAgent("").deviceType).toBe("unknown");
    expect(parseUserAgent("!!!").isBot).toBe(false);
  });
});
