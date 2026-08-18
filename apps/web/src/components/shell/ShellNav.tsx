import { NavRail, type NavSection } from "@/components/shell/NavRail";
import { AccountFooter } from "@/components/shell/AccountFooter";
import { Wordmark } from "@/components/shell/Wordmark";
import { WorkspaceSwitcher, type WorkspaceOption } from "@/components/shell/WorkspaceSwitcher";
import { ThemeToggle } from "@/components/ThemeToggle";
import type { ThemeChoice } from "@/server/theme";

/**
 * The rail's contents: wordmark, workspace switcher, nav sections, theme
 * toggle, account footer.
 *
 * Pulled out of the layout so it can render twice — once as the fixed
 * desktop rail, once inside the mobile drawer — without duplicating the
 * markup. Both instances are the same server-rendered content; only their
 * container (and which one CSS shows at a given width) differs.
 */
export function ShellNav({
  sections,
  theme,
  currentWorkspace,
  workspaces,
  accountName,
  accountEmail,
  accountOrganization,
  accountMeta,
}: {
  sections: NavSection[];
  theme: ThemeChoice;
  currentWorkspace: string;
  workspaces: WorkspaceOption[];
  accountName: string | null;
  accountEmail: string;
  accountOrganization: string;
  accountMeta: string;
}) {
  return (
    <>
      <Wordmark />
      <WorkspaceSwitcher current={currentWorkspace} workspaces={workspaces} />
      <NavRail sections={sections} />
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          padding: "0 0 10px",
        }}
      >
        <ThemeToggle current={theme} />
      </div>
      <AccountFooter
        name={accountName}
        email={accountEmail}
        organization={accountOrganization}
        meta={accountMeta}
      />
    </>
  );
}
