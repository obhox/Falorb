"use client";

import { Button, Card } from "@falorb/ui";
import { useAction } from "@/lib/use-action";
import { promoteLinkiContact } from "@/server/actions/crm";

export function PromoteContactCard({ contactId, canManage }: { contactId: string; canManage: boolean }) {
  const { run, pending } = useAction();

  return (
    <Card title="Falorb CRM">
      <div style={{ display: "grid", gap: 10 }}>
        <p style={{ fontSize: "var(--size-body-sm)", color: "var(--text-muted)" }}>
          Not yet in Falorb's CRM. Adding them creates a person profile and a CRM record for this contact.
        </p>
        <Button
          size="sm"
          variant="primary"
          disabled={pending || !canManage}
          onClick={() => void run(() => promoteLinkiContact(contactId), { success: "Added to CRM." })}
        >
          Add to CRM
        </Button>
      </div>
    </Card>
  );
}
