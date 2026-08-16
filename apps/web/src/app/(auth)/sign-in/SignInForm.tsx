"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Icon, Input } from "@falorb/ui";
import { signIn } from "@/lib/auth-client";

export function SignInForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    const result = await signIn.email({ email, password });

    if (result.error) {
      // better-auth deliberately does not say which of the two was wrong, and
      // neither do we — confirming that an address has an account here is a
      // free account-enumeration oracle.
      setError(
        result.error.message ??
          "That email and password combination was not accepted. Check both and try again.",
      );
      return;
    }

    // Refresh rather than push: the layout above re-runs its session check and
    // redirects, so the destination is decided server-side.
    startTransition(() => {
      router.refresh();
      router.replace("/");
    });
  }

  return (
    <Card tone="panel" padding="var(--pad-panel)">
      <form onSubmit={submit} style={{ display: "grid", gap: "var(--space-7)" }}>
        <div style={{ display: "grid", gap: "var(--space-1)" }}>
          <h2 style={{ fontSize: "var(--size-subtitle)" }}>Sign in</h2>
          <span style={{ fontSize: "var(--size-label)", color: "var(--text-muted)" }}>
            Every property on one page.
          </span>
        </div>

        <div style={{ display: "grid", gap: "var(--space-6)" }}>
          <Input
            label="Email"
            type="email"
            name="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)}
            placeholder="you@example.com"
            iconLeft={<Icon name="mail" size={14} />}
          />
          <Input
            label="Password"
            type="password"
            name="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)}
            placeholder="••••••••••"
            iconLeft={<Icon name="lock" size={14} />}
          />
        </div>

        {error && (
          <p
            role="alert"
            style={{
              fontSize: "var(--size-label)",
              color: "var(--signal-down)",
              background: "var(--signal-down-dim)",
              border: "1px solid rgba(242,116,139,.22)",
              borderRadius: "var(--radius-3)",
              padding: "var(--space-5) var(--space-6)",
            }}
          >
            {error}
          </p>
        )}

        <Button type="submit" variant="primary" size="lg" fullWidth disabled={pending}>
          {pending ? "Signing in" : "Sign in"}
        </Button>
      </form>
    </Card>
  );
}
