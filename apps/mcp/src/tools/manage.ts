import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { and, desc, eq } from "drizzle-orm";
import { createProject, normalizeDomain, schema } from "@falorb/db";
import { assertSafeWebhookUrl, UnsafeUrlError } from "@falorb/core";
import { hostStatus, installStatus } from "@falorb/queries";
import type { McpContext } from "../context";
import { requireScope, resolveProjects } from "../context";
import { ago, failure, num, table, text } from "../format";

const CHANNEL_KINDS = ["slack", "webhook", "email"] as const;

/**
 * Which configured domain owns a collected host, or null if none does.
 *
 * Mirrors `ownerOf` in `apps/web/src/lib/domain-match.ts` exactly — the
 * collector's own rule (lowercase, drop a leading `www.`, longest apex
 * match wins) — ported inline rather than added as a shared-package
 * dependency for one small function.
 */
function ownerOf(host: string, domains: string[]): string | null {
  const normalise = (v: string) => v.trim().toLowerCase().replace(/^www\./, "");
  const target = normalise(host);
  if (!target) return null;

  let best: { domain: string; length: number } | null = null;
  for (const domain of domains) {
    const match = normalise(domain);
    if (!match) continue;
    if (target !== match && !target.endsWith(`.${match}`)) continue;
    if (!best || match.length > best.length) best = { domain, length: match.length };
  }
  return best?.domain ?? null;
}

/**
 * Configuration tools.
 *
 * Two deliberate boundaries here.
 *
 * Writes require the `write` scope, so a read-only key handed to an assistant
 * cannot change anything.
 *
 * `archive_project` is the one project-lifecycle action this platform has —
 * there is no hard delete anywhere in this codebase, dashboard included: a
 * property is archived (its data kept, under its normal retention window)
 * rather than destroyed, which is why a write-scope key may do it like any
 * other write. Person erasure is a different case — see `people.ts`'s
 * `request_person_erasure`, which needs the local operator, not just the
 * write scope, because erasing a person's data is genuinely irreversible and
 * a GDPR obligation that needs a human to confirm the subject's identity.
 */
