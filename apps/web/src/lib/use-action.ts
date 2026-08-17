"use client";

import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/Toast";

/**
 * Running a server action with feedback that cannot get stuck.
 *
 * Every panel was doing this by hand and each one got some of it wrong. The
 * three failures were the same everywhere:
 *
 *   `pending` came from `useTransition`, which is only true while
 *   `router.refresh()` runs — not during the action's own round trip. The
 *   button therefore looked idle for the part that actually takes time, so
 *   people pressed it again.
 *
 *   A thrown action was uncaught. A dropped connection or a server error left
 *   the dialog sitting there with no message and no way to tell it had failed.
 *
 *   Success was silent unless the panel happened to render its own status
 *   line, so a write that landed looked identical to one that did nothing.
 *
 * `run` covers all three: pending spans the whole operation including the
 * refresh, every outcome produces a toast, and a throw is caught and reported
 * rather than escaping into an unhandled rejection.
 */

export interface ActionOutcome {
  ok: boolean;
  message?: string;
}

export interface RunOptions {
  /** Shown on success when the action returns no message of its own. */
  success?: string;
  /** Suppress the success toast — for actions whose result is self-evident. */
  quiet?: boolean;
  /** Re-render server components afterwards. On by default. */
  refresh?: boolean;
}

export function useAction() {
  const router = useRouter();
  const toast = useToast();
  const [isRefreshing, startTransition] = useTransition();
  const [isRunning, setRunning] = useState(false);

  const run = useCallback(
    async <T extends ActionOutcome>(
      action: () => Promise<T>,
      options: RunOptions = {},
    ): Promise<T | null> => {
      setRunning(true);
      try {
        const result = await action();

        if (!result?.ok) {
          toast.error(result?.message ?? "That did not work.");
          return result ?? null;
        }

        if (!options.quiet) {
          toast.success(result.message ?? options.success ?? "Done");
        }

        if (options.refresh !== false) {
          startTransition(() => router.refresh());
        }

        return result;
      } catch (error) {
        /**
         * A `redirect()` inside a server action surfaces here as a thrown
         * NEXT_REDIRECT, which is control flow rather than a failure. Catching
         * it as an error would show "something went wrong" on the way to a
         * page that loaded perfectly well.
         */
        if (isRedirect(error)) throw error;

        toast.error(
          error instanceof Error && error.message
            ? error.message
            : "The server could not be reached. Check your connection and try again.",
        );
        return null;
      } finally {
        // `finally`, so a failure can never leave the button permanently
        // disabled — the exact state this hook exists to prevent.
        setRunning(false);
      }
    },
    [router, toast],
  );

  return { run, pending: isRunning || isRefreshing };
}

function isRedirect(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "digest" in error &&
    typeof (error as { digest?: unknown }).digest === "string" &&
    (error as { digest: string }).digest.startsWith("NEXT_REDIRECT")
  );
}
