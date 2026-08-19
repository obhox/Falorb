import "server-only";

/**
 * Thin, server-only re-export of `@falorb/ai`. Kept as its own module (rather
 * than every caller importing `@falorb/ai` directly) so every import site
 * inside `apps/web` still goes through `src/server`, the boundary this app
 * uses to guarantee secret-holding code never reaches the client bundle —
 * defense in depth alongside the `"server-only"` import above.
 */
export { AiSignalError, generateSignal, complete, type SignalKind } from "@falorb/ai";
