import { redirect } from "next/navigation";
import { getSession } from "@/server/session";
import { getTheme } from "@/server/theme";
import { ThemeToggle } from "@/components/ThemeToggle";

/**
 * The signed-out shell: one centred card on the flat near-black canvas.
 *
 * Anyone who already has a session is bounced to the portfolio — landing on a
 * sign-in form while signed in reads as though the session was lost.
 */
export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  if (await getSession()) redirect("/");

  const theme = await getTheme();

  return (
    <main
      style={{
        height: "100%",
        display: "grid",
        placeItems: "center",
        padding: "var(--space-9)",
        background: "var(--bg-app)",
        overflowY: "auto",
      }}
    >
      <div style={{ width: "100%", maxWidth: 380, display: "grid", gap: "var(--space-8)" }}>
        <div style={{ display: "grid", gap: "var(--space-2)", justifyItems: "center" }}>
          <span
            style={{
              fontSize: "var(--size-subtitle)",
              fontWeight: "var(--wt-semibold)",
              letterSpacing: "-0.05em",
              color: "var(--text-primary)",
            }}
          >
            Falorb
          </span>
          <span style={{ fontSize: "var(--size-label)", color: "var(--text-muted)" }}>
            Self-hosted analytics
          </span>
        </div>
        {children}

        <div style={{ display: "flex", justifyContent: "center" }}>
          <ThemeToggle current={theme} />
        </div>
      </div>
    </main>
  );
}
