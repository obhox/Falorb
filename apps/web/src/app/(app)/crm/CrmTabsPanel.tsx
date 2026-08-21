"use client";

import { useState } from "react";
import Link from "next/link";
import { Badge, Button, Card, DataTable, Dialog, Input, Select, Tabs } from "@falorb/ui";
import { Empty } from "@/components/Empty";
import { relative } from "@/lib/format";
import { useAction } from "@/lib/use-action";
import {
  createCrmContact,
  createDeal,
  promoteLinkiContact,
  updateCrmProfile,
  updateDeal,
} from "@/server/actions/crm";

export interface CrmProfileRow {
  id: string;
  personId: string;
  personName: string | null;
  personEmail: string | null;
  title: string | null;
  phone: string | null;
  status: string;
  ownerId: string | null;
  ownerName: string | null;
  linkedToLinki: boolean;
  updatedAt: string;
}

export interface DealRow {
  id: string;
  name: string;
  personId: string | null;
  personName: string | null;
  stageId: string | null;
  stageName: string | null;
  isWon: boolean | null;
  isLost: boolean | null;
  amount: string | null;
  currency: string | null;
  ownerName: string | null;
  updatedAt: string;
}

export interface StageRow {
  id: string;
  name: string;
  position: number;
  isWon: boolean;
  isLost: boolean;
}

export interface OwnerOption {
  id: string;
  name: string;
}

export interface UnmatchedContactRow {
  id: string;
  fullName: string | null;
  email: string | null;
  company: string | null;
  linkedinUrl: string | null;
  syncedAt: string;
}

export interface WorkflowRow {
  id: string;
  linkiId: string;
  name: string;
  description: string | null;
}

export interface ListRow {
  id: string;
  name: string;
  purpose: string | null;
  memberCount: number;
}

export interface SignalRuleRow {
  id: string;
  name: string;
  signalType: string;
  minScore: string;
  workflowLinkiId: string | null;
  enabled: boolean;
  autoStart: boolean;
}

export interface RunRow {
  id: string;
  status: string | null;
  workflowName: string | null;
  listName: string | null;
  startedAt: string | null;
  completedAt: string | null;
  trackCount: number;
}

export interface SentMessageRow {
  id: string;
  recipient: string | null;
  subject: string | null;
  status: string | null;
  contactId: string | null;
  contactName: string | null;
  syncedAt: string;
}

export interface SuppressionRow {
  id: string;
  kind: string;
  value: string;
  reason: string | null;
  syncedAt: string;
}

const STATUSES = ["lead", "prospect", "customer", "churned"];
const UNASSIGNED = "Unassigned";

const RUN_STATUS_TONE: Record<string, "up" | "down" | "warn" | "neutral"> = {
  completed: "up",
  sent: "up",
  delivered: "up",
  replied: "up",
  failed: "down",
  error: "down",
  bounced: "down",
  complained: "down",
  pending: "warn",
  in_progress: "warn",
};

function runStatusTone(value: string | null): "up" | "down" | "warn" | "neutral" {
  if (!value) return "neutral";
  return RUN_STATUS_TONE[value.toLowerCase()] ?? "neutral";
}

function ConnectLinkiPrompt({ what }: { what: string }) {
  return (
    <Empty
      dense
      icon="plug"
      title="Linki isn't connected"
      body={`Connect it to see ${what} here.`}
      action={
        <Link href="/settings/integrations" style={{ textDecoration: "none" }}>
          Connect in Settings → Integrations
        </Link>
      }
    />
  );
}

