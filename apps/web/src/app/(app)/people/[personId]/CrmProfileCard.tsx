"use client";

import { useState } from "react";
import Link from "next/link";
import { Badge, Button, Card, Dialog, Input, Select } from "@falorb/ui";
import { useAction } from "@/lib/use-action";
import { addPersonToCrm, createDeal, updateCrmProfile, updateDeal } from "@/server/actions/crm";
import {
  EditProfileDialog,
  type CrmProfileRow,
  type OwnerOption,
  type StageRow,
} from "../../crm/CrmTabsPanel";

export interface DealRow {
  id: string;
  name: string;
  stageId: string | null;
  stageName: string | null;
  isWon: boolean | null;
  isLost: boolean | null;
  amount: string | null;
  currency: string | null;
}

/**
 * Falorb's own CRM record for this person — separate from the "Linki" card,
 * which is purely the outreach channel. This is the contact record itself:
 * title/phone/status/owner, and the deals attached to them.
 */
export function CrmProfileCard({
  personId,
  personName,
  personEmail,
  profile,
  owners,
  stages,
  deals,
}: {
  personId: string;
  personName: string | null;
  personEmail: string | null;
  profile: {
    title: string | null;
    phone: string | null;
    status: string;
    ownerId: string | null;
    ownerName: string | null;
    linkedToLinki: boolean;
    updatedAt: string;
  } | null;
  owners: OwnerOption[];
  stages: StageRow[];
  deals: DealRow[];
}) {
  const { run, pending } = useAction();
  const [editing, setEditing] = useState(false);
  const [newDeal, setNewDeal] = useState(false);

  if (!profile) {
    return (
      <Card title="CRM" subtitle="Not yet a CRM contact">
        <div style={{ display: "grid", gap: 10 }}>
          <p style={{ fontSize: "var(--size-body-sm)", color: "var(--text-secondary)", margin: 0 }}>
            Add them to track a title, phone, status, owner, and deals — separate from the outreach
            channel below.
          </p>
          <Button
            size="sm"
            variant="primary"
            disabled={pending}
            onClick={() => void run(() => addPersonToCrm(personId), { success: "Added to CRM." })}
          >
            {pending ? "Adding…" : "Add to CRM"}
          </Button>
        </div>
      </Card>
    );
  }

  const stageName = new Map(stages.map((s) => [s.id, s.name]));
  const sortedStages = [...stages].sort((a, b) => a.position - b.position);

  return (
    <>
      <Card
        title="CRM"
        subtitle={profile.title ?? "Contact record"}
        action={
          <Badge tone={profile.status === "customer" ? "up" : profile.status === "churned" ? "down" : "neutral"}>
            {profile.status}
          </Badge>
        }
      >
        <div style={{ display: "grid", gap: 12 }}>
          <div style={{ display: "grid", gap: 4 }}>
            {profile.phone && (
              <span style={{ fontSize: "var(--size-body-sm)", color: "var(--text-body)" }}>{profile.phone}</span>
            )}
            <span style={{ fontSize: "var(--size-micro)", color: "var(--text-muted)" }}>
              {profile.ownerName ? `Owner: ${profile.ownerName}` : "No owner assigned"}
              {profile.linkedToLinki ? " · linked to Linki" : ""}
            </span>
          </div>
          <Button size="sm" onClick={() => setEditing(true)}>
            Edit
          </Button>

          <div style={{ display: "grid", gap: 8, borderTop: "1px solid var(--border-subtle)", paddingTop: 14 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span
                style={{ fontSize: "var(--size-label)", color: "var(--text-secondary)", fontWeight: "var(--wt-medium)" }}
              >
                Deals ({deals.length})
              </span>
              <Button size="sm" disabled={pending} onClick={() => setNewDeal(true)}>
                New
              </Button>
            </div>
            {deals.length === 0 && (
              <p style={{ fontSize: "var(--size-micro)", color: "var(--text-muted)", margin: 0 }}>No deals yet.</p>
            )}
            {deals.map((deal) => (
              <div key={deal.id} style={{ display: "grid", gap: 4 }}>
                <span style={{ fontSize: "var(--size-body-sm)", color: "var(--text-primary)" }}>{deal.name}</span>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <Select
                    size="sm"
                    value={deal.stageId ? (stageName.get(deal.stageId) ?? "—") : "—"}
                    options={sortedStages.map((s) => s.name)}
                    onChange={(label: string) => {
                      const stage = sortedStages.find((s) => s.name === label);
                      if (!stage || stage.id === deal.stageId) return;
                      const data = new FormData();
                      data.set("stage_id", stage.id);
                      void run(() => updateDeal(deal.id, data), { success: `Moved to ${stage.name}.` });
                    }}
                  />
                  {deal.amount && (
                    <span style={{ fontSize: "var(--size-micro)", color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
                      {deal.currency ?? ""} {deal.amount}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>

          <Link href="/crm" data-plain style={{ fontSize: "var(--size-micro)", color: "var(--text-secondary)" }}>
            View full CRM →
          </Link>
        </div>
      </Card>

      {editing && (
        <EditProfileDialog
          profile={{
            id: personId,
            personId,
            personName,
            personEmail,
            title: profile.title,
            phone: profile.phone,
            status: profile.status,
            ownerId: profile.ownerId,
            ownerName: profile.ownerName,
            linkedToLinki: profile.linkedToLinki,
            updatedAt: profile.updatedAt,
          } satisfies CrmProfileRow}
          owners={owners}
          pending={pending}
          onClose={() => setEditing(false)}
          onSave={async (formData) => {
            const result = await run(() => updateCrmProfile(personId, formData), { success: "Profile updated." });
            if (result?.ok) setEditing(false);
          }}
        />
      )}

      {newDeal && (
        <NewDealDialog
          stages={sortedStages}
          pending={pending}
          onClose={() => setNewDeal(false)}
          onSave={async (formData) => {
            const result = await run(() => createDeal(personId, formData), { success: "Deal created." });
            if (result?.ok) setNewDeal(false);
          }}
        />
      )}
    </>
  );
}

function NewDealDialog({
  stages,
  pending,
  onClose,
  onSave,
}: {
  stages: StageRow[];
  pending: boolean;
  onClose: () => void;
  onSave: (formData: FormData) => void;
}) {
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [stageId, setStageId] = useState(stages[0]?.id ?? "");
  const stageNameFor = (id: string) => stages.find((s) => s.id === id)?.name ?? "";

  return (
    <Dialog
      title="New deal"
      onClose={onClose}
      footer={
        <>
          <Button size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            variant="primary"
            disabled={pending || !name.trim()}
            onClick={() => {
              const data = new FormData();
              data.set("name", name);
              data.set("amount", amount);
              data.set("currency", currency);
              data.set("stage_id", stageId);
              onSave(data);
            }}
          >
            {pending ? "Creating…" : "Create deal"}
          </Button>
        </>
      }
    >
      <div style={{ display: "grid", gap: 10 }}>
        <Input label="Deal name" value={name} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)} placeholder="e.g. Annual plan" />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 100px", gap: 10 }}>
          <Input label="Amount" value={amount} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAmount(e.target.value)} placeholder="0" />
          <Input label="Currency" value={currency} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCurrency(e.target.value)} />
        </div>
        {stages.length > 0 && (
          <Select
            label="Stage"
            value={stageNameFor(stageId)}
            options={stages.map((s) => s.name)}
            onChange={(label: string) => {
              const match = stages.find((s) => s.name === label);
              if (match) setStageId(match.id);
            }}
          />
        )}
      </div>
    </Dialog>
  );
}
