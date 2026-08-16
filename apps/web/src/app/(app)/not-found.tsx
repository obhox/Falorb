import Link from "next/link";
import { Button } from "@falorb/ui";
import { PageBody, PageHeader } from "@/components/shell/PageHeader";
import { Empty } from "@/components/Empty";

/**
 * Inside the shell, so a wrong URL keeps the sidebar and the reader keeps
 * their bearings instead of landing on a bare page.
 */
export default function NotFound() {
  return (
    <>
      <PageHeader title="Not found" />
      <PageBody>
        <Empty
          icon="file-question"
          title="That page does not exist"
          body="The property may have been archived, or the link may be from another workspace. Properties you can see are listed in the sidebar."
          action={
            <Link href="/">
              <Button variant="primary">Go to all properties</Button>
            </Link>
          }
        />
      </PageBody>
    </>
  );
}
