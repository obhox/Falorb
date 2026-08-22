"use client";

import { useEffect, useState } from "react";
import { Badge, Button, Card, Dialog, Icon, Input, Select } from "@falorb/ui";
import { useAction } from "@/lib/use-action";
import { relative } from "@/lib/format";
import { archiveEmailAccount, composeEmail, createEmailAccount, listMigaduDomains } from "@/server/actions/email";

export interface EmailAccountView {
  id: string;
  address: string;
  domain: string;
  name: string | null;
  status: "active" | "error" | "archived";
  lastError: string | null;
  lastSyncedAt: string | null;
}

export interface EmailMessageView {
  id: string;
  emailAccountId: string;
  direction: "inbound" | "outbound";
  messageId: string | null;
  inReplyTo: string | null;
  fromAddress: string | null;
  toAddresses: string[];
  subject: string | null;
  textBody: string | null;
  receivedAt: string | null;
}

interface Thread {
  key: string;
  otherAddress: string;
  subject: string;
  messages: EmailMessageView[];
}

/**
 * Same grouping rule as `groupIntoThreads` in `@/server/email` — kept as a
 * separate client-safe copy rather than shared, since that module is marked
 * `server-only` (it reads the database) and this component only ever
 * receives already-serialized messages as props.
 */
function groupThreads(messages: EmailMessageView[]): Thread[] {
  const threads = new Map<string, Thread>();
  for (const message of messages) {
    const otherAddress =
      message.direction === "outbound" ? message.toAddresses[0] ?? "unknown" : message.fromAddress ?? "unknown";
    const subject = (message.subject ?? "").replace(/^\s*(re|fwd?)\s*:\s*/i, "").trim();
    const key = `${otherAddress.toLowerCase()}::${subject.toLowerCase()}`;
    const existing = threads.get(key);
    if (existing) existing.messages.push(message);
    else threads.set(key, { key, otherAddress, subject: subject || "(no subject)", messages: [message] });
  }
  for (const thread of threads.values()) {
    thread.messages.sort((a, b) => (a.receivedAt ? Date.parse(a.receivedAt) : 0) - (b.receivedAt ? Date.parse(b.receivedAt) : 0));
  }
  return Array.from(threads.values()).sort((a, b) => {
      const latest = (t: Thread) => (t.messages.at(-1)?.receivedAt ? Date.parse(t.messages.at(-1)!.receivedAt!) : 0);
      return latest(b) - latest(a);
    });
}

export function EmailPanel({
  accounts,
  messages,
  now,
}: {
  accounts: EmailAccountView[];
  messages: EmailMessageView[];
  now: number;
}) {
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(accounts[0]?.id ?? null);
  const [selectedThreadKey, setSelectedThreadKey] = useState<string | null>(null);
  const [newMailboxOpen, setNewMailboxOpen] = useState(false);

  const selectedAccount = accounts.find((a) => a.id === selectedAccountId) ?? null;
  const accountMessages = messages.filter((m) => m.emailAccountId === selectedAccountId);
  const threads = selectedAccount ? groupThreads(accountMessages) : [];
  const selectedThread = threads.find((t) => t.key === selectedThreadKey) ?? null;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: "var(--space-6)", alignItems: "start" }}>
      <Card
        title="Mailboxes"
        action={
          <Button size="sm" variant="primary" iconLeft={<Icon name="plus" size={13} />} onClick={() => setNewMailboxOpen(true)}>
            New
          </Button>
        }
      >
        {accounts.length === 0 ? (
          <p style={{ fontSize: "var(--size-body-sm)", color: "var(--text-secondary)", margin: 0 }}>
            No mailboxes yet.
          </p>
        ) : (
          <div style={{ display: "grid", gap: 4 }}>
            {accounts.map((a) => (
              <MailboxRow
                key={a.id}
                account={a}
                selected={a.id === selectedAccountId}
                now={now}
                onSelect={() => {
                  setSelectedAccountId(a.id);
                  setSelectedThreadKey(null);
                }}
              />
            ))}
          </div>
        )}
      </Card>

      {selectedAccount ? (
        <div style={{ display: "grid", gap: "var(--space-6)" }}>
          {selectedThread ? (
            <ThreadView
              account={selectedAccount}
              thread={selectedThread}
              now={now}
              onBack={() => setSelectedThreadKey(null)}
            />
          ) : (
            <ThreadListAndCompose
              account={selectedAccount}
              threads={threads}
              now={now}
              onOpenThread={(key) => setSelectedThreadKey(key)}
            />
          )}
        </div>
      ) : (
        <Card title="No mailbox selected">
          <p style={{ fontSize: "var(--size-body-sm)", color: "var(--text-secondary)", margin: 0 }}>
            Create a mailbox to start sending.
          </p>
        </Card>
      )}

      <NewMailboxDialog open={newMailboxOpen} onClose={() => setNewMailboxOpen(false)} />
    </div>
  );
}