export function CrmTabsPanel({
  connected,
  profiles,
  deals,
  stages,
  owners,
  unmatchedContacts,
  workflows,
  lists,
  signalRules,
  runs,
  sentMessages,
  suppressions,
  now,
}: {
  connected: boolean;
  profiles: CrmProfileRow[];
  deals: DealRow[];
  stages: StageRow[];
  owners: OwnerOption[];
  unmatchedContacts: UnmatchedContactRow[];
  workflows: WorkflowRow[];
  lists: ListRow[];
  signalRules: SignalRuleRow[];
  runs: RunRow[];
  sentMessages: SentMessageRow[];
  suppressions: SuppressionRow[];
  now: number;
}) {
  const [tab, setTab] = useState("contacts");
  const { run, pending } = useAction();

  const [editingProfile, setEditingProfile] = useState<CrmProfileRow | null>(null);
  const [newDealOpen, setNewDealOpen] = useState(false);
  const [newContactOpen, setNewContactOpen] = useState(false);

  const ownerName = new Map(owners.map((o) => [o.id, o.name]));
  const stageName = new Map(stages.map((s) => [s.id, s.name]));
  const stageByName = new Map(stages.map((s) => [s.name, s]));
  const ownerByName = new Map(owners.map((o) => [o.name, o]));
  const sortedStages = [...stages].sort((a, b) => a.position - b.position);
  const workflowNames = new Map(workflows.map((w) => [w.linkiId, w.name]));

  return (
    <div style={{ display: "grid", gap: "var(--space-5)" }}>
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "contacts", label: "Contacts", count: profiles.length },
          { value: "pipeline", label: "Pipeline", count: deals.length },
          { value: "from-linki", label: "From Linki", count: unmatchedContacts.length },
          { value: "workflows", label: "Workflows & lists", count: workflows.length + lists.length },
          { value: "signals", label: "Signal rules", count: signalRules.length },
          { value: "runs", label: "Runs", count: runs.length },
          { value: "sent", label: "Sent messages", count: sentMessages.length },
          { value: "suppressions", label: "Suppressions", count: suppressions.length },
        ]}
      />

      {tab === "contacts" && (
        <Card
          title="Contacts"
          subtitle="Falorb's own CRM — people deliberately added, not every visitor"
          action={
            <Button size="sm" variant="primary" onClick={() => setNewContactOpen(true)}>
              Add contact
            </Button>
          }
        >
          <DataTable
            dense
            columns={[
              {
                key: "name",
                header: "Name",
                width: "minmax(160px, 1.2fr)",
                render: (row: CrmProfileRow) => (
                  <Link href={`/people/${row.personId}`} data-plain style={{ color: "var(--text-primary)" }}>
                    {row.personName ?? row.personEmail ?? "—"}
                  </Link>
                ),
              },
              { key: "email", header: "Email", width: "minmax(140px, 1fr)", render: (r: CrmProfileRow) => r.personEmail ?? "—" },
              { key: "title", header: "Title", width: "minmax(110px, 1fr)", render: (r: CrmProfileRow) => r.title ?? "—" },
              { key: "phone", header: "Phone", width: "minmax(110px, 1fr)", render: (r: CrmProfileRow) => r.phone ?? "—" },
              {
                key: "status",
                header: "Status",
                width: "110px",
                render: (r: CrmProfileRow) => (
                  <Badge tone={r.status === "customer" ? "up" : r.status === "churned" ? "down" : "neutral"}>{r.status}</Badge>
                ),
              },
              { key: "owner", header: "Owner", width: "minmax(100px, 1fr)", render: (r: CrmProfileRow) => r.ownerName ?? "—" },
              {
                key: "linked",
                header: "Linki",
                width: "90px",
                render: (r: CrmProfileRow) => (r.linkedToLinki ? <Badge tone="up">linked</Badge> : <Badge tone="neutral">no</Badge>),
              },
              {
                key: "updatedAt",
                header: "Updated",
                width: "90px",
                align: "right",
                mono: true,
                render: (r: CrmProfileRow) => relative(r.updatedAt, now),
              },
              {
                key: "actions",
                header: "",
                width: "70px",
                align: "right",
                render: (r: CrmProfileRow) => (
                  <Button size="sm" onClick={() => setEditingProfile(r)}>
                    Edit
                  </Button>
                ),
              },
            ]}
            rows={profiles}
            emptyState={
              <Empty
                dense
                icon="users"
                title="Nobody's in the CRM yet"
                body="Add a contact directly, add a person from their profile, or bring in an existing Linki contact from the “From Linki” tab."
              />
            }
          />
        </Card>
      )}

      {tab === "pipeline" && (
        <Card
          title="Pipeline"
          subtitle="Falorb-owned deals"
          action={
            <Button size="sm" variant="primary" disabled={!profiles.length} onClick={() => setNewDealOpen(true)}>
              New deal
            </Button>
          }
        >
          <DataTable
            dense
            columns={[
              {
                key: "name",
                header: "Deal",
                width: "minmax(150px, 1.2fr)",
                render: (r: DealRow) => (
                  <Link href={`/crm/deals/${r.id}`} data-plain style={{ color: "var(--text-primary)" }}>
                    {r.name}
                  </Link>
                ),
              },
              {
                key: "person",
                header: "Contact",
                width: "minmax(120px, 1fr)",
                render: (r: DealRow) =>
                  r.personId ? (
                    <Link href={`/people/${r.personId}`} data-plain style={{ color: "var(--text-primary)" }}>
                      {r.personName ?? "—"}
                    </Link>
                  ) : (
                    "—"
                  ),
              },
              {
                key: "stage",
                header: "Stage",
                width: "150px",
                render: (r: DealRow) => (
                  <Select
                    size="sm"
                    value={r.stageId ? (stageName.get(r.stageId) ?? "—") : "—"}
                    options={sortedStages.map((s) => s.name)}
                    onChange={(label: string) => {
                      const stage = stageByName.get(label);
                      if (!stage || stage.id === r.stageId) return;
                      const data = new FormData();
                      data.set("stage_id", stage.id);
                      void run(() => updateDeal(r.id, data), { success: `Moved to ${stage.name}.` });
                    }}
                  />
                ),
              },
              {
                key: "amount",
                header: "Amount",
                width: "110px",
                align: "right",
                mono: true,
                render: (r: DealRow) => (r.amount ? `${r.currency ?? ""} ${r.amount}` : "—"),
              },
              {
                key: "owner",
                header: "Owner",
                width: "140px",
                render: (r: DealRow) => (
                  <Select
                    size="sm"
                    value={r.ownerName ?? UNASSIGNED}
                    options={[UNASSIGNED, ...owners.map((o) => o.name)]}
                    onChange={(label: string) => {
                      const owner = label === UNASSIGNED ? null : (ownerByName.get(label) ?? null);
                      const data = new FormData();
                      data.set("owner_id", owner?.id ?? "");
                      void run(() => updateDeal(r.id, data), { success: "Owner updated." });
                    }}
                  />
                ),
              },
              {
                key: "updatedAt",
                header: "Updated",
                width: "90px",
                align: "right",
                mono: true,
                render: (r: DealRow) => relative(r.updatedAt, now),
              },
            ]}
            rows={deals}
            emptyState={
              <Empty
                dense
                icon="target"
                title="No deals yet"
                body={profiles.length ? "Create one from the button above." : "Add a contact to the CRM first."}
              />
            }
          />
        </Card>
      )}

      {tab === "from-linki" &&
        (connected ? (
          <Card
            title="From Linki"
            subtitle="Existing Linki contacts not yet brought into Falorb's CRM"
            action={
              <Link href="/crm/contacts" data-plain style={{ fontSize: "var(--size-label)", color: "var(--accent)" }}>
                View all contacts →
              </Link>
            }
          >
            <DataTable
              dense
              columns={[
                { key: "fullName", header: "Name", width: "minmax(150px, 1.2fr)", render: (r: UnmatchedContactRow) => r.fullName ?? r.email ?? "—" },
                { key: "email", header: "Email", width: "minmax(140px, 1fr)", render: (r: UnmatchedContactRow) => r.email ?? "—" },
                { key: "company", header: "Company", width: "minmax(120px, 1fr)", render: (r: UnmatchedContactRow) => r.company ?? "—" },
                {
                  key: "syncedAt",
                  header: "Synced",
                  width: "90px",
                  align: "right",
                  mono: true,
                  render: (r: UnmatchedContactRow) => relative(r.syncedAt, now),
                },
                {
                  key: "actions",
                  header: "",
                  width: "110px",
                  align: "right",
                  render: (r: UnmatchedContactRow) => (
                    <Button
                      size="sm"
                      variant="primary"
                      disabled={pending}
                      onClick={() => void run(() => promoteLinkiContact(r.id), { success: "Added to CRM." })}
                    >
                      Add to CRM
                    </Button>
                  ),
                },
              ]}
              rows={unmatchedContacts}
              emptyState={<Empty dense icon="users" title="Nothing to bring in" body="Every synced Linki contact is already matched to a Falorb person." />}
            />
          </Card>
        ) : (
          <ConnectLinkiPrompt what="Linki contacts waiting to be brought into the CRM" />
        ))}

      {tab === "workflows" &&
        (connected ? (
          <div style={{ display: "grid", gap: "var(--space-5)" }}>
            <Card title="Workflows" subtitle={`${workflows.length} in Linki`}>
              <DataTable
                dense
                columns={[
                  { key: "name", header: "Name", width: "minmax(160px, 1.2fr)", render: (r: WorkflowRow) => r.name },
                  { key: "description", header: "Description", width: "minmax(200px, 2fr)", render: (r: WorkflowRow) => r.description ?? "—" },
                ]}
                rows={workflows}
                emptyState={<Empty dense icon="workflow" title="No workflows yet" body="Nothing has synced yet." />}
              />
            </Card>
            <Card title="Lists" subtitle={`${lists.length} in Linki`}>
              <DataTable
                dense
                columns={[
                  { key: "name", header: "Name", width: "minmax(160px, 1.2fr)", render: (r: ListRow) => r.name },
                  { key: "purpose", header: "Purpose", width: "110px", render: (r: ListRow) => r.purpose ?? "—" },
                  { key: "memberCount", header: "Members", width: "90px", align: "right", mono: true, render: (r: ListRow) => r.memberCount },
                ]}
                rows={lists}
                emptyState={<Empty dense icon="list" title="No lists yet" body="Nothing has synced yet." />}
              />
            </Card>
          </div>
        ) : (
          <ConnectLinkiPrompt what="workflows and lists" />
        ))}

      {tab === "signals" &&
        (connected ? (
          <Card
            title="Signal rules"
            subtitle="Read-only — configured in Linki. Shows which workflow a signal will trigger, and whether it fires unattended"
          >
            <DataTable
              dense
              columns={[
                { key: "name", header: "Rule", width: "minmax(140px, 1fr)", render: (r: SignalRuleRow) => r.name },
                { key: "signalType", header: "Signal type", width: "120px", render: (r: SignalRuleRow) => r.signalType },
                { key: "minScore", header: "Min score", width: "90px", align: "right", mono: true, render: (r: SignalRuleRow) => r.minScore },
                {
                  key: "workflow",
                  header: "Workflow",
                  width: "minmax(140px, 1fr)",
                  render: (r: SignalRuleRow) => (r.workflowLinkiId ? (workflowNames.get(r.workflowLinkiId) ?? r.workflowLinkiId) : "—"),
                },
                {
                  key: "autoStart",
                  header: "Auto-start",
                  width: "100px",
                  render: (r: SignalRuleRow) =>
                    r.autoStart ? <Badge tone="warn">fires unattended</Badge> : <Badge tone="neutral">manual only</Badge>,
                },
                {
                  key: "enabled",
                  header: "Enabled",
                  width: "90px",
                  render: (r: SignalRuleRow) => (r.enabled ? <Badge tone="up">on</Badge> : <Badge tone="neutral">off</Badge>),
                },
              ]}
              rows={signalRules}
              emptyState={<Empty dense icon="zap" title="No signal rules" body="Configure these in Linki, not here." />}
            />
          </Card>
        ) : (
          <ConnectLinkiPrompt what="signal rules" />
        ))}

      {tab === "runs" &&
        (connected ? (
          <Card title="Runs" subtitle="Workflow executions synced from Linki">
            <DataTable
              dense
              columns={[
                {
                  key: "workflow",
                  header: "Workflow",
                  width: "minmax(140px, 1.2fr)",
                  render: (r: RunRow) => (
                    <Link href={`/crm/runs/${r.id}`} data-plain style={{ color: "var(--text-primary)" }}>
                      {r.workflowName ?? "—"}
                    </Link>
                  ),
                },
                { key: "list", header: "List", width: "minmax(120px, 1fr)", render: (r: RunRow) => r.listName ?? "—" },
                {
                  key: "status",
                  header: "Status",
                  width: "110px",
                  render: (r: RunRow) => <Badge tone={runStatusTone(r.status)}>{r.status ?? "—"}</Badge>,
                },
                { key: "targets", header: "Targets", width: "80px", align: "right", mono: true, render: (r: RunRow) => r.trackCount },
                {
                  key: "startedAt",
                  header: "Started",
                  width: "90px",
                  align: "right",
                  mono: true,
                  render: (r: RunRow) => (r.startedAt ? relative(r.startedAt, now) : "—"),
                },
                {
                  key: "completedAt",
                  header: "Completed",
                  width: "90px",
                  align: "right",
                  mono: true,
                  render: (r: RunRow) => (r.completedAt ? relative(r.completedAt, now) : "—"),
                },
              ]}
              rows={runs}
              emptyState={<Empty dense icon="workflow" title="No runs yet" body="Nothing has synced yet." />}
            />
          </Card>
        ) : (
          <ConnectLinkiPrompt what="workflow runs" />
        ))}

      {tab === "sent" &&
        (connected ? (
          <Card title="Sent messages" subtitle="Delivery status for messages sent through Linki">
            <DataTable
              dense
              columns={[
                {
                  key: "recipient",
                  header: "Recipient",
                  width: "minmax(150px, 1.2fr)",
                  render: (r: SentMessageRow) =>
                    r.contactId ? (
                      <Link href={`/crm/contacts/${r.contactId}`} data-plain style={{ color: "var(--text-primary)" }}>
                        {r.contactName ?? r.recipient ?? "—"}
                      </Link>
                    ) : (
                      r.recipient ?? "—"
                    ),
                },
                { key: "subject", header: "Subject", width: "minmax(160px, 1.6fr)", render: (r: SentMessageRow) => r.subject ?? "—" },
                {
                  key: "status",
                  header: "Status",
                  width: "110px",
                  render: (r: SentMessageRow) => <Badge tone={runStatusTone(r.status)}>{r.status ?? "—"}</Badge>,
                },
                {
                  key: "syncedAt",
                  header: "Synced",
                  width: "90px",
                  align: "right",
                  mono: true,
                  render: (r: SentMessageRow) => relative(r.syncedAt, now),
                },
              ]}
              rows={sentMessages}
              emptyState={<Empty dense icon="mail" title="No messages yet" body="Nothing has synced yet." />}
            />
          </Card>
        ) : (
          <ConnectLinkiPrompt what="sent messages" />
        ))}

      {tab === "suppressions" &&
        (connected ? (
          <Card title="Suppressions" subtitle="Do-not-contact list, mirrored from Linki — read-only">
            <DataTable
              dense
              columns={[
                { key: "value", header: "Value", width: "minmax(160px, 1.4fr)", mono: true, render: (r: SuppressionRow) => r.value },
                { key: "kind", header: "Kind", width: "100px", render: (r: SuppressionRow) => r.kind },
                { key: "reason", header: "Reason", width: "minmax(140px, 1.2fr)", render: (r: SuppressionRow) => r.reason ?? "—" },
                {
                  key: "syncedAt",
                  header: "Synced",
                  width: "90px",
                  align: "right",
                  mono: true,
                  render: (r: SuppressionRow) => relative(r.syncedAt, now),
                },
              ]}
              rows={suppressions}
              emptyState={<Empty dense icon="shield" title="No suppressions" body="Nobody is on the do-not-contact list." />}
            />
          </Card>
        ) : (
          <ConnectLinkiPrompt what="suppressions" />
        ))}

      {editingProfile && (
        <EditProfileDialog
          profile={editingProfile}
          owners={owners}
          pending={pending}
          onClose={() => setEditingProfile(null)}
          onSave={async (formData) => {
            const result = await run(() => updateCrmProfile(editingProfile.personId, formData), {
              success: "Profile updated.",
            });
            if (result?.ok) setEditingProfile(null);
          }}
        />
      )}

      {newDealOpen && (
        <NewDealDialog
          profiles={profiles}
          stages={sortedStages}
          pending={pending}
          onClose={() => setNewDealOpen(false)}
          onSave={async (personId, formData) => {
            const result = await run(() => createDeal(personId, formData), { success: "Deal created." });
            if (result?.ok) setNewDealOpen(false);
          }}
        />
      )}

      {newContactOpen && (
        <NewContactDialog
          pending={pending}
          onClose={() => setNewContactOpen(false)}
          onSave={async (formData) => {
            const result = await run(() => createCrmContact(formData), { success: "Contact added." });
            if (result?.ok) setNewContactOpen(false);
          }}
        />
      )}
    </div>
  );
}

