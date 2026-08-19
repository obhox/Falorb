"use client";

import { useState } from "react";
import { Badge, Button, Card, Icon } from "@falorb/ui";
import { CopyField } from "@/components/CopyField";
import { createBenchmarkReport, revokeBenchmarkReport } from "@/server/actions/benchmark";
import { useAction } from "@/lib/use-action";

/**
 * Issue, rotate and revoke the organization's public benchmark report.
 *
 * Same shape as `ShareControl` (the per-property version, in
 * `p/[project]/settings`), but scoped to the whole organization and — unlike
 * that page — meant to be found: the copy says so, since a control that reads
 * identically to the private per-property share would leave the owner
 * assuming this link is unlisted too.
 */
export function BenchmarkShareControl({ initialUrl }: { initialUrl: string | null }) {
  const [url, setUrl] = useState(initialUrl);
  const { run, pending } = useAction();

  async function create() {
    const result = await run(() => createBenchmarkReport());
    if (result?.ok) setUrl(result.url);
  }

  async function revoke() {
    const result = await run(() => revokeBenchmarkReport());
    if (result?.ok) setUrl(null);
  }

  return (
    <Card
      title="Benchmark report"
      subtitle="A public rollup of your whole portfolio, indexable and meant to be shared"
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
              {pending ? "Creating" : "Create benchmark report"}
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
            Rollup totals across every property — visitors, sessions, pageviews, bounce rate,
            session duration, and the top channels by share.
          </span>
          <span style={{ fontSize: "var(--size-micro)", color: "var(--text-muted)", lineHeight: "var(--lh-normal)" }}>
            Not exposed: which property contributed what, pages, people, sessions, or settings.
            Unlike the per-property share link, this page is indexable by search engines — that
            is the point of publishing it.
          </span>
        </div>
      </div>
    </Card>
  );
}
