"use client";

import { useState } from "react";
import { Badge, Button, Card, Icon, Input } from "@falorb/ui";
import { Empty } from "@/components/Empty";
import { useToast } from "@/components/Toast";
import { useAction } from "@/lib/use-action";
import {
  mergePeople,
  searchMergeCandidates,
  unmergePeople,
  type MergeCandidate,
} from "@/server/actions/merges";
import { relative } from "@/lib/format";

export interface MergeHistoryView {
  id: string;
  mergedLabel: string;
  aliasCount: number;
  reverted: boolean;
  createdAt: string;
}

/**
 * Find and merge a duplicate profile, and reverse a past merge. Automatic
 * resolution only joins profiles on a deterministic signal, so it
 * deliberately leaves some duplicates for a human to spot — this is that fix.
 */
export function MergeCard({
  personId,
  canMerge,
  history,
}: {
  personId: string;
  canMerge: boolean;
  history: MergeHistoryView[];
}) {
  const { run, pending } = useAction();
  const toast = useToast();
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [candidates, setCandidates] = useState<MergeCandidate[] | null>(null);

  async function search() {
    setSearching(true);
    try {
      const result = await searchMergeCandidates(personId, query);
      setCandidates(result.candidates);
    } catch {
      toast.error("Search failed. Check your connection and try again.");
    } finally {
      setSearching(false);
    }
  }

  async function merge(candidateId: string) {
    const result = await run(() => mergePeople(personId, candidateId));
    if (result?.ok) setCandidates(null);
  }

  if (!canMerge) return null;

  return (
    <Card title="Merge duplicate profile" subtitle="Join another profile's history into this one">
      <div style={{ display: "grid", gap: "var(--space-5)" }}>
        <div style={{ display: "flex", gap: 8 }}>
          <Input
            size="sm"
            value={query}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQuery(e.target.value)}
            placeholder="Search email, name or id"
            style={{ flex: 1 }}
          />
          <Button size="sm" disabled={searching || !query.trim()} onClick={search}>
            {searching ? "Searching…" : "Search"}
          </Button>
        </div>

        {candidates && (
          candidates.length === 0 ? (
            <p style={{ fontSize: "var(--size-micro)", color: "var(--text-muted)", margin: 0 }}>
              No matches.
            </p>
          ) : (
            <div style={{ display: "grid", gap: 6 }}>
              {candidates.map((c) => (
                <div
                  key={c.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 8,
                    padding: "6px 0",
                    borderBottom: "1px solid var(--grid-line)",
                  }}
                >
                  <span style={{ fontSize: "var(--size-body-sm)", color: "var(--text-body)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {c.label}
                    {c.email && c.email !== c.label ? ` · ${c.email}` : ""}
                  </span>
                  <Button size="sm" disabled={pending} onClick={() => merge(c.id)}>
                    Merge into this profile
                  </Button>
                </div>
              ))}
            </div>
          )
        )}

        <div style={{ borderTop: "1px solid var(--border-subtle)", paddingTop: "var(--space-4)" }}>
          {history.length === 0 ? (
            <Empty
              dense
              icon="merge"
              title="No merges yet"
              body="Profiles this one has absorbed will show up here, reversible for as long as their snapshot exists."
            />
          ) : (
            <div style={{ display: "grid", gap: 6 }}>
              {history.map((m) => (
                <div
                  key={m.id}
                  style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}
                >
                  <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "var(--size-micro)", color: "var(--text-muted)" }}>
                    <Badge tone={m.reverted ? "neutral" : "up"}>{m.reverted ? "reverted" : "merged"}</Badge>
                    {m.mergedLabel} · {m.aliasCount} aliases · {relative(m.createdAt)}
                  </span>
                  {!m.reverted && (
                    <Button
                      size="sm"
                      variant="secondary"
                      iconLeft={<Icon name="undo-2" size={13} />}
                      disabled={pending}
                      onClick={() => run(() => unmergePeople(m.id))}
                    >
                      Unmerge
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