export function EditProfileDialog({
  profile,
  owners,
  pending,
  onClose,
  onSave,
}: {
  profile: CrmProfileRow;
  owners: OwnerOption[];
  pending: boolean;
  onClose: () => void;
  onSave: (formData: FormData) => void;
}) {
  const [title, setTitle] = useState(profile.title ?? "");
  const [phone, setPhone] = useState(profile.phone ?? "");
  const [status, setStatus] = useState(profile.status);
  const [owner, setOwner] = useState(profile.ownerName ?? UNASSIGNED);

  return (
    <Dialog
      title={profile.personName ?? profile.personEmail ?? "Edit contact"}
      subtitle="CRM profile"
      onClose={onClose}
      footer={
        <>
          <Button size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            variant="primary"
            disabled={pending}
            onClick={() => {
              const data = new FormData();
              data.set("title", title);
              data.set("phone", phone);
              data.set("status", status);
              const ownerOpt = owners.find((o) => o.name === owner);
              data.set("owner_id", ownerOpt?.id ?? "");
              onSave(data);
            }}
          >
            {pending ? "Saving…" : "Save"}
          </Button>
        </>
      }
    >
      <div style={{ display: "grid", gap: 10 }}>
        <Input label="Title" value={title} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTitle(e.target.value)} />
        <Input label="Phone" value={phone} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPhone(e.target.value)} />
        <Select label="Status" value={status} options={STATUSES} onChange={setStatus} />
        <Select label="Owner" value={owner} options={[UNASSIGNED, ...owners.map((o) => o.name)]} onChange={setOwner} />
      </div>
    </Dialog>
  );
}