export function registerManagementTools(server: McpServer, ctx: () => McpContext): void {
  server.registerTool(
    "list_alerts",
    {
      title: "List alert rules",
      description:
        "Show configured alert rules, when each last fired, and which delivery channel (if any) it notifies.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      const { db, scope } = ctx();
      try {
        const rows = await db
          .select({
            id: schema.alerts.id,
            name: schema.alerts.name,
            kind: schema.alerts.kind,
            active: schema.alerts.active,
            condition: schema.alerts.condition,
            lastFiredAt: schema.alerts.lastFiredAt,
            channelName: schema.alertChannels.name,
          })
          .from(schema.alerts)
          .leftJoin(schema.alertChannels, eq(schema.alertChannels.id, schema.alerts.channelId))
          .where(eq(schema.alerts.organizationId, scope.organizationId))
          .orderBy(desc(schema.alerts.createdAt));

        return text(
          table(
            rows,
            [
              { header: "Id", get: (r) => r.id },
              { header: "Name", get: (r) => r.name },
              { header: "Kind", get: (r) => r.kind },
              { header: "Active", get: (r) => (r.active ? "yes" : "no") },
              { header: "Delivers to", get: (r) => r.channelName ?? "(nowhere)" },
              { header: "Condition", get: (r) => JSON.stringify(r.condition) },
              { header: "Last fired", get: (r) => ago(r.lastFiredAt?.toISOString()) },
            ],
            "No alert rules configured.",
          ),
        );
      } catch (error) {
        return failure(message(error));
      }
    },
  );

  server.registerTool(
    "create_alert",
    {
      title: "Create an alert rule",
      description:
        "Create a monitoring rule. `no_data` catches a broken or blocked tracker — the failure every other alert misses, because a dead tracker produces nothing to threshold. `anomaly` compares against the same window a week earlier, which avoids firing on normal weekday/weekend shape. Requires the write scope.",
      inputSchema: {
        name: z.string().min(1).max(120),
        project: z.string().optional().describe("Project slug; omit to watch all projects."),
        kind: z.enum(["threshold", "anomaly", "no_data", "error_spike"]),
        metric: z
          .enum(["visitors", "sessions", "pageviews", "events", "revenue"])
          .optional()
          .describe("Required for threshold and anomaly."),
        operator: z.enum(["lt", "lte", "gt", "gte"]).optional().describe("Required for threshold."),
        value: z.number().optional().describe("Threshold value, or error count for error_spike."),
        change_percent: z.number().optional().describe("For anomaly: percentage change that counts."),
        direction: z.enum(["drop", "rise", "either"]).optional().default("either"),
        window_minutes: z.number().int().min(5).max(10080).optional().default(60),
        cooldown_minutes: z.number().int().min(5).optional().default(60),
        channel_id: z
          .string()
          .optional()
          .describe(
            "Delivery channel from list_alert_channels. Omit and the alert has nowhere to deliver — it still evaluates and its history is visible via list_alert_events, but nothing gets notified.",
          ),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async (args) => {
      const { db, scope } = ctx();
      try {
        requireScope(scope, "write");

        if (args.channel_id) {
          const [channel] = await db
            .select({ id: schema.alertChannels.id })
            .from(schema.alertChannels)
            .where(
              and(
                eq(schema.alertChannels.id, args.channel_id),
                eq(schema.alertChannels.organizationId, scope.organizationId),
              ),
            )
            .limit(1);
          if (!channel) return failure(`No such delivery channel "${args.channel_id}".`);
        }

        const projectIds = args.project ? resolveProjects(scope, args.project) : [];
        const condition: Record<string, unknown> = { windowMinutes: args.window_minutes };

        if (args.kind === "threshold") {
          if (!args.metric || !args.operator || args.value === undefined) {
            return failure("threshold alerts need metric, operator and value.");
          }
          Object.assign(condition, {
            metric: args.metric,
            operator: args.operator,
            value: args.value,
          });
        } else if (args.kind === "anomaly") {
          if (!args.metric || args.change_percent === undefined) {
            return failure("anomaly alerts need metric and change_percent.");
          }
          Object.assign(condition, {
            metric: args.metric,
            changePercent: args.change_percent,
            direction: args.direction,
          });
        } else if (args.kind === "error_spike") {
          condition.value = args.value ?? 25;
        }

        const [created] = await db
          .insert(schema.alerts)
          .values({
            organizationId: scope.organizationId,
            projectId: projectIds[0] ?? null,
            channelId: args.channel_id ?? null,
            name: args.name,
            kind: args.kind,
            condition,
            cooldownMinutes: args.cooldown_minutes,
          })
          .returning();

        return text(
          `Created alert **${created!.name}** (${created!.kind}).\n\n` +
            `Condition: \`${JSON.stringify(condition)}\`\n` +
            `Evaluated every 5 minutes by the worker, with a ${args.cooldown_minutes}-minute cooldown between notifications.\n\n` +
            (args.channel_id
              ? "It delivers to the channel above."
              : "It has no delivery channel yet, so firings are recorded and logged but not sent anywhere. Use list_alert_channels and set_alert_channel to attach one."),
        );
      } catch (error) {
        return failure(message(error));
      }
    },
  );

  server.registerTool(
    "get_install_snippet",
    {
      title: "Tracker install snippet",
      description:
        "The exact HTML snippet to install on a project's site, plus the JavaScript API for identifying users and tracking custom events.",
      inputSchema: { project: z.string().describe("Project slug.") },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ project }) => {
      const { db, scope } = ctx();
      try {
        const [id] = resolveProjects(scope, project);
        const [row] = await db
          .select()
          .from(schema.projects)
          .where(and(eq(schema.projects.id, id!), eq(schema.projects.organizationId, scope.organizationId)))
          .limit(1);

        if (!row) return failure(`Project "${project}" not found.`);

        const host = process.env.FALORB_INGEST_URL ?? "https://a.example.com";

        return text(
          `**Install snippet for ${row.name}**\n\n` +
            "```html\n" +
            `<script defer src="${host}/t.js" data-project="${row.publicKey}"></script>\n` +
            "```\n\n" +
            `Allowed domains: ${row.domains.length ? row.domains.join(", ") : "any (none configured yet)"}\n\n` +
            "### Identifying users\n\n" +
            "```js\n" +
            "falorb.identify(user.id, { email: user.email, plan: user.plan })\n" +
            "```\n\n" +
            "Calling `identify()` with the same id on two of your projects is what unifies a person across them — it is the only mechanism that does, so wire it into each product's login.\n\n" +
            "### Custom events and revenue\n\n" +
            "```js\n" +
            "falorb.track('checkout_started', { plan: 'pro', seats: 3 })\n" +
            "falorb.revenue(99, 'USD')\n" +
            "```\n\n" +
            "The public key above is safe to expose — it ships in your page source. Requests are authorised by Origin against the allowed domains.",
        );
      } catch (error) {
        return failure(message(error));
      }
    },
  );

  server.registerTool(
    "get_platform_health",
    {
      title: "Platform health",
      description:
        "Ingest and pipeline health: events received recently per project, bot share, and whether any project has gone quiet. Use this when numbers look wrong before concluding traffic actually dropped.",
      inputSchema: { window_hours: z.number().int().min(1).max(168).optional().default(24) },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ window_hours }) => {
      const { clickhouse, scope } = ctx();
      try {
        const since = new Date(Date.now() - window_hours * 3_600_000)
          .toISOString()
          .replace("T", " ")
          .replace("Z", "");

        const result = await clickhouse.query({
          query: `
            SELECT
                project_id,
                count()                       AS events,
                countIf(is_bot = 1)           AS bot_events,
                uniqCombined64(person_id)     AS people,
                max(timestamp)                AS last_event,
                max(ingested_at)              AS last_ingest
            FROM events
            WHERE has({projectIds:Array(UInt32)}, project_id)
              AND timestamp >= {since:DateTime64(3)}
            GROUP BY project_id
          `,
          query_params: { projectIds: scope.projectIds, since },
          format: "JSONEachRow",
        });

        const rows = await result.json<{
          project_id: number;
          events: string;
          bot_events: string;
          people: string;
          last_event: string;
          last_ingest: string;
        }>();

        const reporting = new Set(rows.map((r) => r.project_id));
        const silent = scope.projects.filter((p) => !reporting.has(p.id));

        return text(
          `**Pipeline health — last ${window_hours}h**\n\n` +
            table(
              rows,
              [
                { header: "Project", get: (r) => scope.projects.find((p) => p.id === r.project_id)?.slug ?? r.project_id },
                { header: "Events", get: (r) => num(r.events), align: "right" },
                { header: "People", get: (r) => num(r.people), align: "right" },
                {
                  header: "Bot share",
                  get: (r) =>
                    `${((Number(r.bot_events) / Math.max(Number(r.events), 1)) * 100).toFixed(1)}%`,
                  align: "right",
                },
                { header: "Last event", get: (r) => ago(r.last_event) },
              ],
              "No project reported any events.",
            ) +
            (silent.length
              ? `\n\n⚠️ **Silent projects:** ${silent.map((p) => p.slug).join(", ")} — no events at all in this window. Either they get no traffic, the snippet is missing, or an ad blocker is stopping it.`
              : `\n\nAll ${scope.projects.length} projects are reporting.`),
        );
      } catch (error) {
        return failure(message(error));
      }
    },
  );

  server.registerTool(
    "create_project",
    {
      title: "Create a project",
      description:
        "Add a new property to track. Mints a public tracker key and a unique slug from the name; call get_install_snippet afterwards for the HTML to paste on the site. This is additive, not destructive — projects created here are not deletable through this interface (see the platform capabilities resource). Requires the write scope.",
      inputSchema: {
        name: z.string().min(1).max(120),
        domains: z
          .array(z.string())
          .max(20)
          .optional()
          .describe('Hosts allowed to send events, e.g. ["acme.example", "app.acme.example"]. Can be added later in settings.'),
        timezone: z.string().optional().describe('IANA timezone "today" is computed against in reports. Defaults to UTC.'),
        slug: z.string().optional().describe("Preferred slug; a suffix is appended on collision. Derived from the name if omitted."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async ({ name, domains, timezone, slug }) => {
      const { db, scope } = ctx();
      try {
        requireScope(scope, "write");

        const project = await createProject(db, {
          organizationId: scope.organizationId,
          name,
          slug,
          domains: (domains ?? []).map(normalizeDomain).filter(Boolean),
          timezone,
        });

        const host = process.env.FALORB_INGEST_URL ?? "https://a.example.com";

        return text(
          `Created project **${project.name}** (\`${project.slug}\`).\n\n` +
            table(
              [
                { k: "Slug", v: project.slug },
                { k: "Domains", v: project.domains.length ? project.domains.join(", ") : "(none yet)" },
                { k: "Timezone", v: project.timezone },
                { k: "Public key", v: project.publicKey },
              ],
              [
                { header: "Field", get: (r) => r.k },
                { header: "Value", get: (r) => r.v },
              ],
            ) +
            `\n\nInstall snippet:\n\n\`\`\`html\n<script defer src="${host}/t.js" data-project="${project.publicKey}"></script>\n\`\`\`\n\n` +
            (project.domains.length
              ? "Call get_install_snippet any time for this again."
              : "This key is scoped to no domains yet — the tracker will reject events until at least one is added."),
        );
      } catch (error) {
        return failure(message(error));
      }
    },
  );

  server.registerTool(
    "get_connection_status",
    {
      title: "Is a project actually connected?",
      description:
        "Whether a property's tracker snippet is installed and sending events, per domain: 'waiting' (nothing ever arrived), 'live' (events in the last 24h), or 'silent' (it worked, then stopped). An empty dashboard looks identical to a quiet week — this tells them apart. Also reports whether the ingest collector itself is reachable.",
      inputSchema: { project: z.string().describe("Project slug.") },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ project }) => {
      const { clickhouse, scope } = ctx();
      try {
        const [id] = resolveProjects(scope, project);
        const row = scope.projects.find((p) => p.id === id)!;

        const [installRows, hostRows, health] = await Promise.all([
          installStatus(clickhouse, { projectIds: [id!] }),
          row.domains.length ? hostStatus(clickhouse, { projectIds: [id!] }) : Promise.resolve([]),
          getCollectorHealth(),
        ]);

        const install = installRows[0];
        const eventsTotal = Number(install?.events_total ?? 0);
        const events24h = Number(install?.events_24h ?? 0);
        const state = eventsTotal === 0 ? "waiting" : events24h > 0 ? "live" : "silent";

        const domainRows = row.domains.map((domain) => {
          const matching = hostRows.filter((r) => ownerOf(r.host, row.domains) === domain);
          const total = matching.reduce((a, r) => a + Number(r.events_total), 0);
          const last24h = matching.reduce((a, r) => a + Number(r.events_24h), 0);
          const lastEvent = matching.reduce<string | null>(
            (a, r) => (!a || r.last_event > a ? r.last_event : a),
            null,
          );
          return {
            domain,
            state: total === 0 ? "waiting" : last24h > 0 ? "live" : "silent",
            lastEvent,
            total,
            hosts: [...new Set(matching.map((r) => r.host))].join(", ") || "—",
          };
        });

        return text(
          `**${row.name} (${row.slug}) — ${state}**\n\n` +
            table(
              [
                { k: "State", v: state },
                { k: "First event", v: ago(install?.first_event) },
                { k: "Last event", v: ago(install?.last_event) },
                { k: "Events (24h)", v: num(events24h) },
                { k: "Events (total)", v: num(eventsTotal) },
              ],
              [
                { header: "Field", get: (r) => r.k },
                { header: "Value", get: (r) => r.v },
              ],
            ) +
            (domainRows.length
              ? `\n\n### Per domain\nA configured apex authorises every subdomain beneath it, so one working domain can mask a broken one.\n\n` +
                table(domainRows, [
                  { header: "Domain", get: (r) => r.domain },
                  { header: "State", get: (r) => r.state },
                  { header: "Last event", get: (r) => ago(r.lastEvent) },
                  { header: "Events (total)", get: (r) => num(r.total), align: "right" },
                  { header: "Reporting hosts", get: (r) => r.hosts },
                ])
              : "\n\nNo domains configured — the tracker snippet is not scoped to any host yet.") +
            `\n\n### Collector\n` +
            table(
              [
                { k: "Reachable", v: health.reachable ? "yes" : "no" },
                { k: "Redis", v: health.redis ? "up" : "down" },
                { k: "Tracker asset served", v: health.tracker ? "yes" : "no" },
                { k: "Geo source", v: health.geoSource },
              ],
              [
                { header: "Field", get: (r) => r.k },
                { header: "Value", get: (r) => r.v },
              ],
            ),
        );
      } catch (error) {
        return failure(message(error));
      }
    },
  );

  server.registerTool(
    "list_alert_channels",
    {
      title: "List alert delivery channels",
      description: "Show where alert notifications can be delivered — Slack, webhook, or email.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      const { db, scope } = ctx();
      try {
        const rows = await db
          .select()
          .from(schema.alertChannels)
          .where(eq(schema.alertChannels.organizationId, scope.organizationId))
          .orderBy(desc(schema.alertChannels.createdAt));

        return text(
          table(
            rows,
            [
              { header: "Id", get: (r) => r.id },
              { header: "Name", get: (r) => r.name },
              { header: "Kind", get: (r) => r.kind },
              { header: "Active", get: (r) => (r.active ? "yes" : "no") },
              {
                header: "Destination",
                get: (r) => ((r.config as Record<string, string>).to ?? (r.config as Record<string, string>).url ?? "—"),
              },
            ],
            "No delivery channels configured — alerts created without one deliver nowhere.",
          ),
        );
      } catch (error) {
        return failure(message(error));
      }
    },
  );

  server.registerTool(
    "create_alert_channel",
    {
      title: "Add an alert delivery channel",
      description:
        "Register where alert notifications go. For 'webhook' and 'slack', the URL is screened against SSRF (private/internal addresses are rejected) — the alert worker re-screens the resolved address on every delivery too. Requires the write scope.",
      inputSchema: {
        name: z.string().min(1).max(120).describe("Label — where this goes, e.g. \"#alerts\" or \"on-call email\"."),
        kind: z.enum(CHANNEL_KINDS),
        to: z.string().optional().describe("Required for kind=email."),
        url: z.string().optional().describe("Required for kind=slack or kind=webhook. Must be https://."),
        secret: z.string().optional().describe("Optional HMAC secret to sign webhook deliveries (kind=webhook only)."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async ({ name, kind, to, url, secret }) => {
      const { db, scope } = ctx();
      try {
        requireScope(scope, "write");

        let config: Record<string, string>;
        if (kind === "email") {
          if (!to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) {
            return failure("kind=email needs a valid `to` address.");
          }
          config = { to };
        } else {
          if (!url) return failure(`kind=${kind} needs a \`url\`.`);
          let safe: URL;
          try {
            safe = assertSafeWebhookUrl(url);
          } catch (error) {
            return failure(
              error instanceof UnsafeUrlError ? error.message : "Enter an https:// URL for the webhook.",
            );
          }
          config = secret ? { url: safe.toString(), secret } : { url: safe.toString() };
        }

        const [created] = await db
          .insert(schema.alertChannels)
          .values({ organizationId: scope.organizationId, name, kind, config })
          .returning();

        return text(`Created channel **${created!.name}** (${created!.kind}), id \`${created!.id}\`. Attach it to an alert with set_alert_channel, or pass channel_id to create_alert.`);
      } catch (error) {
        return failure(message(error));
      }
    },
  );

  server.registerTool(
    "delete_alert_channel",
    {
      title: "Remove an alert delivery channel",
      description:
        "Delete a delivery channel. Refuses while any alert still points at it — detach those first with set_alert_channel. Requires the write scope.",
      inputSchema: { channel_id: z.string().describe("From list_alert_channels.") },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    },
    async ({ channel_id }) => {
      const { db, scope } = ctx();
      try {
        requireScope(scope, "write");

        const [stillUsing] = await db
          .select({ id: schema.alerts.id, name: schema.alerts.name })
          .from(schema.alerts)
          .where(and(eq(schema.alerts.channelId, channel_id), eq(schema.alerts.organizationId, scope.organizationId)))
          .limit(1);
        if (stillUsing) {
          return failure(`Alert "${stillUsing.name}" still delivers here. Call set_alert_channel to point it elsewhere first.`);
        }

        const [deleted] = await db
          .delete(schema.alertChannels)
          .where(and(eq(schema.alertChannels.id, channel_id), eq(schema.alertChannels.organizationId, scope.organizationId)))
          .returning();

        if (!deleted) return failure("No such channel.");
        return text(`Removed channel **${deleted.name}**.`);
      } catch (error) {
        return failure(message(error));
      }
    },
  );

  server.registerTool(
    "set_alert_channel",
    {
      title: "Attach or detach an alert's delivery channel",
      description: "Point an alert at a delivery channel, or pass no channel_id to detach it. Requires the write scope.",
      inputSchema: {
        alert_id: z.string().describe("From list_alerts."),
        channel_id: z.string().optional().describe("From list_alert_channels; omit to detach."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async ({ alert_id, channel_id }) => {
      const { db, scope } = ctx();
      try {
        requireScope(scope, "write");

        if (channel_id) {
          const [channel] = await db
            .select({ id: schema.alertChannels.id })
            .from(schema.alertChannels)
            .where(and(eq(schema.alertChannels.id, channel_id), eq(schema.alertChannels.organizationId, scope.organizationId)))
            .limit(1);
          if (!channel) return failure("No such channel.");
        }

        const [updated] = await db
          .update(schema.alerts)
          .set({ channelId: channel_id ?? null })
          .where(and(eq(schema.alerts.id, alert_id), eq(schema.alerts.organizationId, scope.organizationId)))
          .returning();

        if (!updated) return failure("No such alert.");
        return text(channel_id ? `**${updated.name}** now delivers to that channel.` : `**${updated.name}** detached — it delivers nowhere.`);
      } catch (error) {
        return failure(message(error));
      }
    },
  );

  server.registerTool(
    "set_alert_active",
    {
      title: "Pause or resume an alert",
      description: "Turn an alert rule on or off without deleting its definition. Requires the write scope.",
      inputSchema: {
        alert_id: z.string().describe("From list_alerts."),
        active: z.boolean(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async ({ alert_id, active }) => {
      const { db, scope } = ctx();
      try {
        requireScope(scope, "write");

        const [updated] = await db
          .update(schema.alerts)
          .set({ active })
          .where(and(eq(schema.alerts.id, alert_id), eq(schema.alerts.organizationId, scope.organizationId)))
          .returning();

        if (!updated) return failure("No such alert.");
        return text(`**${updated.name}** ${active ? "resumed" : "paused"}.`);
      } catch (error) {
        return failure(message(error));
      }
    },
  );

  server.registerTool(
    "delete_alert",
    {
      title: "Delete an alert rule",
      description: "Permanently remove an alert rule and its firing history. Requires the write scope.",
      inputSchema: { alert_id: z.string().describe("From list_alerts.") },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    },
    async ({ alert_id }) => {
      const { db, scope } = ctx();
      try {
        requireScope(scope, "write");

        const [deleted] = await db
          .delete(schema.alerts)
          .where(and(eq(schema.alerts.id, alert_id), eq(schema.alerts.organizationId, scope.organizationId)))
          .returning();

        if (!deleted) return failure("No such alert.");
        return text(`Deleted alert **${deleted.name}**.`);
      } catch (error) {
        return failure(message(error));
      }
    },
  );

  server.registerTool(
    "list_alert_events",
    {
      title: "Alert firing history",
      description: "Recent firings, resolutions and evaluation errors for one alert — how noisy it actually is.",
      inputSchema: {
        alert_id: z.string().describe("From list_alerts."),
        limit: z.number().int().min(1).max(200).optional().default(50),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ alert_id, limit }) => {
      const { db, scope } = ctx();
      try {
        const [alert] = await db
          .select({ id: schema.alerts.id, name: schema.alerts.name })
          .from(schema.alerts)
          .where(and(eq(schema.alerts.id, alert_id), eq(schema.alerts.organizationId, scope.organizationId)))
          .limit(1);
        if (!alert) return failure("No such alert.");

        const rows = await db
          .select()
          .from(schema.alertEvents)
          .where(eq(schema.alertEvents.alertId, alert_id))
          .orderBy(desc(schema.alertEvents.createdAt))
          .limit(limit);

        return text(
          `**${alert.name} — firing history**\n\n` +
            table(
              rows,
              [
                { header: "When", get: (r) => ago(r.createdAt.toISOString()) },
                { header: "Status", get: (r) => r.status },
                { header: "Observed", get: (r) => r.observedValue ?? "—" },
                { header: "Expected", get: (r) => r.expectedValue ?? "—" },
                { header: "Message", get: (r) => r.message ?? "—" },
                { header: "Delivered", get: (r) => (r.deliveredAt ? ago(r.deliveredAt.toISOString()) : r.deliveryError ? `failed: ${r.deliveryError}` : "—") },
              ],
              "Never fired.",
            ),
        );
      } catch (error) {
        return failure(message(error));
      }
    },
  );

  server.registerTool(
    "get_digest_setting",
    {
      title: "Weekly digest email setting",
      description: "Whether the weekly AI-signals summary email is enabled for this organization.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      const { db, scope } = ctx();
      try {
        const [org] = await db
          .select({ enabled: schema.organizations.weeklyDigestEnabled })
          .from(schema.organizations)
          .where(eq(schema.organizations.id, scope.organizationId))
          .limit(1);
        if (!org) return failure("Organization not found.");
        return text(
          `Weekly digest is **${org.enabled ? "on" : "off"}**.\n\n` +
            (org.enabled
              ? "Every owner and admin gets a weekly email with all four AI signals (content, sales, marketing, product) for every non-archived project, sent by the worker's Sunday cron job."
              : "No weekly email is sent. There is no on-demand \"send now\" — the only trigger is the weekly schedule."),
        );
      } catch (error) {
        return failure(message(error));
      }
    },
  );

  server.registerTool(
    "set_digest_enabled",
    {
      title: "Turn the weekly digest email on or off",
      description: "Enable or disable the weekly AI-signals summary email for every owner and admin in this organization. Requires the write scope.",
      inputSchema: { enabled: z.boolean() },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async ({ enabled }) => {
      const { db, scope } = ctx();
      try {
        requireScope(scope, "write");
        await db
          .update(schema.organizations)
          .set({ weeklyDigestEnabled: enabled, updatedAt: new Date() })
          .where(eq(schema.organizations.id, scope.organizationId));
        return text(`Weekly digest turned **${enabled ? "on" : "off"}**.`);
      } catch (error) {
        return failure(message(error));
      }
    },
  );

  server.registerTool(
    "archive_project",
    {
      title: "Archive a property",
      description:
        "Archive a property. Not a delete — there is no hard delete anywhere in this platform: " +
        "the row and its event history stay, under their normal retention window, so a re-created " +
        "property with the same slug can never silently inherit another one's history. An archived " +
        "property drops off every dashboard list and every other tool's \"all\" scope. Requires the " +
        "write scope.",
      inputSchema: { project: z.string().describe("Project slug.") },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ project }) => {
      const { db, scope } = ctx();
      try {
        requireScope(scope, "write");
        const [id] = resolveProjects(scope, project);
        const row = scope.projects.find((p) => p.id === id)!;

        const [archived] = await db
          .update(schema.projects)
          .set({ archivedAt: new Date(), updatedAt: new Date() })
          .where(and(eq(schema.projects.id, id!), eq(schema.projects.organizationId, scope.organizationId)))
          .returning({ slug: schema.projects.slug });
        if (!archived) return failure("No such property.");

        return text(`Archived **${row.name}** (${archived.slug}). Its data is kept under its retention window.`);
      } catch (error) {
        return failure(message(error));
      }
    },
  );
}

async function getCollectorHealth(): Promise<{
  reachable: boolean;
  redis: boolean;
  tracker: boolean;
  geoSource: string;
}> {
  const base = process.env.FALORB_INGEST_URL ?? "http://localhost:3001";
  try {
    const response = await fetch(`${base.replace(/\/$/, "")}/health`, {
      signal: AbortSignal.timeout(4_000),
    });
    if (!response.ok) return { reachable: false, redis: false, tracker: false, geoSource: "none" };
    const body = (await response.json()) as { redis?: boolean; tracker?: boolean; geoSource?: string };
    return {
      reachable: true,
      redis: body.redis === true,
      tracker: body.tracker === true,
      geoSource: body.geoSource ?? "none",
    };
  } catch {
    return { reachable: false, redis: false, tracker: false, geoSource: "none" };
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
