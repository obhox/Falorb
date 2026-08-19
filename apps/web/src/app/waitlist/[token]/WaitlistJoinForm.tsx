"use client";

import { useState } from "react";
import { Button, Card, Icon, Input } from "@falorb/ui";
import { CopyField } from "@/components/CopyField";
import { submitWaitlistJoin } from "@/server/actions/waitlist";

/**
 * The join form itself, and what an entrant sees after joining.
 *
 * Deliberately doesn't reach for `useAction`/`useToast` — both assume
 * `<ToastProvider>`, which only wraps the authenticated `(app)` shell. This
 * page is anonymous and outside that group, so feedback is inline instead.
 */
export function WaitlistJoinForm({
  token,
  projectName,
  referredByCode,
}: {
  token: string;
  projectName: string;
  referredByCode?: string;
}) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ referralCode: string; position: number } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);

    try {
      const outcome = await submitWaitlistJoin(
        token,
        email,
        name || undefined,
        referredByCode,
      );

      if (!outcome.ok || !outcome.referralCode) {
        setError(outcome.message ?? "That did not work.");
        return;
      }

      setResult({ referralCode: outcome.referralCode, position: outcome.position ?? 0 });
    } catch {
      setError("The server could not be reached. Check your connection and try again.");
    } finally {
      setPending(false);
    }
  }

  if (result) {
    const referralUrl = `${window.location.origin}/waitlist/${token}?ref=${encodeURIComponent(result.referralCode)}`;
    return (
      <Card tone="panel">
        <div style={{ display: "grid", gap: "var(--space-6)" }}>
          <div style={{ display: "grid", gap: 4 }}>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                color: "var(--signal-up)",
                fontSize: "var(--size-label)",
                fontWeight: "var(--wt-medium)",
              }}
            >
              <Icon name="check" size={14} /> You&rsquo;re on the list
            </span>
            {result.position > 0 && (
              <span style={{ fontSize: "var(--size-title)", fontWeight: "var(--wt-semibold)" }}>
                Position #{result.position}
              </span>
            )}
          </div>

          <div style={{ display: "grid", gap: 6 }}>
            <span style={{ fontSize: "var(--size-label)", color: "var(--text-secondary)" }}>
              Invite friends to move up the list — every signup through your link moves you up 3
              spots.
            </span>
            <CopyField value={referralUrl} label="Your invite link" />
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card tone="panel">
      <form onSubmit={submit} style={{ display: "grid", gap: "var(--space-6)" }}>
        <Input
          label="Email"
          type="email"
          required
          value={email}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)}
          placeholder="you@example.com"
        />
        <Input
          label="Name (optional)"
          value={name}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
          placeholder="Your name"
        />

        {error && (
          <span style={{ fontSize: "var(--size-label)", color: "var(--signal-down)" }}>
            {error}
          </span>
        )}

        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? "Joining" : `Join the ${projectName} waitlist`}
        </Button>
      </form>
    </Card>
  );
}