function NewContactDialog({
  pending,
  onClose,
  onSave,
}: {
  pending: boolean;
  onClose: () => void;
  onSave: (formData: FormData) => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [title, setTitle] = useState("");
  const [phone, setPhone] = useState("");
  const [status, setStatus] = useState(STATUSES[0]!);
  const [notes, setNotes] = useState("");

  return (
    <Dialog
      title="Add contact"
      subtitle="Not in analytics or Linki yet — added by hand"
      onClose={onClose}
      footer={
        <>
          <Button size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            variant="primary"
            disabled={pending || !email.trim()}
            onClick={() => {
              const data = new FormData();
              data.set("name", name);
              data.set("email", email);
              data.set("title", title);
              data.set("phone", phone);
              data.set("status", status);
              data.set("notes", notes);
              onSave(data);
            }}
          >
            {pending ? "Adding…" : "Add contact"}
          </Button>
        </>
      }
    >
      <div style={{ display: "grid", gap: 10 }}>
        <Input label="Name" value={name} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)} placeholder="Full name" />
        <Input
          label="Email"
          value={email}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)}
          placeholder="name@company.com"
          hint="Required — this is how a matching Linki contact's emails and campaigns link up later."
        />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <Input label="Title" value={title} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTitle(e.target.value)} />
          <Input label="Phone" value={phone} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPhone(e.target.value)} />
        </div>
        <Select label="Status" value={status} options={STATUSES} onChange={setStatus} />
        <Input label="Notes" value={notes} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNotes(e.target.value)} />
      </div>
    </Dialog>
  );
}

