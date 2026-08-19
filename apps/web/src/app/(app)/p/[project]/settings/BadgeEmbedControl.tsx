"use client";

import { useState } from "react";
import { Button, Card, Icon } from "@falorb/ui";
import { CopyField } from "@/components/CopyField";
import { createShareLink } from "@/server/actions/sharing";
import { useAction } from "@/lib/use-action";

/**
 * Embeddable "trusted by N people" badge snippet.
 *
 * Rides the same public-link token as the `/share/[token]` summary page
 * rather than minting a second capability — one token, two surfaces, one
 * place to revoke. If the property has never been shared, this offers the
 * same `createShareLink` action the Public link card above uses, so there is
 * exactly one path to "this property now has a live token," not two share
 * systems that can drift apart.
 */
export function BadgeEmbedControl({
  slug,
  initialToken,
  origin,
}: {
  slug: string;
  initialToken: string | null;
  origin: string;
}) {
  const [token, setToken] = useState(initialToken);
  const { run, pending } = useAction();

  async function create() {
    const result = await run(() => createShareLink(slug));
    if (result?.ok && result.url) {
      setToken(new URL(result.url).pathname.replace(/^\/share\//, ""));
    }
  }

  const snippet = token
    ? `<iframe src="${origin}/badge/${token}" width="300" height="100" frameborder="0"></iframe>`
    : "";

  return (
    <Card
      title="Embeddable badge"
      subtitle="A small live-visitor widget for your own site — a backlink to Falorb comes with it"
    >
      <div style={{ display: "grid", gap: "var(--space-7)" }}>
        {token ? (
          <CopyField value={snippet} />
        ) : (
          <div>
            <p
              style={{
                fontSize: "var(--size-micro)",
                color: "var(--text-muted)",
                maxWidth: "66ch",
                lineHeight: "var(--lh-normal)",
                marginBottom: "var(--space-4)",
              }}
            >
              The badge reads the same token as the public link above, so create that first.
            </p>
            <Button
              size="sm"
              variant="primary"
              onClick={create}
              disabled={pending}
              iconLeft={<Icon name="link" size={13} />}
            >
              {pending ? "Creating" : "Create public link"}
            </Button>
          </div>
        )}

        <div
          style={{
            display: "grid",
            gap: 6,
            padding: "var(--space-5) var(--space-6)",
            borderRadius: "var(--radius-3)",
            background: "var(--surface-inset)",
            border: "1px solid var(--border-subtle)",
          }}
        >
          <span
            style={{
              fontSize: "var(--size-micro)",
              textTransform: "uppercase",
              letterSpacing: "var(--ls-label)",
              color: "var(--text-muted)",
              fontWeight: "var(--wt-medium)",
            }}
          >
            What it shows
          </span>
          <span style={{ fontSize: "var(--size-micro)", color: "var(--text-body)", lineHeight: "var(--lh-normal)" }}>
            Unique visitors over the last 30 days, and a live count when anyone is on the site
            right now — the same audience the public link exposes, nothing more. Revoking the
            public link above breaks the badge too, since it is the same token.
          </span>
        </div>
      </div>
    </Card>
  );
}
