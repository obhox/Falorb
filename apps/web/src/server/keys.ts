import "server-only";
import { desc, eq } from "drizzle-orm";
import { db, schema } from "@falorb/db";

/**
 * API keys, as the dashboard sees them.
 *
 * The plaintext is never in this shape and never in the database — only the
 * SHA-256 hash and a six-character prefix. The prefix exists so a key can be
 * recognised in a list ("which one is on the CI box?") without being enough to
 * use, which is the whole reason to store it at all.
 */

export interface ApiKeyView {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  projectId: number | null;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}

export async function listKeys(organizationId: string): Promise<ApiKeyView[]> {
  const rows = await db()
    .select()
    .from(schema.apiKeys)
    .where(eq(schema.apiKeys.organizationId, organizationId))
    .orderBy(desc(schema.apiKeys.createdAt));

  return rows.map((key) => ({
    id: key.id,
    name: key.name,
    prefix: key.keyPrefix,
    scopes: key.scopes,
    projectId: key.projectId,
    lastUsedAt: key.lastUsedAt,
    expiresAt: key.expiresAt,
    revokedAt: key.revokedAt,
    createdAt: key.createdAt,
  }));
}
