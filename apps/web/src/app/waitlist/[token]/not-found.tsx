import { Card } from "@falorb/ui";
import { Empty } from "@/components/Empty";

/**
 * Unknown, revoked and archived-project tokens all render this — same
 * indistinguishable-failure reasoning as `/share/[token]`'s not-found page.
 */
export default function WaitlistNotFound() {
  return (
    <main style={{ minHeight: "100dvh", display: "grid", placeItems: "center", padding: "var(--space-9)" }}>
      <Card tone="panel" style={{ maxWidth: 460 }}>
        <Empty
          icon="link-2-off"
          title="This waitlist is not available"
          body="It may have been turned off, or the link may never have existed. Ask whoever sent it for a current link."
        />
      </Card>
    </main>
  );
}
