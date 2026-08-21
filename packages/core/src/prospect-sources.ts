/**
 * The listening sources `prospects.source` (`packages/db/src/schema/prospecting.ts`)
 * can hold, with a description of what each one actually is — written so
 * either a person reading the dashboard or an AI agent reasoning over the
 * MCP tools (`apps/mcp/src/tools/prospects.ts`) understands what kind of
 * signal a match represents, without having to read the worker job that
 * produced it.
 *
 * `prospects.source` is deliberately open text, not an enum (see that
 * table's own docblock), so this registry is a lookup with a safe fallback
 * for an unrecognised value rather than a type the column is constrained to.
 */
export interface ProspectSourceInfo {
  key: string;
  label: string;
  /** What this source is and why a match here is worth reading. */
  description: string;
}

export const PROSPECT_SOURCES: Record<string, ProspectSourceInfo> = {
  reddit: {
    key: "reddit",
    label: "Reddit",
    description:
      "A public Reddit post matching a listening keyword — someone asking for a " +
      "solution, complaining about a pain point, or comparing tools out in the open.",
  },
  hackernews: {
    key: "hackernews",
    label: "Hacker News",
    description:
      "A story or comment on Hacker News (via its public search API) matching a " +
      "listening keyword — a technical, high-intent audience discussing tools and " +
      "problems, often before a mainstream community picks it up.",
  },
  job_search: {
    key: "job_search",
    label: "Job posting",
    description:
      "A public job posting matching a listening keyword — a company hiring for a " +
      "role tied to the problem the product solves is a buying signal in its own " +
      "right, not just a social mention.",
  },
};

/** Always returns something displayable, even for a source not in the registry. */
export function describeProspectSource(source: string): string {
  return PROSPECT_SOURCES[source]?.description ?? "An off-site mention discovered by a listening keyword.";
}

export function labelProspectSource(source: string): string {
  return PROSPECT_SOURCES[source]?.label ?? source;
}
