import { describe, expect, it } from "vitest";
import { renderFrontmatter, renderPath, slugify } from "./paths";

describe("slugify", () => {
  it("lowercases, hyphenates, and strips punctuation", () => {
    expect(slugify("How to Grow Your SaaS in 2026!")).toBe("how-to-grow-your-saas-in-2026");
  });

  it("collapses repeated separators and trims leading/trailing hyphens", () => {
    expect(slugify("  --Weird   Spacing--  ")).toBe("weird-spacing");
  });

  it("falls back to a placeholder for an all-punctuation title", () => {
    expect(slugify("!!!")).toBe("untitled");
  });
});

describe("renderPath", () => {
  const date = new Date("2026-08-21T12:00:00Z");

  it("substitutes {slug} from the title", () => {
    expect(renderPath("content/blog/{slug}.md", { title: "Hello World", date })).toBe(
      "content/blog/hello-world.md",
    );
  });

  it("substitutes {date} as an ISO date", () => {
    expect(renderPath("content/blog/{date}-{slug}.mdx", { title: "Launch Day", date })).toBe(
      "content/blog/2026-08-21-launch-day.mdx",
    );
  });
});

describe("renderFrontmatter", () => {
  const date = new Date("2026-08-21T12:00:00Z");

  it("substitutes title/description/date into a custom template", () => {
    const result = renderFrontmatter("title: {title}\ndesc: {description}\ndate: {date}\n", {
      title: "My Post",
      description: "A short summary",
      date,
    });
    expect(result).toBe("title: My Post\ndesc: A short summary\ndate: 2026-08-21\n");
  });

  it("falls back to a default YAML block when no template is configured", () => {
    const result = renderFrontmatter(null, { title: "My Post", description: "A short summary", date });
    expect(result).toContain('title: "My Post"');
    expect(result).toContain('description: "A short summary"');
    expect(result).toContain("date: 2026-08-21");
    expect(result.startsWith("---\n")).toBe(true);
  });

  it("falls back for a blank template string too", () => {
    const result = renderFrontmatter("   ", { title: "My Post", description: "d", date });
    expect(result.startsWith("---\n")).toBe(true);
  });

  it("escapes double quotes in substituted values", () => {
    const result = renderFrontmatter(null, { title: 'The "Best" Post', description: "d", date });
    expect(result).toContain('title: "The \\"Best\\" Post"');
  });
});
