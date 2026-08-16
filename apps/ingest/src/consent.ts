import type { WireBatch } from "@falorb/core";
import type { CachedProject } from "./projects";

/**
 * Server-side consent enforcement.
 *
 * The tracker already gates on consent client-side, but that is a convenience,
 * not a control: the snippet can be misconfigured, cached from before a policy
 * change, or simply bypassed. If a project declares opt-in consent, the server
 * has to be the thing that refuses the data — otherwise the guarantee is only
 * as good as whatever JavaScript happens to be running on the page.
 *
 * The tracker signals consent state in the batch. Absence of the field is
 * treated as "not granted" under opt-in, which is the only safe reading: a
 * silent old tracker must not be interpreted as permission.
 */

export type ConsentDecision =
  | { accept: true; consentGranted: boolean | null }
  | { accept: false; reason: string };

export function evaluateConsent(project: CachedProject, batch: WireBatch): ConsentDecision {
  const declared = readConsentFlag(batch);

  switch (project.consentMode) {
    case "off":
      // Collection proceeds on legitimate-interest or cookieless grounds. The
      // flag is still recorded when present so the paper trail exists if the
      // project later switches modes.
      return { accept: true, consentGranted: declared };

    case "opt_in":
      if (declared === true) return { accept: true, consentGranted: true };
      return {
        accept: false,
        reason: declared === false ? "consent withdrawn" : "consent not granted",
      };

    case "opt_out":
      if (declared === false) return { accept: false, reason: "consent withdrawn" };
      return { accept: true, consentGranted: declared };
  }
}

/**
 * Read the consent flag from the batch.
 *
 * Sent as `c` (1 granted / 0 withdrawn). Older trackers omit it entirely,
 * which is distinct from an explicit "no" and is reported as null.
 */
function readConsentFlag(batch: WireBatch): boolean | null {
  const value = (batch as unknown as { c?: unknown }).c;
  if (value === 1 || value === true) return true;
  if (value === 0 || value === false) return false;
  return null;
}

/**
 * Whether this decision is worth persisting.
 *
 * Only explicit decisions are recorded. Writing a row for every anonymous
 * pageview on a consent-free project would add millions of rows saying
 * nothing, and would itself be a questionable use of the visitor's data.
 */
export function shouldRecordConsent(
  project: CachedProject,
  consentGranted: boolean | null,
): boolean {
  return consentGranted !== null && project.consentMode !== "off";
}
