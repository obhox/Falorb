"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Card, Icon } from "@falorb/ui";
import { CopyField } from "@/components/CopyField";
import { createShareLink, revokeShareLink } from "@/server/actions/sharing";

/**
 * Issue, rotate and revoke this property's public link.
 *
 * The panel states plainly what the link exposes. A share control that just
 * says "Share" leaves the owner to guess whether they are handing over
 * aggregate figures or their visitor list, and people guess generously.
 */
export function ShareControl({ slug, initialUrl }: { slug: string; initialUrl: string | null }) {
  const router = useRouter();
  const [url, setUrl] = useState(initialUrl);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setError(null);
    const result = await createShareLink(slug);
    if (!result.ok) {
      setError(result.message ?? "The link could not be created.");
      return;
    }
    setUrl(result.url);
    startTransition(() => router.refresh());
  }

  async function revoke() {
    setError(null);
    const result = await revokeShareLink(slug);
    if (!result.ok) {
      setError(result.message ?? "The link could not be revoked.");
      return;
    }
    setUrl(null);
    startTransition(() => router.refresh());
  }

  return (
    <Card
      title="Public link"
      subtitle="A read-only summary anyone with the link can open, without an account"
      action={url ? <Badge tone="accent" dot>live</Badge> : undefined}
    >
      <div style={{ display: "grid", gap: "var(--space-7)" }}>
        {url ? (
          <>
            <CopyField value={url} />

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <Button
                size="sm"
                onClick={create}
                disabled={pending}
                iconLeft={<Icon name="refresh-cw" size={13} />}
              >
                Replace link
              </Button>
              <Button
                size="sm"
                variant="danger"
                onClick={revoke}
                disabled={pending}
                iconLeft={<Icon name="link-2-off" size={13} />}
              >
                Revoke
              </Button>
            </div>

            <p style={{ fontSize: "var(--size-micro)", color: "var(--text-muted)", maxWidth: "66ch", lineHeight: "var(--lh-normal)" }}>
              Replacing mints a new link and stops the old one working immediately — use it if a
              link reached someone it should not have.
            </p>
          </>
        ) : (
          <div>
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
            What the link exposes
          </span>
          <span style={{ fontSize: "var(--size-micro)", color: "var(--text-body)", lineHeight: "var(--lh-normal)" }}>
            Visitor, session and pageview totals, the visitor trend, and the top pages, channels
            and countries — for this property only.
          </span>
          <span style={{ fontSize: "var(--size-micro)", color: "var(--text-muted)", lineHeight: "var(--lh-normal)" }}>
            Not exposed: people, sessions, the event stream, your other properties, or any
            settings. The page is marked noindex, but anyone holding the link can open it, so
            treat it as public.
          </span>
        </div>

        {error && (
          <span style={{ fontSize: "var(--size-label)", color: "var(--signal-down)" }}>{error}</span>
        )}
      </div>
    </Card>
  );
}
