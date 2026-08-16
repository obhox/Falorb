"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Icon } from "@falorb/ui";
import { acceptInvitation } from "@/server/actions/invite";

export function AcceptInvite({
  token,
  organization,
}: {
  token: string;
  organization: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function accept() {
    setError(null);
    const result = await acceptInvitation(token);

    if (!result.ok) {
      setError(result.message ?? "That invitation could not be accepted.");
      return;
    }

    // Refresh before navigating: the sidebar and the portfolio are rendered
    // from the session's project list, which has just changed.
    startTransition(() => {
      router.refresh();
      router.replace("/");
    });
  }

  return (
    <div style={{ display: "grid", gap: "var(--space-6)" }}>
      <div>
        <Button
          variant="primary"
          onClick={accept}
          disabled={pending}
          iconLeft={<Icon name="check" size={14} />}
        >
          {pending ? "Joining" : `Join ${organization}`}
        </Button>
      </div>

      {error && (
        <span role="alert" style={{ fontSize: "var(--size-label)", color: "var(--signal-down)" }}>
          {error}
        </span>
      )}
    </div>
  );
}
