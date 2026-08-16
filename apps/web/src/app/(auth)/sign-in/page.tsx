import type { Metadata } from "next";
import Link from "next/link";
import { SignInForm } from "./SignInForm";

export const metadata: Metadata = { title: "Sign in" };

export default function SignInPage() {
  return (
    <>
      <SignInForm />
      <p style={{ fontSize: "var(--size-label)", color: "var(--text-muted)", textAlign: "center" }}>
        No account yet? <Link href="/sign-up">Create one</Link>
      </p>
    </>
  );
}
