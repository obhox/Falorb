import { afterEach, describe, expect, it, vi } from "vitest";
import { GitHubApiError, GitHubBlogClient } from "./index";

interface Call {
  method: string;
  url: URL;
  headers: Record<string, string>;
  body: unknown;
}

/** Stubs global `fetch`; `handler` sees each request in order and answers it. */
function mockGitHub(handler: (call: Call, index: number) => { status: number; body: unknown }): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", async (url: URL, init: RequestInit) => {
    const call: Call = {
      method: init.method ?? "GET",
      url,
      headers: init.headers as Record<string, string>,
      body: init.body ? JSON.parse(init.body as string) : undefined,
    };
    calls.push(call);
    const reply = handler(call, calls.length - 1);
    return {
      ok: reply.status >= 200 && reply.status < 300,
      status: reply.status,
      json: async () => reply.body,
    } as unknown as Response;
  });
  return calls;
}

const client = () => new GitHubBlogClient({ baseUrl: "https://api.github.com", apiKey: "ghp_test" });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getFile", () => {
  it("decodes base64 content and returns the blob sha on a hit", async () => {
    const calls = mockGitHub(() => ({
      status: 200,
      body: { sha: "abc123", content: Buffer.from("hello world").toString("base64"), encoding: "base64" },
    }));

    const file = await client().getFile("acme", "blog", "content/blog/hello.md", "main");

    expect(file).toEqual({ path: "content/blog/hello.md", sha: "abc123", content: "hello world" });
    expect(calls[0]!.method).toBe("GET");
    expect(calls[0]!.url.pathname).toBe("/repos/acme/blog/contents/content/blog/hello.md");
    expect(calls[0]!.url.searchParams.get("ref")).toBe("main");
    expect(calls[0]!.headers.Authorization).toBe("Bearer ghp_test");
  });

  it("returns null on a 404 rather than throwing", async () => {
    mockGitHub(() => ({ status: 404, body: { message: "Not Found" } }));

    const file = await client().getFile("acme", "blog", "content/blog/missing.md", "main");

    expect(file).toBeNull();
  });

  it("throws GitHubApiError on other non-2xx statuses", async () => {
    mockGitHub(() => ({ status: 401, body: { message: "Bad credentials" } }));

    await expect(client().getFile("acme", "blog", "content/blog/hello.md", "main")).rejects.toThrow(
      GitHubApiError,
    );
  });

  it("percent-encodes each path segment without escaping the slashes between them", async () => {
    const calls = mockGitHub(() => ({ status: 404, body: {} }));

    await client().getFile("acme", "blog", "content/my post & stuff.md", "main");

    const segments = calls[0]!.url.pathname.split("/");
    // Slashes stay as real path separators (7 segments, not one encoded blob)...
    expect(segments).toHaveLength(7);
    // ...while the space and ampersand within the last segment are percent-encoded.
    expect(segments.at(-1)).toBe(encodeURIComponent("my post & stuff.md"));
    expect(decodeURIComponent(segments.at(-1)!)).toBe("my post & stuff.md");
  });
});

describe("createOrUpdateFile", () => {
  it("creates a new file with no sha in the request body", async () => {
    const calls = mockGitHub(() => ({
      status: 201,
      body: { content: { sha: "newsha", html_url: "https://github.com/acme/blog/blob/main/x.md" }, commit: { sha: "commitsha" } },
    }));

    const result = await client().createOrUpdateFile({
      owner: "acme",
      repo: "blog",
      branch: "main",
      path: "content/blog/x.md",
      content: "body text",
      message: "Publish: X",
    });

    expect(result).toEqual({
      commitSha: "commitsha",
      contentSha: "newsha",
      htmlUrl: "https://github.com/acme/blog/blob/main/x.md",
    });
    expect(calls[0]!.method).toBe("PUT");
    expect((calls[0]!.body as { sha?: string }).sha).toBeUndefined();
    expect((calls[0]!.body as { content: string }).content).toBe(Buffer.from("body text").toString("base64"));
  });

  it("passes sha through on an update", async () => {
    const calls = mockGitHub(() => ({
      status: 200,
      body: { content: { sha: "updatedsha", html_url: "https://github.com/acme/blog/blob/main/x.md" }, commit: { sha: "commitsha2" } },
    }));

    await client().createOrUpdateFile({
      owner: "acme",
      repo: "blog",
      branch: "main",
      path: "content/blog/x.md",
      content: "updated body",
      message: "Publish: X (update)",
      sha: "oldsha",
    });

    expect((calls[0]!.body as { sha?: string }).sha).toBe("oldsha");
  });

  it("throws GitHubApiError on a 409 (stale sha / missing sha on update)", async () => {
    mockGitHub(() => ({ status: 409, body: { message: "does not match" } }));

    await expect(
      client().createOrUpdateFile({
        owner: "acme",
        repo: "blog",
        branch: "main",
        path: "content/blog/x.md",
        content: "body",
        message: "Publish: X",
      }),
    ).rejects.toThrow(GitHubApiError);
  });

  it("includes a committer only when both name and email are given", async () => {
    const calls = mockGitHub(() => ({
      status: 200,
      body: { content: { sha: "s", html_url: "u" }, commit: { sha: "c" } },
    }));

    await client().createOrUpdateFile({
      owner: "acme",
      repo: "blog",
      branch: "main",
      path: "content/blog/x.md",
      content: "body",
      message: "Publish: X",
      authorName: "Falorb",
      authorEmail: "bot@falorb.com",
    });

    expect((calls[0]!.body as { committer?: unknown }).committer).toEqual({
      name: "Falorb",
      email: "bot@falorb.com",
    });
  });
});

describe("verifyConnection", () => {
  it("reports ok on a 200", async () => {
    mockGitHub(() => ({ status: 200, body: { full_name: "acme/blog" } }));

    const result = await client().verifyConnection("acme", "blog");

    expect(result.ok).toBe(true);
    expect(result.detail).toContain("acme/blog");
  });

  it("reports not ok on a 404, without throwing", async () => {
    mockGitHub(() => ({ status: 404, body: { message: "Not Found" } }));

    const result = await client().verifyConnection("acme", "missing-repo");

    expect(result.ok).toBe(false);
  });

  it("reports not ok on a 401, without throwing", async () => {
    mockGitHub(() => ({ status: 401, body: { message: "Bad credentials" } }));

    const result = await client().verifyConnection("acme", "blog");

    expect(result.ok).toBe(false);
  });

  it("reports not ok when no repo is configured yet, without calling fetch", async () => {
    const calls = mockGitHub(() => ({ status: 200, body: {} }));

    const result = await client().verifyConnection();

    expect(result.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });
});
