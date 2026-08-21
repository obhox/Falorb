import { describe, expect, it } from "vitest";
import { stripHtml } from "./hackernews-listener";

describe("stripHtml", () => {
  it("strips tags and collapses whitespace", () => {
    expect(stripHtml("<p>Looking for a  <i>good</i> tool</p>")).toBe("Looking for a good tool");
  });

  it("decodes common HTML entities", () => {
    expect(stripHtml("It&#x27;s &quot;great&quot; &amp; simple &lt;3")).toBe(
      "It's \"great\" & simple <3",
    );
  });

  it("returns plain text unchanged", () => {
    expect(stripHtml("nothing to strip here")).toBe("nothing to strip here");
  });
});
