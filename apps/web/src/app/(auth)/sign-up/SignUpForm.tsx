"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Icon, Input } from "@falorb/ui";
import { signUp } from "@/lib/auth-client";

/** Mirrors `minPasswordLength` in @falorb/auth. Checked here only so the failure
 *  is stated before a round-trip, never instead of the server check. */
const MIN_PASSWORD = 10;

export function SignUpForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const short = password.length > 0 && password.length < MIN_PASSWORD;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (password.length < MIN_PASSWORD) {
      setError(`Passwords are at least ${MIN_PASSWORD} characters. Add a few more.`);
      return;
    }

    const result = await signUp.email({ email, password, name: name.trim() || email.split("@")[0]! });

    if (result.error) {
      setError(result.error.message ?? "That account could not be created. Try a different email.");
      return;
    }

    // `autoSignIn` is on, so a successful signup already carries a session.
    // The workspace itself is created lazily on the first authenticated read.
    startTransition(() => {
      router.refresh();
      router.replace("/");
    });
  }

  return (
    <Card tone="panel" padding="var(--pad-panel)">
      <form onSubmit={submit} style={{ display: "grid", gap: "var(--space-7)" }}>
        <div style={{ display: "grid", gap: "var(--space-1)" }}>
          <h2 style={{ fontSize: "var(--size-subtitle)" }}>Create an account</h2>
          <span style={{ fontSize: "var(--size-label)", color: "var(--text-muted)" }}>
            Your data stays on your instance.
          </span>
        </div>

        <div style={{ display: "grid", gap: "var(--space-6)" }}>
          <Input
            label="Name"
            name="name"
            autoComplete="name"
            value={name}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
            placeholder="Your name"
            iconLeft={<Icon name="user" size={14} />}
          />
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
            autoComplete="new-password"
            required
            invalid={short}
            value={password}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)}
            placeholder="••••••••••"
            iconLeft={<Icon name="lock" size={14} />}
            hint={
              short
                ? `${MIN_PASSWORD - password.length} more characters needed.`
                : `At least ${MIN_PASSWORD} characters.`
            }
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
          {pending ? "Creating account" : "Create account"}
        </Button>
      </form>
    </Card>
  );
}
