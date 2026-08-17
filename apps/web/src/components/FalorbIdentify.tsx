"use client";

import { useEffect } from "react";
import { useSession } from "@/lib/auth-client";

/**
 * Dogfooding hook: once a session resolves, ties the anonymous Falorb visitor
 * to the logged-in user so this dashboard's own usage shows up unified in
 * Falorb rather than as disconnected anonymous sessions.
 */
export function FalorbIdentify() {
  const { data } = useSession();
  const userId = data?.user?.id;

  useEffect(() => {
    if (typeof window !== "undefined" && (window as any).falorb && data?.user) {
      (window as any).falorb.identify(data.user.id, { email: data.user.email });
    }
  }, [userId]);

  return null;
}
