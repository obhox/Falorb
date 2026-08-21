import "server-only";
import { eq } from "drizzle-orm";
import { db, schema } from "@falorb/db";

export interface WebhookRow {
  id: string;
  projectId: number | null;
  url: string;
  triggers: string[];
  secretPreview: string;
  active: boolean;
  failureCount: number;
  lastDeliveryAt: Date | null;
  createdAt: Date;
}

/** Never selects `secret` — a signing key is presented outbound by the
 * worker only, same reasoning as any other stored credential in this app. */
export async function listWebhooks(organizationId: string): Promise<WebhookRow[]> {
  const rows = await db()
    .select({
      id: schema.webhooks.id,
      projectId: schema.webhooks.projectId,
      url: schema.webhooks.url,
      triggers: schema.webhooks.triggers,
      secret: schema.webhooks.secret,
      active: schema.webhooks.active,
      failureCount: schema.webhooks.failureCount,
      lastDeliveryAt: schema.webhooks.lastDeliveryAt,
      createdAt: schema.webhooks.createdAt,
    })
    .from(schema.webhooks)
    .where(eq(schema.webhooks.organizationId, organizationId))
    .orderBy(schema.webhooks.createdAt);

  return rows.map((r) => ({
    id: r.id,
    projectId: r.projectId,
    url: r.url,
    triggers: r.triggers,
    secretPreview: r.secret.slice(-4),
    active: r.active,
    failureCount: r.failureCount,
    lastDeliveryAt: r.lastDeliveryAt,
    createdAt: r.createdAt,
  }));
}
