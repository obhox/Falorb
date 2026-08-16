import { Card } from "@falorb/ui";
import { Empty } from "@/components/Empty";

/**
 * One page for every kind of miss.
 *
 * A revoked link, a mistyped one and a link to an archived property all render
 * this, and the wording says nothing about which — distinguishing them would
 * let someone probing tokens learn that a given one used to be valid.
 */
export default function ShareNotFound() {
  return (
    <main style={{ height: "100%", display: "grid", placeItems: "center", padding: "var(--space-9)" }}>
      <Card tone="panel" style={{ maxWidth: 460 }}>
        <Empty
          icon="link-2-off"
          title="This link is not available"
          body="It may have been revoked, or it may never have existed. Ask whoever sent it for a current link."
        />
      </Card>
    </main>
  );
}
