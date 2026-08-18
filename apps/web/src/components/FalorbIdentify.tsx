"use client";

import { useEffect } from "react";
import dynamic from "next/dynamic";
import { useSession } from "@/lib/auth-client";

/**
 * Dogfooding hook: once a session resolves, ties the anonymous Falorb visitor
 * to the logged-in user so this dashboard's own usage shows up unified in
 * Falorb rather than as disconnected anonymous sessions.
 */
function FalorbIdentifyImpl() {
  const { data } = useSession();
  const userId = data?.user?.id;

  useEffect(() => {
    if (typeof window !== "undefined" && (window as any).falorb && data?.user) {
      (window as any).falorb.identify(data.user.id, { email: data.user.email });
    }
  }, [userId]);

  return null;
}

/**
 * Rendered directly from the root layout — an async Server Component — on
 * every request, which puts it through SSR on every single page load.
 * `useSession()` (better-auth's client hook, backed by nanostores'
 * `useStore`/`useSyncExternalStore`) crashes there with "Invalid hook call:
 * Cannot read properties of null (reading 'useRef')": Turbopack's dev SSR
 * pass renders this module graph with a null hook dispatcher. Confirmed not a
 * cold-compile race — it reproduces on an already-warm route with a fully
 * cleared `.next` cache, every time.
 *
 * The component has no visible output and does nothing until its `useEffect`
 * fires client-side, so it has no reason to run during SSR at all. `ssr:
 * false` skips that pass entirely, which sidesteps the crash rather than
 * working around it after the fact.
 */
export const FalorbIdentify = dynamic(() => Promise.resolve({ default: FalorbIdentifyImpl }), {
  ssr: false,
});
