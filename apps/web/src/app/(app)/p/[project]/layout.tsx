import type { Metadata } from "next";
import { requireProject } from "@/server/session";
import { PageHeader } from "@/components/shell/PageHeader";
import { ProjectTabs } from "@/components/shell/ProjectTabs";
import { RangePicker } from "@/components/shell/RangePicker";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ project: string }>;
}): Promise<Metadata> {
  const { project } = await requireProject((await params).project);
  return { title: project.name };
}

/**
 * Chrome shared by every tab of one property.
 *
 * Header and tabs live here so switching tabs repaints only the body — the
 * title, the range control and the tab strip are not re-rendered or re-fetched.
 *
 * A layout receives no `searchParams`, by design: it is not re-rendered when
 * the query string changes. `RangePicker` and `ProjectTabs` are therefore
 * client components that read the URL themselves, and each page parses the
 * range again for its own queries.
 */
export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ project: string }>;
}) {
  const { project } = await requireProject((await params).project);

  const base = `/p/${project.slug}`;
  const tabs = [
    { href: base, label: "Summary" },
    { href: `${base}/live`, label: "Live" },
    { href: `${base}/people`, label: "People" },
    { href: `${base}/funnels`, label: "Funnels" },
    { href: `${base}/paths`, label: "Paths" },
    { href: `${base}/retention`, label: "Retention" },
    { href: `${base}/events`, label: "Events" },
    { href: `${base}/crawlers`, label: "AI & crawlers" },
    { href: `${base}/goals`, label: "Goals" },
    { href: `${base}/settings`, label: "Settings" },
  ];

  return (
    <>
      <PageHeader
        title={project.name}
        meta={project.domains[0] ?? project.slug}
        actions={<RangePicker />}
      />
      <ProjectTabs tabs={tabs} />
      {children}
    </>
  );
}
