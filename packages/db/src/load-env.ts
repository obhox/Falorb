import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Load the monorepo's root `.env` for a CLI script.
 *
 * `turbo.json` declares the root `.env` as a global dependency and every
 * service reads its configuration from it, but nothing actually loads the file
 * — the long-running apps get it from their own runtime (`bun` and Next both
 * do it), while the one-shot `tsx` scripts do not. So `pnpm db:seed` failed
 * with "DATABASE_URL is not set" unless the caller happened to have exported it
 * already, which reads as a broken script rather than a missing variable.
 *
 * Walks upward rather than assuming a fixed depth, so this works whether it is
 * called from `packages/db`, from the repo root, or from a `dist` build.
 *
 * Values already present in the environment win, so CI-injected configuration
 * is never overwritten by a checked-out file.
 */
export function loadRootEnv(startDir: string = dirname(fileURLToPath(import.meta.url))): void {
  let dir = startDir;

  for (let depth = 0; depth < 8; depth++) {
    const candidate = resolve(dir, ".env");
    if (existsSync(candidate)) {
      applyEnvFile(candidate);
      return;
    }

    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
}

/**
 * Apply a `.env` file to `process.env`.
 *
 * `process.loadEnvFile` would be the obvious call, but it does not exist in
 * Bun — and `apps/ingest` runs on Bun, in development *and* in its production
 * image. Calling it unconditionally made the collector throw
 * "process.loadEnvFile is not a function" at startup, which is the one service
 * that must never fail to boot.
 *
 * So: use the native call when the runtime has it, and otherwise parse the file
 * directly. Bun loads `.env` itself anyway, which is why this went unnoticed —
 * the crash came from the call, not from anything being missing.
 */
function applyEnvFile(path: string): void {
  const native = (process as NodeJS.Process & { loadEnvFile?: (p: string) => void }).loadEnvFile;
  if (typeof native === "function") {
    native.call(process, path);
    return;
  }

  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;

    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();

    // Strip matching surrounding quotes. `EMAIL_FROM="Falorb <x@y>"` has to
    // keep its angle brackets and lose its quotes.
    if (value.length >= 2 && ((value[0] === '"' && value.at(-1) === '"') ||
        (value[0] === "'" && value.at(-1) === "'"))) {
      value = value.slice(1, -1);
    }

    // Already-exported values win, so CI configuration is never overwritten.
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