function MailboxRow({
  account,
  selected,
  now,
  onSelect,
}: {
  account: EmailAccountView;
  selected: boolean;
  now: number;
  onSelect: () => void;
}) {
  const { run, pending } = useAction();
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
        padding: "8px 10px",
        borderRadius: "var(--radius-3)",
        background: selected ? "var(--surface-selected)" : "transparent",
        cursor: "pointer",
      }}
      onClick={onSelect}
    >
      <div style={{ display: "grid", gap: 2, minWidth: 0 }}>
        <span
          style={{
            fontSize: "var(--size-body-sm)",
            fontFamily: "var(--font-mono)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {account.address}
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <Badge tone={account.status === "active" ? "up" : account.status === "error" ? "down" : "neutral"}>
            {account.status}
          </Badge>
          <span style={{ fontSize: "var(--size-micro)", color: "var(--text-muted)" }}>
            {account.lastSyncedAt ? relative(account.lastSyncedAt, now) : "never synced"}
          </span>
        </div>
      </div>
      <Button
        size="sm"
        variant="danger"
        disabled={pending}
        onClick={(e: React.MouseEvent) => {
          e.stopPropagation();
          void run(() => archiveEmailAccount(account.id));
        }}
      >
        Delete
      </Button>
    </div>
  );
}

