/**
 * Typed client for GitHub's Contents API — the write path for "commit an
 * AI-drafted blog post to the owner's own repo." GitHub only for v1: GitLab's
 * Repository Files API differs enough (separate create/update verbs,
 * project-ID addressing rather than owner/repo) that abstracting both behind
 * one interface now would mean guessing at a shared shape before a second
 * real implementation exists to validate it.
 *
 * Decryption of the stored PAT always happens at the call site (the server
 * action or API route), never inside this client — same convention as
 * `LinkiClient`/`BundAiClient`/`BufferClient`.
 */

export * from "./paths";

export const GITHUB_API_ENDPOINT = "https://api.github.com";

export interface GitBlogClientOptions {
  baseUrl: string;
  apiKey: string;
  timeoutMs?: number;
}

export class GitHubApiError extends Error {
  constructor(
    public status: number,
    public body: unknown,
  ) {
    super(`GitHub API error (HTTP ${status}): ${JSON.stringify(body)}`);
  }
}

export interface RepoFile {
  path: string;
  /** The blob SHA GitHub requires as proof-of-current-state when updating this file. */
  sha: string;
  content: string;
}

export interface CommitResult {
  commitSha: string;
  contentSha: string;
  /** The file's github.com URL at this commit. */
  htmlUrl: string;
}

export interface CreateOrUpdateFileInput {
  owner: string;
  repo: string;
  branch: string;
  path: string;
  content: string;
  message: string;
  /** Pass the current file's `sha` (from `getFile`) when updating — omit only when creating a new file. */
  sha?: string;
  authorName?: string;
  authorEmail?: string;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const API_VERSION = "2022-11-28";

interface GitHubContentsResponse {
  sha: string;
  content: string;
  encoding: string;
}

interface GitHubPutResponse {
  content: { sha: string; html_url: string };
  commit: { sha: string };
}

export class GitHubBlogClient {
  private baseUrl: string;
  private apiKey: string;
  private timeoutMs: number;

  constructor(opts: GitBlogClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.apiKey = opts.apiKey;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  private async request<T>(
    method: string,
    path: string,
    opts?: { query?: Record<string, string | undefined>; body?: unknown },
  ): Promise<{ status: number; body: T | null }> {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(opts?.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, value);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(url, {
        method,
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json",
          "X-GitHub-Api-Version": API_VERSION,
        },
        body: opts?.body !== undefined ? JSON.stringify(opts.body) : undefined,
      });

      const body = (await response.json().catch(() => null)) as T | null;
      return { status: response.status, body };
    } finally {
      clearTimeout(timer);
    }
  }

  /** GET /repos/{owner}/{repo}/contents/{path} — null if the file doesn't exist yet (a create, not an update). */
  async getFile(owner: string, repo: string, path: string, branch: string): Promise<RepoFile | null> {
    const { status, body } = await this.request<GitHubContentsResponse>(
      "GET",
      `/repos/${owner}/${repo}/contents/${encodePath(path)}`,
      { query: { ref: branch } },
    );
    if (status === 404) return null;
    if (status < 200 || status >= 300 || !body) throw new GitHubApiError(status, body);
    return {
      path,
      sha: body.sha,
      content: Buffer.from(body.content, body.encoding === "base64" ? "base64" : "utf-8").toString("utf-8"),
    };
  }

  /**
   * PUT /repos/{owner}/{repo}/contents/{path}. Pass `sha` (from `getFile`)
   * when updating an existing file — GitHub 409s on an update without it.
   */
  async createOrUpdateFile(input: CreateOrUpdateFileInput): Promise<CommitResult> {
    const { status, body } = await this.request<GitHubPutResponse>(
      "PUT",
      `/repos/${input.owner}/${input.repo}/contents/${encodePath(input.path)}`,
      {
        body: {
          message: input.message,
          content: Buffer.from(input.content, "utf-8").toString("base64"),
          branch: input.branch,
          sha: input.sha,
          committer:
            input.authorName && input.authorEmail
              ? { name: input.authorName, email: input.authorEmail }
              : undefined,
        },
      },
    );
    if (status < 200 || status >= 300 || !body) throw new GitHubApiError(status, body);
    return {
      commitSha: body.commit.sha,
      contentSha: body.content.sha,
      htmlUrl: body.content.html_url,
    };
  }

  /** GET /repos/{owner}/{repo}/branches/{branch} — used when saving repo config, to confirm the branch exists. */
  async getBranch(owner: string, repo: string, branch: string): Promise<{ ok: boolean }> {
    const { status } = await this.request("GET", `/repos/${owner}/${repo}/branches/${branch}`);
    return { ok: status >= 200 && status < 300 };
  }

  /** GET /repos/{owner}/{repo} — confirms the PAT can read this one repo. Never throws. */
  async verifyConnection(owner?: string, repo?: string): Promise<{ ok: boolean; detail: string }> {
    if (!owner || !repo) {
      return { ok: false, detail: "No repo configured yet — add an owner and repo name." };
    }
    try {
      const { status, body } = await this.request<{ full_name: string }>("GET", `/repos/${owner}/${repo}`);
      if (status >= 200 && status < 300) {
        return { ok: true, detail: `GitHub reachable — connected to ${body?.full_name ?? `${owner}/${repo}`}.` };
      }
      return { ok: false, detail: `GitHub returned HTTP ${status} for ${owner}/${repo}.` };
    } catch (error) {
      return { ok: false, detail: String(error) };
    }
  }
}

/** Encodes each path segment separately so slashes in a multi-segment path stay literal. */
function encodePath(path: string): string {
  return path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}
