import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

/**
 * Connects a real MCP client to this server over stdio and exercises every
 * tool.
 *
 * Typechecking proves the tool code compiles; it cannot prove the server
 * negotiates a protocol handshake, that the schemas are valid MCP, or that a
 * tool returns something a model can actually read. Only a client can.
 */

interface ToolResult {
  content?: Array<{ type: string; text?: string }>;
  isError?: boolean;
}

let passed = 0;
let failed = 0;

const client = new Client({ name: "falorb-smoke", version: "0.1.0" });
const transport = new StdioClientTransport({
  command: "npx",
  args: ["tsx", new URL("./index.ts", import.meta.url).pathname],
  env: {
    ...(process.env as Record<string, string>),
    // Keep the child quiet unless something breaks.
    NODE_NO_WARNINGS: "1",
  },
});

await client.connect(transport);

const info = client.getServerVersion();
console.log(`\nconnected to ${info?.name} v${info?.version}\n`);

const { tools } = await client.listTools();
console.log(`${tools.length} tools registered\n`);

async function call(name: string, args: Record<string, unknown> = {}): Promise<void> {
  try {
    const result = (await client.callTool({ name, arguments: args })) as ToolResult;
    const body = result.content?.[0]?.text ?? "";
    const firstLine = body.split("\n").find((l) => l.trim()) ?? "(empty)";

    if (result.isError) {
      console.log(`  ✗ ${name.padEnd(26)} ${firstLine.slice(0, 90)}`);
      failed++;
      return;
    }
    console.log(`  ✓ ${name.padEnd(26)} ${String(body.length).padStart(5)} chars  ${firstLine.slice(0, 60)}`);
    passed++;
  } catch (error) {
    console.log(`  ✗ ${name.padEnd(26)} ${(String(error).split("\n")[0] ?? "").slice(0, 90)}`);
    failed++;
  }
}

async function expectError(name: string, args: Record<string, unknown>, why: string): Promise<void> {
  const result = (await client.callTool({ name, arguments: args })) as ToolResult;
  if (result.isError) {
    console.log(`  ✓ ${why}`);
    passed++;
  } else {
    console.log(`  ✗ ${why} — was ACCEPTED but should have failed`);
    failed++;
  }
}

console.log("discovery");
await call("list_projects");
await call("list_event_names", { range: "90d" });
await call("list_property_keys", { range: "90d" });
await call("describe_filters");

console.log("\nanalytics");
await call("get_overview", { range: "30d" });
await call("get_stats", { project: "beacon", range: "30d" });
await call("get_trend", { project: "beacon", range: "30d", metric: "visitors" });
await call("get_trend", { range: "30d", metric: "visitors", breakdown: "channel" });
await call("get_breakdown", { range: "30d", field: "path", limit: 5 });
await call("get_breakdown", { range: "30d", field: "prop:content_tag", limit: 5 });
await call("get_retention", { range: "60d", granularity: "week", periods: 4 });
await call("get_stickiness", { range: "30d" });
await call("get_dropoff", { project: "beacon", range: "30d", min_pageviews: 1 });
await call("get_user_flows", { range: "30d", limit: 5 });

console.log("\nfunnels");
const steps = [
  { label: "Home", event: "$pageview", filters: [{ field: "path", op: "eq", value: "/" }] },
  { label: "Pricing", event: "$pageview", filters: [{ field: "path", op: "eq", value: "/pricing" }] },
  { label: "Signup", event: "$pageview", filters: [{ field: "path", op: "eq", value: "/signup" }] },
];
await call("run_funnel", { project: "beacon", range: "30d", steps });
await call("get_funnel_dropoffs", { project: "beacon", range: "30d", steps, at_step: 2, limit: 5 });

console.log("\npeople");
await call("list_people", { range: "30d", limit: 5 });
await call("find_cross_project_people", { range: "30d" });
await call("list_sessions", { range: "30d", limit: 5 });
await call("search_people", { query: "user" });

console.log("\nlive & ops");
await call("get_live_visitors", { window_minutes: 60 });
await call("get_event_stream", { window_minutes: 1440, limit: 5 });
await call("get_platform_health", { window_hours: 168 });
await call("list_alerts");
await call("get_install_snippet", { project: "acme" });

console.log("\nprospecting");
await call("list_prospects", { limit: 5 });
await call("list_prospect_keywords");

console.log("\ncrm (Linki mirror)");
await call("list_crm_contacts", { limit: 5 });
await call("list_crm_deals", { limit: 5 });
await call("list_crm_lists");
await call("list_crm_workflows");
await call("list_crm_runs", { limit: 5 });
await call("list_crm_signal_rules");
await call("list_crm_sent_messages", { limit: 5 });
await call("list_crm_suppressions", { limit: 5 });

console.log("\nsupport (Bund AI mirror)");
await call("list_support_conversations", { limit: 5 });
await call("list_support_escalations", { limit: 5 });
await call("list_support_leads", { limit: 5 });
await call("list_support_tickets", { limit: 5 });

console.log("\nsocial (Buffer mirror)");
await call("list_social_channels");
await call("list_social_posts", { limit: 5 });

console.log("\nintegrations");
await call("get_integration_status");

