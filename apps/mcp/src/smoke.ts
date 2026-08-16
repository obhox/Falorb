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

console.log("discovery");
await call("list_projects");
await call("list_event_names", { range: "90d" });
await call("list_property_keys", { range: "90d" });
await call("describe_filters");

console.log("\nanalytics");
await call("get_overview", { range: "30d" });
await call("get_stats", { project: "linkbry", range: "30d" });
await call("get_trend", { project: "linkbry", range: "30d", metric: "visitors" });
await call("get_trend", { range: "30d", metric: "visitors", breakdown: "channel" });
await call("get_breakdown", { range: "30d", field: "path", limit: 5 });
await call("get_breakdown", { range: "30d", field: "prop:content_tag", limit: 5 });
await call("get_retention", { range: "60d", granularity: "week", periods: 4 });
await call("get_stickiness", { range: "30d" });
await call("get_dropoff", { project: "linkbry", range: "30d", min_pageviews: 1 });
await call("get_user_flows", { range: "30d", limit: 5 });

console.log("\nfunnels");
const steps = [
  { label: "Home", event: "$pageview", filters: [{ field: "path", op: "eq", value: "/" }] },
  { label: "Pricing", event: "$pageview", filters: [{ field: "path", op: "eq", value: "/pricing" }] },
  { label: "Signup", event: "$pageview", filters: [{ field: "path", op: "eq", value: "/signup" }] },
];
await call("run_funnel", { project: "linkbry", range: "30d", steps });
await call("get_funnel_dropoffs", { project: "linkbry", range: "30d", steps, at_step: 2, limit: 5 });

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
await call("get_install_snippet", { project: "obhox" });

console.log("\nnegative cases (these SHOULD be rejected)");
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
await expectError("get_stats", { project: "does-not-exist" }, "unknown project rejected");
await expectError("get_breakdown", { field: "evil; DROP TABLE events" }, "injection attempt rejected");
await expectError("get_stats", { range: "not-a-range" }, "malformed range rejected");
await expectError("get_person", { person_id: "abc" }, "non-UUID person id rejected");

console.log("\nresources & prompts");
const { resources } = await client.listResources();
console.log(`  ✓ ${resources.length} resources: ${resources.map((r) => r.name).join(", ")}`);
const { prompts } = await client.listPrompts();
console.log(`  ✓ ${prompts.length} prompts: ${prompts.map((p) => p.name).join(", ")}`);
passed += 2;

await client.close();
console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
