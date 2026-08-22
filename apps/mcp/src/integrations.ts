import { and, eq, isNull } from "drizzle-orm";
import { schema, decryptCredential, type Database } from "@falorb/db";
import { OpenSeoClient } from "@falorb/openseo-client";

/**
 * A project's own OpenSEO connection if it has one, else the organization's
 * — same fallback `activeConnection`/`getOpenSeoClient` implement in
 * `apps/web/src/server/integrations.ts`, re-derived here rather than
 * imported since this server does not depend on the Next.js app. Shared by
 * `tools/content.ts` (live SEO context while drafting) and `tools/seo.ts`
 * (`get_seo_report`).
 */
export async function resolveOpenSeoClient(
  db: Database,
  organizationId: string,
  projectId: number,
): Promise<OpenSeoClient | null> {
  const [projectRow] = await db
    .select()
    .from(schema.integrationConnections)
    .where(
      and(
        eq(schema.integrationConnections.organizationId, organizationId),
        eq(schema.integrationConnections.projectId, projectId),
        eq(schema.integrationConnections.provider, "openseo"),
        eq(schema.integrationConnections.status, "active"),
      ),
    )
    .limit(1);

  const row =
    projectRow ??
    (
      await db
        .select()
        .from(schema.integrationConnections)
        .where(
          and(
            eq(schema.integrationConnections.organizationId, organizationId),
            isNull(schema.integrationConnections.projectId),
            eq(schema.integrationConnections.provider, "openseo"),
            eq(schema.integrationConnections.status, "active"),
          ),
        )
        .limit(1)
    )[0];

  if (!row) return null;
  const apiKey = decryptCredential({ ciphertext: row.encryptedApiKey, iv: row.iv, authTag: row.authTag });
  return new OpenSeoClient({ baseUrl: row.baseUrl, apiKey });
}
