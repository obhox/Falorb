"use client";

import { useState, useTransition } from "react";
import { Button, Card, Icon, Input } from "@falorb/ui";
import { createProjectAction } from "@/server/actions/project";

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
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    const data = new FormData();
    data.set("name", name);
    data.set("domains", domains);

    // On success the action redirects to the new property's settings, so the
    // only thing that comes back here is a failure.
    startTransition(async () => {
      const result = await createProjectAction(data);
      if (result && !result.ok) setError(result.message ?? "That property could not be created.");
    });
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

        {error && (
          <span style={{ fontSize: "var(--size-label)", color: "var(--signal-down)" }}>
            {error}
          </span>
        )}

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
