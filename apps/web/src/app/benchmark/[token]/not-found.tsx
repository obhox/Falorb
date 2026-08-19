import { Card } from "@falorb/ui";
import { Empty } from "@/components/Empty";

/**
 * One page for every kind of miss — same reasoning as `/share/[token]`'s: a
 * revoked link and a mistyped one render identically, so a probing visitor
 * cannot tell which they hit.
 */
export default function BenchmarkNotFound() {
  return (
    <main style={{ height: "100%", display: "grid", placeItems: "center", padding: "var(--space-9)" }}>
      <Card tone="panel" style={{ maxWidth: 460 }}>
        <Empty
          icon="link-2-off"
          title="This report is not available"
          body="It may have been revoked, or it may never have existed. Ask whoever shared it for a current link."
        />
      </Card>
    </main>
  );
}
