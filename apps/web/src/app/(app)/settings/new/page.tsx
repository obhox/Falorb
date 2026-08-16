import type { Metadata } from "next";
import { requireSession } from "@/server/session";
import { PageBody, PageHeader } from "@/components/shell/PageHeader";
import { NewProjectForm } from "./NewProjectForm";

export const metadata: Metadata = { title: "Add property" };
export const dynamic = "force-dynamic";

export default async function NewProjectPage() {
  await requireSession();

  return (
    <>
      <PageHeader title="Add property" />
      <PageBody>
        <div style={{ maxWidth: 560 }}>
          <NewProjectForm />
        </div>
      </PageBody>
    </>
  );
}