function NewDealDialog({
  profiles,
  stages,
  pending,
  onClose,
  onSave,
}: {
  profiles: CrmProfileRow[];
  stages: StageRow[];
  pending: boolean;
  onClose: () => void;
  onSave: (personId: string, formData: FormData) => void;
}) {
  const personLabel = (p: CrmProfileRow) => p.personName ?? p.personEmail ?? p.personId;
  const [personId, setPersonId] = useState(profiles[0]?.personId ?? "");
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [stageId, setStageId] = useState(stages[0]?.id ?? "");
  const [source, setSource] = useState("");

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
            disabled={pending || !personId || !name.trim()}
            onClick={() => {
              const data = new FormData();
              data.set("name", name);
              data.set("amount", amount);
              data.set("currency", currency);
              data.set("stage_id", stageId);
              data.set("source", source);
              onSave(personId, data);
            }}
          >
            {pending ? "Creating…" : "Create deal"}
          </Button>
        </>
      }
    >
      <div style={{ display: "grid", gap: 10 }}>
        <Select
          label="Contact"
          value={profiles.find((p) => p.personId === personId) ? personLabel(profiles.find((p) => p.personId === personId)!) : ""}
          options={profiles.map(personLabel)}
          onChange={(label: string) => {
            const match = profiles.find((p) => personLabel(p) === label);
            if (match) setPersonId(match.personId);
          }}
        />
        <Input label="Deal name" value={name} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)} placeholder="e.g. Annual plan" />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 100px", gap: 10 }}>
          <Input label="Amount" value={amount} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAmount(e.target.value)} placeholder="0" />
          <Input label="Currency" value={currency} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCurrency(e.target.value)} />
        </div>
        {stages.length > 0 && (
          <Select label="Stage" value={stageNameFor(stageId)} options={stages.map((s) => s.name)} onChange={(label: string) => {
            const match = stages.find((s) => s.name === label);
            if (match) setStageId(match.id);
          }} />
        )}
        <Input label="Source" value={source} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSource(e.target.value)} placeholder="e.g. Referral, conference" />
      </div>
    </Dialog>
  );
}
