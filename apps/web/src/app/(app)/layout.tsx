import { requireSession } from "@/server/session";
import { liveCounts } from "@/server/analytics";
import { type NavSection } from "@/components/shell/NavRail";
import { ShellNav } from "@/components/shell/ShellNav";
import { MobileNav } from "@/components/shell/MobileNav";
import { num } from "@/lib/format";
import { getTheme } from "@/server/theme";
import { ToastProvider } from "@/components/Toast";

/**
 * The signed-in shell: a fixed 224px rail and a flexible main panel, both
 * floating in a 12px inset. Neither ever touches the window edge.
 *
 * The rail carries a live visitor count per property. That is one small
 * ClickHouse query over a five-minute window on every render, which is cheap
 * and answers the question people actually open the dashboard for. It is
 * deliberately *not* a 30-day visitor total: that would be a full scan on every
 * page load to render a number nobody navigates by.
 *
 * Below 1024px the rail gives way to `MobileNav`'s hamburger + drawer.
 * `ShellNav` holds the actual rail contents so both renderings — the fixed
 * desktop `<aside>` and the drawer — share identical, once-rendered markup;
 * CSS alone decides which one is visible at a given width (see
 * `.falorb-shell-aside` in responsive.css), so there is no client-side
 * duplication or hydration mismatch.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  const theme = await getTheme();
  const projectIds = session.projects.map((p) => p.id);

  // A brand-new account has no projects yet; skip the query entirely rather
  // than sending ClickHouse an empty IN () list.
  const live = projectIds.length
    ? await liveCounts({ projectIds }).catch(() => [])
    : [];
  const liveByProject = new Map(live.map((row) => [row.project_id, row.visitors]));
  const liveTotal = live.reduce((sum, row) => sum + row.visitors, 0);

  const sections: NavSection[] = [
    {
      items: [
        { href: "/", label: "All properties", icon: "layout-grid" },
        { href: "/insights", label: "Insights", icon: "layout-dashboard" },
        { href: "/crm", label: "CRM", icon: "briefcase" },
        { href: "/support", label: "Support", icon: "life-buoy" },
        { href: "/prospecting", label: "Prospecting", icon: "radar" },
        { href: "/alerts", label: "Alerts", icon: "bell" },
      ],
    },
    {
      label: "Properties",
      items: session.projects.map((project) => ({
        href: `/p/${project.slug}`,
        label: project.domains[0] ?? project.name,
        icon: "globe",
        prefix: true,
        ...(liveByProject.get(project.id)
          ? { meta: num(liveByProject.get(project.id)!) }
          : {}),
      })),
    },
    {
      label: "Instance",
      items: [
        {
          href: "/settings",
          label: "Settings",
          icon: "settings",
          ...(liveTotal ? { meta: `${num(liveTotal)} now` } : {}),
        },
      ],
    },
  ];

  const accountMeta = `self-hosted · ${session.projects.length} ${
    session.projects.length === 1 ? "property" : "properties"
  }`;

  return (
    <ToastProvider>
    <MobileNav>
      <ShellNav
        sections={sections}
        theme={theme}
        currentWorkspace={session.workspace.organizationId}
        workspaces={session.workspaces}
        accountName={session.user.name}
        accountEmail={session.user.email}
        accountOrganization={session.workspace.organizationName}
        accountMeta={accountMeta}
      />
    </MobileNav>
    <div
      className="falorb-shell-row"
      style={{
        height: "100%",
        display: "flex",
        gap: "var(--gutter-panel)",
        padding: "var(--shell-pad)",
        background: "var(--bg-app)",
        boxSizing: "border-box",
      }}
    >
      <aside
        className="falorb-shell-aside"
        style={{
          flex: "0 0 224px",
          display: "flex",
          flexDirection: "column",
          padding: 10,
          background: "var(--surface-panel)",
          border: "1px solid var(--border-subtle)",
          borderRadius: "var(--radius-shell)",
          boxShadow: "var(--shadow-2)",
        }}
      >
        <ShellNav
          sections={sections}
          theme={theme}
          currentWorkspace={session.workspace.organizationId}
          workspaces={session.workspaces}
          accountName={session.user.name}
          accountEmail={session.user.email}
          accountOrganization={session.workspace.organizationName}
          accountMeta={accountMeta}
        />
      </aside>

      <main
        className="falorb-main"
        style={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
          background: "var(--surface-panel)",
          border: "1px solid var(--border-subtle)",
          borderRadius: "var(--radius-shell)",
          boxShadow: "var(--shadow-3)",
          overflow: "hidden",
          position: "relative",
        }}
      >
        {children}
      </main>
    </div>
    </ToastProvider>
  );
}
