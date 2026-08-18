/**
 * Strip markdown syntax from a short block of AI-generated text.
 *
 * Used to clean up `generateSignal`'s output before it's cached and rendered
 * as plain text with no markdown renderer — an instruction alone isn't
 * reliable, models are trained on enough markdown-formatted "advice" text
 * that they reach for `**bold**` and `##` headers out of habit even when told
 * not to, so unstripped syntax would otherwise show up as literal asterisks
 * and hashes on screen.
 *
 * A light regex pass, not a full parser — good enough for the handful of
 * constructs a short LLM response actually uses (emphasis, headers, list
 * markers). Pure and dependency-free so it can live in `@/lib` and be tested
 * without pulling in the server-only module that calls it.
 *
 * Deliberately does not touch single/double underscores as italic/bold
 * markers: the context data these signals are generated from is full of
 * snake_case field names (`utm_source`, `content_tag`, `ref_code`), and the
 * model routinely echoes them back. A single-underscore-italic rule would
 * treat the underscore in one such name as an opening marker and eat
 * everything up to the next one — merging two unrelated words the moment a
 * response mentions two snake_case terms. Asterisks carry no such collision
 * risk here.
 */
export function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^[ \t]*[-*+]\s+/gm, "")
    .replace(/^[ \t]*\d+\.\s+/gm, "")
    .trim();
}
