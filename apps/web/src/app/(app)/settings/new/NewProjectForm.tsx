"use client";

import { useState } from "react";
import { Button, Card, Icon, Input } from "@falorb/ui";
import { createProjectAction } from "@/server/actions/project";
import { useAction } from "@/lib/use-action";

/**
 * Adding a property.
 *
 * Two fields only. Everything else has a working default, and a form that asks
 * for retention and consent mode before the first event has arrived is a form
 * people abandon.
 */
export function NewProjectForm() {
  const [name, setName] = useState("");
  const [domains, setDomains] = useState("");
  const { run, pending } = useAction();

  async function submit(event: React.FormEvent) {
    event.preventDefault();

    const data = new FormData();
    data.set("name", name);
    data.set("domains", domains);

    // On success the action redirects to the new property's settings, so the
    // acknowledgement cannot be raised here — this component is gone by then.
    // A marker set immediately before the attempt and consumed on mount by the
    // destination page is the only way to carry a client-side success across a
    // server-side redirect.
    if (typeof window !== "undefined") {
      sessionStorage.setItem("falorb_pending_project_created", "1");
    }

    // `run` re-throws the redirect rather than treating it as a failure, so
    // only a genuine refusal returns here — and it has already been toasted.
    const result = await run(() => createProjectAction(data), {
      quiet: true,
      refresh: false,
    });

    // No redirect happened, so the marker would otherwise fire spuriously on
    // whichever page the reader visits next.
    if (!result?.ok && typeof window !== "undefined") {
      sessionStorage.removeItem("falorb_pending_project_created");
    }
  }

  return (
    <Card title="Add a property" subtitle="One site or app you want to collect events from">
      <form onSubmit={submit} style={{ display: "grid", gap: "var(--space-7)" }}>
        <Input
          label="Name"
          value={name}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
          placeholder="Docs"
          hint="How it appears in the sidebar and the portfolio list."
        />

        <Input
          label="Domains"
          mono
          value={domains}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDomains(e.target.value)}
          placeholder="docs.falorb.io"
          hint="Events from any other origin are rejected at the edge. An apex domain authorises its subdomains."
        />


        <div>
          <Button
            type="submit"
            variant="primary"
            disabled={pending || !name.trim()}
            iconLeft={<Icon name="plus" size={14} />}
          >
            {pending ? "Creating" : "Create property"}
          </Button>
        </div>
      </form>
    </Card>
  );
}
