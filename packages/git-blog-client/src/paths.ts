/**
 * Pure templating for where a draft lands in the repo and what frontmatter it
 * gets — kept free of any network/DB dependency so both halves are testable
 * with plain inputs, no `fetch` stubbing required.
 */

export interface DraftPathInput {
  title: string;
  date: Date;
}

export interface DraftFrontmatterInput {
  title: string;
  description: string;
  date: Date;
}

const DEFAULT_FRONTMATTER_TEMPLATE = `---
title: "{title}"
description: "{description}"
date: {date}
---

`;

/** Lowercase, alphanumeric-and-hyphen only, no leading/trailing/doubled hyphens. */
export function slugify(title: string): string {
  return (
    title
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "untitled"
  );
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Substitutes {slug} and {date} into a path template, e.g. "content/blog/{slug}.md". */
export function renderPath(template: string, input: DraftPathInput): string {
  return template
    .replaceAll("{slug}", slugify(input.title))
    .replaceAll("{date}", isoDate(input.date));
}

/**
 * Substitutes {title}/{description}/{date} into a frontmatter template and
 * returns it verbatim (the caller prepends it to the draft body). Falls back
 * to a plain YAML block when the connection has no template configured.
 */
export function renderFrontmatter(
  template: string | null | undefined,
  input: DraftFrontmatterInput,
): string {
  const source = template && template.trim().length > 0 ? template : DEFAULT_FRONTMATTER_TEMPLATE;
  return source
    .replaceAll("{title}", input.title.replaceAll('"', '\\"'))
    .replaceAll("{description}", input.description.replaceAll('"', '\\"'))
    .replaceAll("{date}", isoDate(input.date));
}
