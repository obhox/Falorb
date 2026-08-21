/**
 * Cap a block of scraped/searched text to a character budget before it goes
 * into an LLM prompt — Exa result text and Firecrawl markdown are both
 * unbounded, and a single long page shouldn't crowd out every other
 * research source (or blow the prompt's token budget) in a caller that
 * gathers several of them.
 */
export function truncateText(text: string, maxChars: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, maxChars).trimEnd()}…`;
}
