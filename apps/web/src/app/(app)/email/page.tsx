import type { Metadata } from "next";
import Link from "next/link";
import { requireSession } from "@/server/session";
import { isMigaduConnected, listEmailAccounts, listEmailMessages } from "@/server/email";
import { PageBody, PageHeader } from "@/components/shell/PageHeader";
import { Empty } from "@/components/Empty";
import { EmailPanel } from "./EmailPanel";

export const metadata: Metadata = { title: "Email" };
export const dynamic = "force-dynamic";

/**
 * Migadu-provisioned mailboxes: create one, send from it, and see replies —
 * the cold-outreach counterpart to `/social`. Outbound messages land here the
 * moment `composeEmail` sends them; inbound ones arrive on
 * `apps/worker/src/jobs/migadu-sync.ts`'s next IMAP poll (every 5 minutes).
 */
export default async function EmailPage() {
  const session = await requireSession();
  const orgId = session.workspace.organizationId;

  const connected = await isMigaduConnected(orgId);
  if (!connected) {
    return (
      <>
        <PageHeader title="Email" meta={session.workspace.organizationName} />
        <PageBody>
          <Empty
            icon="mail"
            title="Migadu isn't connected"
            body="Connect it to provision mailboxes and send from here."
            action={
              <Link href="/settings/integrations" style={{ textDecoration: "none" }}>
                Connect in Settings → Integrations
              </Link>
            }
          />
        </PageBody>
      </>
    );
  }

  const [accounts, messages] = await Promise.all([listEmailAccounts(orgId), listEmailMessages(orgId)]);

  return (
    <>
      <PageHeader title="Email" meta={`${accounts.length} mailbox${accounts.length === 1 ? "" : "es"}`} />
      <PageBody>
        <EmailPanel
          accounts={accounts.map((a) => ({
            id: a.id,
            address: a.address,
            domain: a.domain,
            name: a.name,
            status: a.status,
            lastError: a.lastError,
            lastSyncedAt: a.lastSyncedAt?.toISOString() ?? null,
          }))}
          messages={messages.map((m) => ({
            id: m.id,
            emailAccountId: m.emailAccountId,
            direction: m.direction,
            messageId: m.messageId,
            inReplyTo: m.inReplyTo,
            fromAddress: m.fromAddress,
            toAddresses: m.toAddresses ?? [],
            subject: m.subject,
            textBody: m.textBody,
            receivedAt: m.receivedAt?.toISOString() ?? null,
          }))}
          now={Date.now()}
        />
      </PageBody>
    </>
  );
}
