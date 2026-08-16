import { existsSync } from "node:fs";
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
      process.loadEnvFile(candidate);
      return;
    }

    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
}
