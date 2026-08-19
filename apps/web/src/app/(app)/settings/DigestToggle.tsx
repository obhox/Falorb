"use client";

import { useState } from "react";
import { Card, Switch } from "@falorb/ui";
import { updateWeeklyDigest } from "@/server/actions/organization";
import { useAction } from "@/lib/use-action";

/**
 * Opt-out for the worker's weekly digest job (`apps/worker/src/jobs/digest.ts`).
 * A `Switch` bound directly to the server action — no form, no draft state,
 * same as `cookieless` in `SettingsForm` but standalone since this lives at
 * the organization level rather than per project.
 */
export function DigestToggle({
  weeklyDigestEnabled,
  canEdit,
}: {
  weeklyDigestEnabled: boolean;
  canEdit: boolean;
}) {
  const { run, pending } = useAction();
  const [checked, setChecked] = useState(weeklyDigestEnabled);

  async function toggle(next: boolean) {
    setChecked(next);
    const result = await run(() => updateWeeklyDigest(next), { refresh: false });
    // Revert locally on failure — the toast already explains why.
    if (!result?.ok) setChecked(!next);
  }

  return (
    <Card
      title="Weekly digest"
      subtitle="One email a week with the content, sales, marketing and product signals for every property"
    >
      <Switch
        checked={checked}
        onChange={toggle}
        disabled={!canEdit || pending}
        label="Email the team a weekly digest"
      />
    </Card>
  );
}
