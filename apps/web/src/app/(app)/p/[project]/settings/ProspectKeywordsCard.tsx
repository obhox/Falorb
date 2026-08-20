"use client";

import { useState } from "react";
import { Badge, Button, Card, Icon, Input, Switch } from "@falorb/ui";
import { Empty } from "@/components/Empty";
import {
  addProspectKeyword,
  removeProspectKeyword,
  toggleProspectKeyword,
} from "@/server/actions/prospect-keywords";
import { useAction } from "@/lib/use-action";

export interface ProspectKeywordView {
  id: string;
  keyword: string;
  active: boolean;
}

/**
 * What to listen for on Reddit for this property. Matches show up org-wide
 * on `/prospecting`, not here — this card is config, not the results.
 */
export function ProspectKeywordsCard({
  slug,
  keywords,
  canEdit,
}: {
  slug: string;
  keywords: ProspectKeywordView[];
  canEdit: boolean;
}) {
  const { run, pending } = useAction();
  const [value, setValue] = useState("");

  async function add(event: React.FormEvent) {
    event.preventDefault();
    if (!value.trim()) return;
    const result = await run(() => addProspectKeyword(slug, value), { success: "Keyword added" });
    if (result?.ok) setValue("");
  }

  return (
    <Card
      title="Prospecting keywords"
      subtitle="Reddit posts matching any of these show up on Prospecting, scored for relevance"
    >
      <div style={{ display: "grid", gap: "var(--space-5)" }}>
        {canEdit && (
          <form onSubmit={add} style={{ display: "flex", gap: 8 }}>
            <Input
              value={value}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setValue(e.target.value)}
              placeholder="e.g. your product category or a competitor's name"
              style={{ flex: 1 }}
            />
            <Button type="submit" size="sm" disabled={pending || !value.trim()}>
              Add
            </Button>
          </form>
        )}

        {keywords.length === 0 ? (
          <Empty
            dense
            icon="radar"
            title="No keywords yet"
            body="Add a term worth watching for — a pain point, a category, or a competitor."
          />
        ) : (
          <div style={{ display: "grid", gap: "var(--space-2)" }}>
            {keywords.map((k) => (
              <KeywordRow key={k.id} slug={slug} keyword={k} canEdit={canEdit} />
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}

function KeywordRow({
  slug,
  keyword,
  canEdit,
}: {
  slug: string;
  keyword: ProspectKeywordView;
  canEdit: boolean;
}) {
  const { run, pending } = useAction();

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        padding: "var(--space-2) 0",
        borderBottom: "1px solid var(--grid-line)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
        <span style={{ fontSize: "var(--size-body-sm)", color: "var(--text-primary)" }}>
          {keyword.keyword}
        </span>
        {!keyword.active && <Badge tone="neutral">paused</Badge>}
      </div>

      {canEdit && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, flex: "0 0 auto" }}>
          <Switch
            checked={keyword.active}
            disabled={pending}
            onChange={(next: boolean) =>
              run(() => toggleProspectKeyword(slug, keyword.id, next), {
                quiet: true,
              })
            }
          />
          <Button
            size="sm"
            variant="secondary"
            iconLeft={<Icon name="trash-2" size={13} />}
            disabled={pending}
            onClick={() => run(() => removeProspectKeyword(slug, keyword.id), { success: "Removed" })}
          >
            Remove
          </Button>
        </div>
      )}
    </div>
  );
}
