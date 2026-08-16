import type { Metadata } from "next";
import Link from "next/link";
import { SignUpForm } from "./SignUpForm";

export const metadata: Metadata = { title: "Create an account" };

export default function SignUpPage() {
  return (
    <>
      <SignUpForm />
      <p style={{ fontSize: "var(--size-label)", color: "var(--text-muted)", textAlign: "center" }}>
        Already have an account? <Link href="/sign-in">Sign in</Link>
      </p>
    </>
  );
}
