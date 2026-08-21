/**
 * Typed client for Buffer's GraphQL API (`https://api.buffer.com`), built
 * against Buffer's public developer docs (`developers.buffer.com`) rather
 * than a live account — no personal API key was available while writing
 * this, so field/mutation names are as documented, not runtime-confirmed.
 * Treat a schema mismatch surfaced by `verifyConnection`/the sync job as
 * more authoritative than this file's shapes.
 *
 * Auth is a personal API key, not third-party OAuth: Buffer closed
 * third-party app registration in 2019 and its 2026 GraphQL beta only
 * issues personal keys scoped to one Buffer account (no "connect someone
 * else's account" flow). See FEATURES.md §13b. `baseUrl` is kept as a field
 * (rather than hardcoding the endpoint) purely so this client's option shape
 * matches `LinkiClientOptions`/`BundAiClientOptions` and needs no special
 * casing in `integration_connections` (whose `base_url` column is NOT
 * NULL) or the connect/ping dispatch code — Falorb's dashboard always fills
 * it with the fixed endpoint below since Buffer, unlike Linki/Bund AI,
 * isn't self-hosted.
 *
 * GraphQL means an error can come back as HTTP 200 with a top-level
 * `errors[]` array — `request()` checks for that explicitly rather than
 * trusting `response.ok` alone, unlike Linki/Bund AI's plain-HTTP-status
 * convention.
 */

export const BUFFER_API_ENDPOINT = "https://api.buffer.com";

export interface BufferClientOptions {
  /** Falorb always sends `BUFFER_API_ENDPOINT` here; kept as a field for option-shape parity with the other clients. */
  baseUrl: string;
  apiKey: string;
  timeoutMs?: number;
}

export class BufferApiError extends Error {
  constructor(
    public status: number,
    public errors: unknown,
  ) {
    super(`Buffer API error (HTTP ${status}): ${JSON.stringify(errors)}`);
  }
}

export interface BufferChannel {
  id: string;
  name: string | null;
  displayName: string | null;
  avatar: string | null;
  service: string;
  isDisconnected: boolean;
  isQueuePaused: boolean;
  timezone: string | null;
  weeklyPostingLimit: number | null;
  [key: string]: unknown;
}

export interface BufferPostMetric {
  type: string;
  name: string;
  value: number;
  unit: string | null;
  [key: string]: unknown;
}

export interface BufferPost {
  id: string;
  text: string | null;
  channelId: string;
  /** Serialization (ISO string vs. Unix seconds) unconfirmed — see module doc comment. */
  dueAt: string | number | null;
  sentAt: string | number | null;
  status: string;
  shareMode: string | null;
  schedulingType: string | null;
  tags: string[] | null;
  metrics: BufferPostMetric[] | null;
  metricsUpdatedAt: string | number | null;
  [key: string]: unknown;
}

export interface ListPostsParams {
  channelId?: string;
  status?: string;
  /** Cursor page size for the internal walk — not a cap on the total returned. */
  pageSize?: number;
}

export interface CreatePostInput {
  channelId: string;
  text: string;
  /** `addToQueue` (default) adds to the channel's queue; pass `dueAt` for a specific time instead. */
  mode?: "addToQueue" | "addToDraft" | "shareNow";
  dueAt?: string;
}

interface GraphQLResponse<T> {
  data?: T;
  errors?: { message: string; [key: string]: unknown }[];
}

interface PostEdge {
  cursor: string;
  node: BufferPost;
}

const POST_FIELDS = `
  id text channelId dueAt sentAt status shareMode schedulingType tags
  metrics { type name value unit }
  metricsUpdatedAt
`;

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_PAGE_SIZE = 100;

export class BufferClient {
  private baseUrl: string;
  private apiKey: string;
  private timeoutMs: number;

  constructor(opts: BufferClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.apiKey = opts.apiKey;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  private async request<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(this.baseUrl, {
        method: "POST",
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query, variables }),
      });

      const body = (await response.json().catch(() => null)) as GraphQLResponse<T> | null;
      if (!response.ok) throw new BufferApiError(response.status, body ?? "No response body.");
      if (body?.errors?.length) throw new BufferApiError(response.status, body.errors);
      if (!body || body.data === undefined) {
        throw new BufferApiError(response.status, "GraphQL response carried no data.");
      }
      return body.data;
    } finally {
      clearTimeout(timer);
    }
  }

  async listChannels(): Promise<BufferChannel[]> {
    const data = await this.request<{ channels: BufferChannel[] }>(
      `query Channels($input: ChannelsInput!) {
        channels(input: $input) {
          id name displayName avatar service isDisconnected isQueuePaused timezone weeklyPostingLimit
        }
      }`,
      { input: {} },
    );
    return data.channels;
  }

  /** Cursor-walks internally (Relay `after`/`first`) and returns every matching post. */
  async listPosts(params: ListPostsParams = {}): Promise<BufferPost[]> {
    const first = params.pageSize ?? DEFAULT_PAGE_SIZE;
    const all: BufferPost[] = [];
    let after: string | undefined;
    for (;;) {
      const data = await this.request<{
        posts: { edges: PostEdge[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } };
      }>(
        `query Posts($after: String, $first: Int, $input: PostsInput!) {
          posts(after: $after, first: $first, input: $input) {
            edges { cursor node { ${POST_FIELDS} } }
            pageInfo { hasNextPage endCursor }
          }
        }`,
        { after, first, input: { channelId: params.channelId, status: params.status } },
      );
      all.push(...data.posts.edges.map((e) => e.node));
      if (!data.posts.pageInfo.hasNextPage || !data.posts.pageInfo.endCursor) break;
      after = data.posts.pageInfo.endCursor;
    }
    return all;
  }

  /**
   * One mutation per channel — Buffer's `createPost` takes a single
   * `channelId`, not an array; publishing to multiple channels means calling
   * this once per selected channel.
   */
  async createPost(input: CreatePostInput): Promise<BufferPost> {
    const data = await this.request<{ createPost: { post: BufferPost } }>(
      `mutation CreatePost($input: CreatePostInput!) {
        createPost(input: $input) { post { ${POST_FIELDS} } }
      }`,
      { input: { channelId: input.channelId, text: input.text, mode: input.mode ?? "addToQueue", dueAt: input.dueAt } },
    );
    return data.createPost.post;
  }

  async deletePost(id: string): Promise<void> {
    await this.request<{ deletePost: { success: boolean } }>(
      `mutation DeletePost($input: DeletePostInput!) { deletePost(input: $input) { success } }`,
      { input: { id } },
    );
  }

  /**
   * No dedicated health endpoint is documented — the cheapest authenticated
   * call that proves the key works without side effects is the `account`
   * query.
   */
  async verifyConnection(): Promise<{ ok: boolean; detail: string }> {
    try {
      const data = await this.request<{ account: { id: string; email: string } }>(
        `query Account { account { id email } }`,
      );
      return { ok: true, detail: `Buffer reachable and key accepted (${data.account.email}).` };
    } catch (error) {
      if (error instanceof BufferApiError) {
        return { ok: false, detail: `Buffer returned HTTP ${error.status}: ${JSON.stringify(error.errors)}` };
      }
      return { ok: false, detail: String(error) };
    }
  }
}
