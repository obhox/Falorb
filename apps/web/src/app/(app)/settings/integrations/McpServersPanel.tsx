"use client";

import { useState } from "react";
import { Badge, Button, Card, Dialog, Icon, IconButton, Input } from "@falorb/ui";
import { Empty } from "@/components/Empty";
import { useAction } from "@/lib/use-action";
import { relative, shortDate } from "@/lib/format";
import { connectMcpServer, revokeMcpServerConnection, testMcpServerConnection } from "@/server/actions/mcp-servers";
import type { McpServerView } from "@/server/mcp-servers";

/**
 * Remote MCP servers this organization has connected. Distinct from
 * Settings → MCP & API keys, which is the other direction — that page is
 * about an assistant connecting *to* Falorb; this one is about Falorb's own
 * AI employees connecting *out* to somebody else's MCP server (the `mcp`
 * toolkit in `@falorb/agents`: `list_mcp_tools`/`call_mcp_tool`). Connecting
 * and testing happen here; only an agent actually calls a connected
 * server's tools.
 */
export function McpServersPanel({
  servers,
  canManage,
  now,
}: {
  servers: McpServerView[];
  canManage: boolean;
  now: number;
}) {
  const { run, pending } = useAction();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [apiKey, setApiKey] = useState("");

  async function submit() {
    const data = new FormData();
    data.set("name", name);
    data.set("url", url);
    if (apiKey.trim()) data.set("apiKey", apiKey.trim());
    const result = await run(() => connectMcpServer(data));
    if (result?.ok) {
      setOpen(false);
      setName("");
      setUrl("");
      setApiKey("");
    }
  }

  return (
    <>
      <Card
        title="MCP servers"
        subtitle="Remote MCP servers your AI employees can call tools on — grant the “mcp” toolkit to an agent to let it use them"
        action={
          canManage ? (
            <Button
              size="sm"
              variant="primary"
              iconLeft={<Icon name="plus" size={13} />}
              onClick={() => setOpen(true)}
            >
              Connect a server
            </Button>
          ) : undefined
        }
      >
        {servers.length === 0 ? (
          <Empty
            icon="plug"
            title="No MCP servers connected"
            body="Connect one to let your agents call its tools — a Notion server, an internal tools server, anything that speaks MCP."
          />
        ) : (
          <div style={{ display: "grid", gap: "var(--space-2)" }}>
            {servers.map((server) => (
              <div
                key={server.id}
                style={{
                  display: "grid",
                  gap: 6,
                  padding: "var(--space-3) 0",
                  borderBottom: "1px solid var(--grid-line)",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 12,
                    flexWrap: "wrap",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                    <span style={{ fontSize: "var(--size-body-sm)", color: "var(--text-primary)", fontWeight: "var(--wt-medium)" }}>
                      {server.name}
                    </span>
                    <span
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: "var(--size-micro)",
                        color: "var(--text-muted)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {server.url}
                    </span>
                    <Badge tone={server.status === "active" ? "up" : server.status === "error" ? "down" : "neutral"}>
                      {server.status}
                    </Badge>
                  </div>
                  {canManage && (
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flex: "0 0 auto" }}>
                      <Button
                        size="sm"
                        disabled={pending || server.status === "revoked"}
                        onClick={() => run(() => testMcpServerConnection(server.id), { quiet: true })}
                      >
                        Test
                      </Button>
                      <IconButton
                        size="sm"
                        label="Revoke connection"
                        icon={<Icon name="trash-2" size={13} />}
                        disabled={pending || server.status === "revoked"}
                        onClick={() => run(() => revokeMcpServerConnection(server.id))}
                      />
                    </div>
                  )}
                </div>
                <span style={{ fontSize: "var(--size-micro)", color: "var(--text-muted)" }}>
                  {server.toolCount === null ? "tools unknown" : `${server.toolCount} tool${server.toolCount === 1 ? "" : "s"}`} ·{" "}
                  {server.hasToken ? "token stored" : "no auth"} ·{" "}
                  {server.lastVerifiedAt ? `last verified ${relative(server.lastVerifiedAt, now)}` : "never verified"}
                  {server.lastError ? ` · ${server.lastError}` : ""} · added {shortDate(server.createdAt, now)}
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Connect an MCP server"
        subtitle="Streamable HTTP or SSE — verified by listing its tools on the spot"
        width={520}
        footer={
          <>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="primary" onClick={submit} disabled={pending || !name.trim() || !url.trim()}>
              {pending ? "Connecting…" : "Connect"}
            </Button>
          </>
        }
      >
        <div style={{ display: "grid", gap: "var(--space-6)" }}>
          <Input
            label="Name"
            value={name}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
            placeholder="Notion"
          />
          <Input
            label="URL"
            value={url}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setUrl(e.target.value)}
            placeholder="https://mcp.example.com/mcp"
          />
          <Input
            label="API key"
            value={apiKey}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setApiKey(e.target.value)}
            placeholder="Leave blank if this server needs no authentication"
          />
        </div>
      </Dialog>
    </>
  );
}
