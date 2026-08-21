"use client";

import { useState } from "react";
import { Button, Card, Input, Select } from "@falorb/ui";
import { useAction } from "@/lib/use-action";
import { updateDeal } from "@/server/actions/crm";

export interface StageOption {
  id: string;
  name: string;
}

export interface OwnerOption {
  id: string;
  name: string;
}

const UNASSIGNED = "Unassigned";

export function DealEditCard({
  dealId,
  name: initialName,
  amount: initialAmount,
  currency: initialCurrency,
  source: initialSource,
  notes: initialNotes,
  stageId: initialStageId,
  ownerId: initialOwnerId,
  stages,
  owners,
  canManage,
}: {
  dealId: string;
  name: string;
  amount: string | null;
  currency: string | null;
  source: string | null;
  notes: string | null;
  stageId: string | null;
  ownerId: string | null;
  stages: StageOption[];
  owners: OwnerOption[];
  canManage: boolean;
}) {
  const { run, pending } = useAction();
  const [name, setName] = useState(initialName);
  const [amount, setAmount] = useState(initialAmount ?? "");
  const [currency, setCurrency] = useState(initialCurrency ?? "");
  const [source, setSource] = useState(initialSource ?? "");
  const [notes, setNotes] = useState(initialNotes ?? "");
  const [stageId, setStageId] = useState(initialStageId ?? stages[0]?.id ?? "");
  const [ownerName, setOwnerName] = useState(owners.find((o) => o.id === initialOwnerId)?.name ?? UNASSIGNED);

  const stageName = (id: string) => stages.find((s) => s.id === id)?.name ?? "";

  function save() {
    const data = new FormData();
    data.set("name", name);
    data.set("amount", amount);
    data.set("currency", currency);
    data.set("source", source);
    data.set("notes", notes);
    data.set("stage_id", stageId);
    const owner = owners.find((o) => o.name === ownerName);
    data.set("owner_id", owner?.id ?? "");
    void run(() => updateDeal(dealId, data), { success: "Deal saved." });
  }

  return (
    <Card title="Deal">
      <div style={{ display: "grid", gap: 10 }}>
        <Input label="Deal name" value={name} disabled={!canManage} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)} />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 100px", gap: 10 }}>
          <Input label="Amount" value={amount} disabled={!canManage} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAmount(e.target.value)} />
          <Input label="Currency" value={currency} disabled={!canManage} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCurrency(e.target.value)} />
        </div>
        {stages.length > 0 && (
          <Select
            label="Stage"
            value={stageName(stageId)}
            options={stages.map((s) => s.name)}
            onChange={(label: string) => {
              const match = stages.find((s) => s.name === label);
              if (match) setStageId(match.id);
            }}
          />
        )}
        <Select
          label="Owner"
          value={ownerName}
          options={[UNASSIGNED, ...owners.map((o) => o.name)]}
          onChange={setOwnerName}
        />
        <Input label="Source" value={source} disabled={!canManage} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSource(e.target.value)} placeholder="e.g. Referral, conference" />
        <label style={{ display: "grid", gap: 6 }}>
          <span style={{ fontSize: "var(--size-label)", color: "var(--text-secondary)", fontWeight: "var(--wt-medium)" }}>
            Notes
          </span>
          <textarea
            value={notes}
            disabled={!canManage}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setNotes(e.target.value)}
            rows={4}
            style={{
              resize: "vertical",
              padding: "8px 10px",
              borderRadius: "var(--radius-control)",
              background: "var(--surface-inset)",
              border: "1px solid var(--control-border)",
              color: "var(--text-primary)",
              fontFamily: "var(--font-sans)",
              fontSize: "var(--size-body-sm)",
              opacity: canManage ? 1 : 0.45,
            }}
          />
        </label>
        {canManage && (
          <Button size="sm" variant="primary" disabled={pending || !name.trim()} onClick={save} style={{ justifySelf: "start" }}>
            {pending ? "Saving…" : "Save"}
          </Button>
        )}
      </div>
    </Card>
  );
}
