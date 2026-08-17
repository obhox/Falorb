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

    // The action redirects on success, which `run` re-throws rather than
    // treating as a failure — so only a real refusal ever toasts here.
    await run(() => createProjectAction(data), { quiet: true, refresh: false });
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
