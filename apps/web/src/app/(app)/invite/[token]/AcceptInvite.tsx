"use client";

import { useRouter } from "next/navigation";
import { Button, Icon } from "@falorb/ui";
import { acceptInvitation } from "@/server/actions/invite";
import { useAction } from "@/lib/use-action";

export function AcceptInvite({
  token,
  organization,
}: {
  token: string;
  organization: string;
}) {
  const router = useRouter();
  const { run, pending } = useAction();

  async function accept() {
    const result = await run(() => acceptInvitation(token), { success: "Joined" });
    if (!result?.ok) return;

    // `run` already refreshed, which matters here: the sidebar and portfolio
    // are rendered from the session's project list, which has just changed.
    router.replace("/");
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

    </div>
  );
}
