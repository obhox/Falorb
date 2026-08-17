"use client";

import { useEffect } from "react";

/**
 * Fires `project_created` once, on the settings page a new property lands on
 * after `createProjectAction` redirects here server-side.
 *
 * There's no client-side success callback for a server action redirect, so
 * `NewProjectForm` sets a sessionStorage marker immediately before attempting
 * creation. This component consumes (and clears) that marker on mount, which
 * means a normal visit to this page — without the marker present — never
 * fires the event.
 */
export function ProjectCreatedTracker() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (sessionStorage.getItem("falorb_pending_project_created")) {
      sessionStorage.removeItem("falorb_pending_project_created");
      if ((window as any).falorb) {
        (window as any).falorb.track("project_created");
      }
    }
  }, []);

  return null;
}