function ThreadListAndCompose({
  account,
  threads,
  now,
  onOpenThread,
}: {
  account: EmailAccountView;
  threads: Thread[];
  now: number;
  onOpenThread: (key: string) => void;
}) {
  return (
    <>
      <ComposeCard account={account} inReplyTo={null} defaultTo="" defaultSubject="" onSent={() => {}} />
      <Card title="Threads" subtitle={`${threads.length} conversation${threads.length === 1 ? "" : "s"}`}>
        {threads.length === 0 ? (
          <p style={{ fontSize: "var(--size-body-sm)", color: "var(--text-secondary)", margin: 0 }}>
            Nothing yet — sent and received messages for this mailbox show up here.
          </p>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {threads.map((t) => {
              const last = t.messages.at(-1)!;
              return (
                <div
                  key={t.key}
                  onClick={() => onOpenThread(t.key)}
                  style={{
                    display: "grid",
                    gap: 4,
                    padding: "8px 10px",
                    borderRadius: "var(--radius-3)",
                    border: "1px solid var(--border-subtle)",
                    cursor: "pointer",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                    <strong style={{ fontSize: "var(--size-body-sm)" }}>{t.otherAddress}</strong>
                    <span style={{ fontSize: "var(--size-micro)", color: "var(--text-muted)" }}>
                      {last.receivedAt ? relative(last.receivedAt, now) : ""}
                    </span>
                  </div>
                  <span style={{ fontSize: "var(--size-body-sm)", color: "var(--text-secondary)" }}>{t.subject}</span>
                  <span style={{ fontSize: "var(--size-micro)", color: "var(--text-muted)" }}>
                    {t.messages.length} message{t.messages.length === 1 ? "" : "s"}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </>
  );
}

function ThreadView({
  account,
  thread,
  now,
  onBack,
}: {
  account: EmailAccountView;
  thread: Thread;
  now: number;
  onBack: () => void;
}) {
  const lastInbound = [...thread.messages].reverse().find((m) => m.direction === "inbound");
  return (
    <>
      <Button size="sm" onClick={onBack}>
        ← Back to threads
      </Button>
      <Card title={thread.subject} subtitle={thread.otherAddress}>
        <div style={{ display: "grid", gap: 12 }}>
          {thread.messages.map((m) => (
            <div
              key={m.id}
              style={{
                display: "grid",
                gap: 4,
                padding: 10,
                borderRadius: "var(--radius-3)",
                background: m.direction === "outbound" ? "var(--surface-inset)" : "transparent",
                border: "1px solid var(--border-subtle)",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <span style={{ fontSize: "var(--size-micro)", fontWeight: "var(--wt-medium)" }}>
                  {m.direction === "outbound" ? account.address : m.fromAddress}
                </span>
                <span style={{ fontSize: "var(--size-micro)", color: "var(--text-muted)" }}>
                  {m.receivedAt ? relative(m.receivedAt, now) : ""}
                </span>
              </div>
              <p style={{ fontSize: "var(--size-body-sm)", whiteSpace: "pre-wrap", margin: 0 }}>{m.textBody}</p>
            </div>
          ))}
        </div>
      </Card>
      <ComposeCard
        account={account}
        inReplyTo={lastInbound?.messageId ?? thread.messages.at(-1)?.messageId ?? null}
        defaultTo={thread.otherAddress}
        defaultSubject={thread.subject.startsWith("Re:") ? thread.subject : `Re: ${thread.subject}`}
        onSent={() => {}}
      />
    </>
  );
}

function ComposeCard({
  account,
  inReplyTo,
  defaultTo,
  defaultSubject,
  onSent,
}: {
  account: EmailAccountView;
  inReplyTo: string | null;
  defaultTo: string;
  defaultSubject: string;
  onSent: () => void;
}) {
  const { run, pending } = useAction();
  const [to, setTo] = useState(defaultTo);
  const [subject, setSubject] = useState(defaultSubject);
  const [text, setText] = useState("");

  async function submit() {
    const data = new FormData();
    data.set("accountId", account.id);
    data.set("to", to);
    data.set("subject", subject);
    data.set("text", text);
    if (inReplyTo) data.set("inReplyTo", inReplyTo);
    const result = await run(() => composeEmail(data));
    if (result?.ok) {
      setText("");
      if (!defaultTo) setTo("");
      if (!defaultSubject) setSubject("");
      onSent();
    }
  }

  return (
    <Card title={inReplyTo ? "Reply" : "Compose"} subtitle={`Sending as ${account.address}`}>
      <div style={{ display: "grid", gap: 10 }}>
        {!defaultTo && (
          <Input label="To" value={to} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTo(e.target.value)} placeholder="recipient@example.com" />
        )}
        {!defaultSubject && (
          <Input label="Subject" value={subject} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSubject(e.target.value)} />
        )}
        <label style={{ display: "grid", gap: 6 }}>
          <span style={{ fontSize: "var(--size-label)", color: "var(--text-secondary)", fontWeight: "var(--wt-medium)" }}>
            Message
          </span>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={5}
            style={{
              resize: "vertical",
              padding: "8px 10px",
              borderRadius: "var(--radius-control)",
              background: "var(--surface-inset)",
              border: "1px solid var(--control-border)",
              color: "var(--text-primary)",
              fontFamily: "var(--font-sans)",
              fontSize: "var(--size-body-sm)",
            }}
          />
        </label>
        <Button variant="primary" disabled={pending || !to.trim() || !subject.trim() || !text.trim()} onClick={submit}>
          {pending ? "Sending…" : "Send"}
        </Button>
      </div>
    </Card>
  );
}

function NewMailboxDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { run, pending } = useAction();
  const [domains, setDomains] = useState<string[]>([]);
  const [domain, setDomain] = useState("");
  const [localPart, setLocalPart] = useState("");
  const [name, setName] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    void (async () => {
      const result = await listMigaduDomains();
      if (result.ok) {
        setDomains(result.domains);
        setDomain((prev) => prev || result.domains[0] || "");
        setLoadError(null);
      } else {
        setLoadError(result.message);
      }
    })();
  }, [open]);

  async function submit() {
    const data = new FormData();
    data.set("domain", domain);
    data.set("localPart", localPart);
    data.set("name", name);
    const result = await run(() => createEmailAccount(data));
    if (result?.ok) {
      onClose();
      setLocalPart("");
      setName("");
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="New mailbox"
      subtitle="Provisioned through Migadu — the password is generated and stored, never shown."
      width={480}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit} disabled={pending || !domain || !localPart.trim()}>
            {pending ? "Creating…" : "Create"}
          </Button>
        </>
      }
    >
      <div style={{ display: "grid", gap: "var(--space-6)" }}>
        {loadError && <span style={{ fontSize: "var(--size-body-sm)", color: "var(--signal-down)" }}>{loadError}</span>}
        {domains.length > 0 && (
          <div style={{ display: "grid", gap: 6 }}>
            <span style={{ fontSize: "var(--size-label)", color: "var(--text-secondary)", fontWeight: "var(--wt-medium)" }}>
              Domain
            </span>
            <Select size="sm" value={domain} options={domains} onChange={(v: string) => setDomain(v)} />
          </div>
        )}
        <Input
          label="Mailbox name"
          value={localPart}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setLocalPart(e.target.value.toLowerCase())}
          placeholder="sales"
          hint={domain ? `Creates ${localPart || "…"}@${domain}` : undefined}
        />
        <Input
          label="Display name (optional)"
          value={name}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
          placeholder="Sales"
        />
      </div>
    </Dialog>
  );
}