console.log("\ntasks (create → read → edit → reassign → comment → close → delete)");
let taskId = "";
{
  const result = (await client.callTool({
    name: "create_task",
    arguments: { title: "Smoke test task", body: "Created by the MCP smoke suite." },
  })) as ToolResult;
  const body = result.content?.[0]?.text ?? "";
  taskId = body.match(/`([0-9a-f-]{36})`/)?.[1] ?? "";
  console.log(`  ${result.isError || !taskId ? "✗" : "✓"} create_task${taskId ? ` (${taskId.slice(0, 8)})` : ""}`);
  taskId ? passed++ : failed++;
}
if (taskId) {
  await call("list_tasks", { limit: 5 });
  await call("get_task", { task_id: taskId });
  await call("update_task", { task_id: taskId, priority: "high" });
  await call("assign_task", { task_id: taskId, assignee: "unassigned" });
  await call("comment_on_task", { task_id: taskId, body: "Smoke check." });
  await call("set_task_status", { task_id: taskId, status: "done" });
  await call("delete_task", { task_id: taskId });
}

console.log("\nagents (hire → read → edit → pause/resume → run history → retire)");
let agentId = "";
{
  const result = (await client.callTool({
    name: "hire_agent",
    arguments: { preset: "growth-analyst", name: `Smoke Test Analyst ${Date.now()}` },
  })) as ToolResult;
  const body = result.content?.[0]?.text ?? "";
  agentId = body.match(/`([0-9a-f-]{36})`/)?.[1] ?? "";
  console.log(`  ${result.isError || !agentId ? "✗" : "✓"} hire_agent${agentId ? ` (${agentId.slice(0, 8)})` : ""}`);
  agentId ? passed++ : failed++;
}
if (agentId) {
  await call("list_agents", { limit: 5 });
  await call("get_agent", { agent_id: agentId });
  await call("update_agent", { agent_id: agentId, autonomy: "assisted" });
  await call("set_agent_status", { agent_id: agentId, status: "paused" });
  await call("set_agent_status", { agent_id: agentId, status: "active" });
  await call("list_agent_runs", { agent_id: agentId, limit: 5 });
  await call("list_agent_approvals");
  await call("retire_agent", { agent_id: agentId });
}

console.log("\ncrm/support/social write tools (no provider connected — should refuse cleanly)");
await expectError(
  "create_crm_contact",
  { person_id: "00000000-0000-0000-0000-000000000000", linkedin_url: "https://linkedin.com/in/nobody" },
  "create_crm_contact refused a non-existent person",
);
await expectError(
  "push_crm_signal",
  { person_id: "00000000-0000-0000-0000-000000000000", type: "custom", title: "test" },
  "push_crm_signal refused an unlinked person",
);
await expectError(
  "resolve_support_escalation",
  { escalation_id: "00000000-0000-0000-0000-000000000000", resolution: "smoke test resolution text" },
  "resolve_support_escalation refused a non-existent escalation",
);
await expectError(
  "create_social_post",
  { text: "smoke test", channel_ids: ["nonexistent"] },
  "create_social_post refused — Buffer not connected",
);
await expectError(
  "delete_social_post",
  { post_id: "nonexistent" },
  "delete_social_post refused — Buffer not connected",
);

console.log("\nmerge/unmerge (negative path only — a live merge is not run against shared dev data)");
await expectError(
  "merge_people",
  { survivor_id: "00000000-0000-0000-0000-000000000000", merged_id: "11111111-1111-1111-1111-111111111111" },
  "merge_people refused two non-existent people",
);
await expectError(
  "unmerge_people",
  { merge_id: "00000000-0000-0000-0000-000000000000" },
  "unmerge_people refused a non-existent merge",
);

console.log("\nUGC video");
await call("list_ugc_video_models");
await call("list_ugc_videos", { limit: 5 });
await expectError(
  "create_ugc_video",
  { brief: "smoke test", video_model: "creatify-aurora", voice_id: "x", presenter_image_base64: "AA==", presenter_image_mime_type: "image/png" },
  "create_ugc_video refused — ElevenLabs not connected",
);

console.log("\nnegative cases (these SHOULD be rejected)");
await expectError("get_stats", { project: "does-not-exist" }, "unknown project rejected");
await expectError("get_breakdown", { field: "evil; DROP TABLE events" }, "injection attempt rejected");
await expectError("get_stats", { range: "not-a-range" }, "malformed range rejected");
await expectError("get_person", { person_id: "abc" }, "non-UUID person id rejected");

console.log("\nlocal-operator-only tools (this smoke client authenticates via bearer key — every one of these MUST be refused)");
await expectError(
  "connect_integration",
  { provider: "openrouter", api_key: "sk-test" },
  "connect_integration refused to a bearer key",
);
await expectError(
  "test_integration_connection",
  { provider: "openrouter" },
  "test_integration_connection refused to a bearer key",
);
await expectError(
  "revoke_integration_connection",
  { provider: "openrouter" },
  "revoke_integration_connection refused to a bearer key",
);
await expectError(
  "set_integration_model",
  { provider: "openrouter", model: "openrouter/auto" },
  "set_integration_model refused to a bearer key",
);
await expectError(
  "request_person_erasure",
  { person_id: "00000000-0000-0000-0000-000000000000" },
  "request_person_erasure refused to a bearer key",
);

console.log("\nresources & prompts");
const { resources } = await client.listResources();
console.log(`  ✓ ${resources.length} resources: ${resources.map((r) => r.name).join(", ")}`);
const { prompts } = await client.listPrompts();
console.log(`  ✓ ${prompts.length} prompts: ${prompts.map((p) => p.name).join(", ")}`);
passed += 2;

await client.close();
console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
