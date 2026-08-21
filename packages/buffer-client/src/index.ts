/**
 * Typed client for Buffer's GraphQL API (`https://api.buffer.com`).
 *
 * Auth is a personal API key, not third-party OAuth: Buffer closed
 * third-party app registration in 2019 and its GraphQL beta only issues
 * personal keys scoped to one Buffer account (no "connect someone else's
 * account" flow). See FEATURES.md §13b. `baseUrl` is kept as a field (rather
 * than hardcoding the endpoint) purely so this client's option shape matches
 * `LinkiClientOptions`/`BundAiClientOptions` and needs no special casing in
 * `integration_connections` (whose `base_url` column is NOT NULL) or the
 * connect/ping dispatch code — Falorb's dashboard always fills it with the
 * fixed endpoint below since Buffer, unlike Linki/Bund AI, isn't self-hosted.
 *
 * **Queries are built from the live schema, not from this file.** The first
 * version hardcoded selection sets taken from Buffer's docs, and the first
 * real key rejected them: `weeklyPostingLimit` is documented flat but is a
 * `WeeklyPostingLimit` object in the running beta schema, so every
 * `listChannels` call died with `GRAPHQL_VALIDATION_FAILED` — and, because
 * that's a validation error, it arrives as **HTTP 200** with a top-level
 * `errors[]` array. `request()` therefore checks for `errors[]` explicitly
 * rather than trusting `response.ok`, unlike Linki/Bund AI's plain-HTTP-status
 * convention, and `schema.ts` introspects the API once per client so field
 * selections, argument names, enum members and mutation payload shapes all
 * come from what Buffer actually exposes today.
 *
 * Three layers of tolerance, in order:
 *   1. introspection-driven queries (the normal path);
 *   2. if a query still fails validation, the blamed fields are dropped and it
 *      is rebuilt once — a single unexpected field costs that field, not the
 *      sync;
 *   3. if introspection itself is unavailable (some deployments disable it),
 *      conservative documented queries asking only for fields that are
 *      scalars in every version of the docs.
 *
 * `normalize.ts` then flattens whatever came back into the row shapes
 * `apps/worker/src/jobs/buffer-sync.ts` writes.
 */

import {
  BufferSchema,
  INTROSPECTION_QUERY,
  buildSelection,
  fieldsFromValidationErrors,
  filterInputObjects,
  inputValueForCandidates,
  isValidationError,
  namedTypeRef,
  planArgs,
  pruneWishes,
  resultShape,
  type FieldWish,
  type IntrospectedField,
  type IntrospectionResult,
  type ResultShape,
} from "./schema";
import {
  extractNodes,
  normalizeAccount,
  normalizeChannel,
  normalizePost,
  type BufferAccount,
  type BufferChannel,
  type BufferOrganization,
  type BufferPost,
  type BufferPostMetric,
} from "./normalize";

export * from "./normalize";
export {
  BufferSchema,
  INTROSPECTION_QUERY,
  buildSelection,
  planArgs,
  pickEnumValue,
  resultShape,
  isValidationError,
  fieldsFromValidationErrors,
  pruneWishes,
  filterInputObjects,
  inputValueForCandidates,
  type FieldWish,
} from "./schema";

export const BUFFER_API_ENDPOINT = "https://api.buffer.com";

export interface BufferClientOptions {
  /** Falorb always sends `BUFFER_API_ENDPOINT` here; kept as a field for option-shape parity with the other clients. */
  baseUrl: string;
  apiKey: string;
  timeoutMs?: number;
  /** Retries for 429/5xx/network blips only — never for a rejected query. */
  maxRetries?: number;
  /** Escape hatch for a deployment with introspection disabled: skip straight to the documented fallback queries. */
  introspect?: boolean;
}

export class BufferApiError extends Error {
  constructor(
    public status: number,
    public errors: unknown,
  ) {
    super(`Buffer API error (HTTP ${status}): ${JSON.stringify(errors)}`);
    this.name = "BufferApiError";
  }
}

export interface ListPostsParams {
  channelId?: string;
  status?: string;
  organizationId?: string;
  /** Cursor page size for the internal walk — not a cap on the total returned. */
  pageSize?: number;
}

/**
 * What the caller wants done with the post, independent of what Buffer calls
 * it this month: the schema decides whether that becomes
 * `schedulingType: "scheduled"`, `mode: "queue"`, or both.
 */
export type CreatePostMode = "queue" | "draft" | "now" | "schedule";

export interface CreatePostInput {
  channelId: string;
  text: string;
  /** Defaults to `schedule` when `dueAt` is given, `queue` otherwise. */
  mode?: CreatePostMode | "addToQueue" | "addToDraft" | "shareNow";
  dueAt?: string;
  tags?: string[];
}

interface GraphQLResponse<T> {
  data?: T;
  errors?: { message: string; [key: string]: unknown }[];
}

interface Attempt {
  query: string;
  variables: Record<string, unknown>;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_PAGE_SIZE = 100;
const DEFAULT_MAX_RETRIES = 2;
/** A cursor walk that never ends is a bug in Buffer or in us; either way, stop. */
const MAX_PAGES = 50;
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

const CHANNEL_WISHES: FieldWish[] = [
  "id",
  "name",
  "displayName",
  "avatar",
  "service",
  "isDisconnected",
  "isQueuePaused",
  "timezone",
  // Object types in the live schema — left bare on purpose so the builder
  // expands whatever subfields they actually have.
  "weeklyPostingLimit",
  "postingSchedule",
  "postingGoal",
  "allowedActions",
  { name: "organization", subfields: ["id", "name"] },
];

const POST_WISHES: FieldWish[] = [
  "id",
  "text",
  "status",
  "schedulingType",
  "shareMode",
  "dueAt",
  "sentAt",
  "tags",
  "metrics",
  "metricsUpdatedAt",
  "error",
  "channelId",
  { name: "channel", subfields: ["id"] },
];

const ACCOUNT_WISHES: FieldWish[] = [
  "id",
  "email",
  "name",
  "timezone",
  // Covers both shapes at once: unknown members are dropped, so this reads a
  // plain `[Organization]` and a Relay connection without asking which it is.
  {
    name: "organizations",
    subfields: [
      "id",
      "name",
      { name: "edges", subfields: [{ name: "node", subfields: ["id", "name"] }] },
      { name: "nodes", subfields: ["id", "name"] },
    ],
  },
];

/** Fields an error member of a mutation payload union might carry. */
const PAYLOAD_ERROR_WISHES: FieldWish[] = ["message", "code", "field", "reason"];

/**
 * Used only when introspection is unavailable: every field here is a scalar in
 * every version of Buffer's docs, so the query validates even though we
 * couldn't check. The object-typed extras (`weeklyPostingLimit`,
 * `postingSchedule`, …) are deliberately absent — an unknown shape is worth
 * less than a sync that runs.
 */
const FALLBACK_CHANNEL_SELECTION = "id name displayName avatar service isDisconnected isQueuePaused timezone";
const FALLBACK_POST_SELECTION = "id text status schedulingType dueAt sentAt";
const FALLBACK_ACCOUNT_SELECTION = "id email name organizations { id name }";

/** Spellings we'd accept for each intent, best-documented first. */
const SCHEDULING_TYPE_CANDIDATES: Record<CreatePostMode, string[]> = {
  queue: ["scheduled", "queue", "addToQueue"],
  draft: ["draft", "drafts", "addToDraft"],
  now: ["now", "immediate", "shareNow", "publish"],
  schedule: ["scheduled", "custom", "specific", "schedule"],
};

const MODE_CANDIDATES: Record<CreatePostMode, string[]> = {
  queue: ["queue", "addToQueue"],
  draft: ["draft", "addToDraft"],
  now: ["share", "now", "shareNow", "publish"],
  schedule: ["schedule", "custom", "share", "scheduled"],
};

function normalizeMode(mode: CreatePostInput["mode"], dueAt: string | undefined): CreatePostMode {
  switch (mode) {
    case "addToQueue":
      return "queue";
    case "addToDraft":
      return "draft";
    case "shareNow":
      return "now";
    case "queue":
    case "draft":
    case "now":
    case "schedule":
      return mode;
    default:
      return dueAt ? "schedule" : "queue";
  }
}

export class BufferClient {
  private baseUrl: string;
  private apiKey: string;
  private timeoutMs: number;
  private maxRetries: number;
  private introspectionEnabled: boolean;

  private schemaPromise: Promise<BufferSchema | null> | null = null;
  private schemaError: string | null = null;
  private accountPromise: Promise<BufferAccount> | null = null;

  // Pruned in place when Buffer rejects a field, so one bad field is paid for
  // once per client rather than on every call.
  private channelWishes: FieldWish[] = [...CHANNEL_WISHES];
  private postWishes: FieldWish[] = [...POST_WISHES];
  private accountWishes: FieldWish[] = [...ACCOUNT_WISHES];

  constructor(opts: BufferClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.apiKey = opts.apiKey;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.introspectionEnabled = opts.introspect ?? true;
  }

  // ---------------------------------------------------------------- transport

  private async request<T>(
    query: string,
    variables?: Record<string, unknown>,
    timeoutMs = this.timeoutMs,
  ): Promise<T> {
    let lastError: unknown = null;

    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(this.baseUrl, {
          method: "POST",
          signal: controller.signal,
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({ query, variables }),
        });

        if (!response.ok && RETRYABLE_STATUS.has(response.status) && attempt < this.maxRetries) {
          lastError = new BufferApiError(response.status, await response.text().catch(() => "No response body."));
          await this.backoff(attempt, response.headers.get("retry-after"));
          continue;
        }

        const body = (await response.json().catch(() => null)) as GraphQLResponse<T> | null;
        if (!response.ok) throw new BufferApiError(response.status, body ?? "No response body.");
        // GraphQL reports a bad query as HTTP 200 with `errors[]`.
        if (body?.errors?.length) throw new BufferApiError(response.status, body.errors);
        if (!body || body.data === undefined) {
          throw new BufferApiError(response.status, "GraphQL response carried no data.");
        }
        return body.data;
      } catch (error) {
        if (error instanceof BufferApiError) throw error;
        // Network blip or timeout: worth one more go, unlike a rejected query.
        lastError = error;
        if (attempt >= this.maxRetries) throw error;
        await this.backoff(attempt, null);
      } finally {
        clearTimeout(timer);
      }
    }

    throw lastError instanceof Error ? lastError : new BufferApiError(0, String(lastError));
  }

  private async backoff(attempt: number, retryAfter: string | null): Promise<void> {
    const header = retryAfter ? Number(retryAfter) : Number.NaN;
    const ms = Number.isFinite(header) ? Math.min(header * 1000, 10_000) : Math.min(500 * 2 ** attempt, 4_000);
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Runs the first attempt that Buffer doesn't reject as invalid. Each attempt
   * is a thunk so a later one can be rebuilt from wish lists the earlier
   * failure just pruned.
   */
  private async runAttempts<T>(attempts: (() => Attempt | null)[]): Promise<T> {
    let lastError: BufferApiError | null = null;
    const tried = new Set<string>();

    for (const make of attempts) {
      const attempt = make();
      if (!attempt) continue;
      // A rebuild that produced the same query as the one that just failed
      // has nothing new to say — don't spend a round trip proving it.
      if (tried.has(attempt.query)) continue;
      tried.add(attempt.query);
      try {
        return await this.request<T>(attempt.query, attempt.variables);
      } catch (error) {
        if (error instanceof BufferApiError && isValidationError(error.errors)) {
          this.pruneRejectedFields(error.errors);
          lastError = error;
          continue;
        }
        throw error;
      }
    }

    throw lastError ?? new BufferApiError(0, "No query this Buffer schema accepts could be built.");
  }

  /** Buffer named the fields it refused — stop asking for them. */
  private pruneRejectedFields(errors: unknown): void {
    const rejected = fieldsFromValidationErrors(errors);
    if (!rejected.length) return;
    this.channelWishes = pruneWishes(this.channelWishes, rejected);
    this.postWishes = pruneWishes(this.postWishes, rejected);
    this.accountWishes = pruneWishes(this.accountWishes, rejected);
  }

  // ------------------------------------------------------------------- schema

  /** Introspects once per client; null means "fall back to documented queries". */
  private schema(): Promise<BufferSchema | null> {
    if (!this.introspectionEnabled) return Promise.resolve(null);
    this.schemaPromise ??= this.request<IntrospectionResult>(
      INTROSPECTION_QUERY,
      undefined,
      Math.max(this.timeoutMs, 30_000),
    )
      .then((result) => (result?.__schema ? new BufferSchema(result) : null))
      .catch((error: unknown) => {
        this.schemaError = error instanceof BufferApiError ? error.message : String(error);
        return null;
      });
    return this.schemaPromise;
  }

  private connectionBody(schema: BufferSchema, shape: ResultShape, selection: string): string {
    if (!shape || shape.kind !== "connection") return selection;
    const container = shape.via === "edges" ? `edges { node { ${selection} } }` : `nodes { ${selection} }`;
    const pageInfo = schema.field(shape.typeName, "pageInfo") ? " pageInfo { hasNextPage endCursor }" : "";
    return `${container}${pageInfo}`;
  }

  private nodeTypeName(shape: ResultShape): string | null {
    if (!shape) return null;
    return shape.kind === "connection" ? shape.nodeTypeName : shape.typeName;
  }

  private plannedQuery(
    schema: BufferSchema,
    operation: "query" | "mutation",
    name: string,
    field: IntrospectedField | null,
    rootField: string,
    args: Record<string, unknown>,
    body: string,
  ): Attempt | null {
    if (!field || !body) return null;
    const plan = planArgs(field, args);
    if (plan.missingRequired.length) return null;
    return {
      query: `${operation} ${name}${plan.variableDefinitions} { ${rootField}${plan.argumentList} { ${body} } }`,
      variables: filterInputObjects(schema, field, plan.variables),
    };
  }

  // ------------------------------------------------------------------ account

  /** Cached per client: channels/posts may need an organization id, and one account lookup answers that. */
  async getAccount(): Promise<BufferAccount> {
    this.accountPromise ??= this.fetchAccount();
    return this.accountPromise;
  }

  private async fetchAccount(): Promise<BufferAccount> {
    const schema = await this.schema();
    const field = schema?.queryField("account") ?? null;

    const data = await this.runAttempts<Record<string, unknown>>([
      () => {
        if (!schema || !field) return null;
        const shape = resultShape(schema, field);
        const selection = buildSelection(schema, this.nodeTypeName(shape), this.accountWishes);
        return this.plannedQuery(schema, "query", "FalorbBufferAccount", field, "account", {}, selection);
      },
      () => {
        if (!schema || !field) return null;
        const shape = resultShape(schema, field);
        const selection = buildSelection(schema, this.nodeTypeName(shape), this.accountWishes);
        return this.plannedQuery(schema, "query", "FalorbBufferAccount", field, "account", {}, selection);
      },
      () => ({ query: `query FalorbBufferAccount { account { ${FALLBACK_ACCOUNT_SELECTION} } }`, variables: {} }),
      () => ({ query: `query FalorbBufferAccount { account { id email } }`, variables: {} }),
    ]);

    const account = normalizeAccount(data?.account);
    if (!account) throw new BufferApiError(200, "Buffer returned no account for this API key.");
    return account;
  }

  async listOrganizations(): Promise<BufferOrganization[]> {
    return (await this.getAccount()).organizations;
  }

  // ----------------------------------------------------------------- channels

  /**
   * Every channel the key can see. Buffer scopes `channels` to one
   * organization on schemas that require it, so with no argument this walks
   * the account's organizations and merges the result, de-duplicated by
   * channel id.
   */
  async listChannels(organizationId?: string): Promise<BufferChannel[]> {
    const schema = await this.schema();
    const field = schema?.queryField("channels") ?? null;

    if (organizationId) return this.channelsFor(schema, field, organizationId);

    const needsOrg = Boolean(
      field?.args?.some((arg) => arg.type.kind === "NON_NULL" && /organization/i.test(arg.name)),
    );
    if (!needsOrg) {
      try {
        const channels = await this.channelsFor(schema, field, null);
        if (channels.length || !schema) return channels;
        // An empty unscoped answer on a multi-organization account usually
        // means Buffer wanted the organization named — try that before
        // reporting "no channels".
        const scoped = await this.channelsForAllOrganizations(schema, field);
        return scoped.length ? scoped : channels;
      } catch (error) {
        if (!(error instanceof BufferApiError && isValidationError(error.errors))) throw error;
      }
    }

    return this.channelsForAllOrganizations(schema, field);
  }

  private async channelsForAllOrganizations(
    schema: BufferSchema | null,
    field: IntrospectedField | null,
  ): Promise<BufferChannel[]> {
    const organizations = await this.listOrganizations();
    const merged: BufferChannel[] = [];
    const seen = new Set<string>();
    for (const organization of organizations) {
      for (const channel of await this.channelsFor(schema, field, organization.id)) {
        if (seen.has(channel.id)) continue;
        seen.add(channel.id);
        merged.push(channel);
      }
    }
    return merged;
  }

  private async channelsFor(
    schema: BufferSchema | null,
    field: IntrospectedField | null,
    organizationId: string | null,
  ): Promise<BufferChannel[]> {
    const build = (): Attempt | null => {
      if (!schema || !field) return null;
      const shape = resultShape(schema, field);
      const selection = buildSelection(schema, this.nodeTypeName(shape), this.channelWishes);
      if (!selection) return null;
      return this.plannedQuery(
        schema,
        "query",
        "FalorbBufferChannels",
        field,
        "channels",
        {
          organizationId,
          organization: organizationId,
          input: organizationId ? { organizationId } : {},
        },
        this.connectionBody(schema, shape, selection),
      );
    };

    const fallback = (selection: string): Attempt =>
      organizationId
        ? {
            query: `query FalorbBufferChannels($organizationId: OrganizationId!) { channels(organizationId: $organizationId) { ${selection} } }`,
            variables: { organizationId },
          }
        : { query: `query FalorbBufferChannels { channels { ${selection} } }`, variables: {} };

    const data = await this.runAttempts<Record<string, unknown>>([
      build,
      build,
      () => fallback(FALLBACK_CHANNEL_SELECTION),
      () => fallback("id name displayName service isDisconnected"),
    ]);

    return extractNodes(data?.channels)
      .nodes.map((node) => normalizeChannel(node, organizationId))
      .filter((channel): channel is BufferChannel => channel !== null);
  }

  async getChannel(channelId: string): Promise<BufferChannel | null> {
    const schema = await this.schema();
    const field = schema?.queryField("channel") ?? null;

    const build = (): Attempt | null => {
      if (!schema || !field) return null;
      const shape = resultShape(schema, field);
      const selection = buildSelection(schema, this.nodeTypeName(shape), this.channelWishes);
      return this.plannedQuery(
        schema,
        "query",
        "FalorbBufferChannel",
        field,
        "channel",
        { channelId, id: channelId, input: { channelId } },
        selection,
      );
    };

    const data = await this.runAttempts<Record<string, unknown>>([
      build,
      build,
      () => ({
        query: `query FalorbBufferChannel($channelId: ChannelId!) { channel(channelId: $channelId) { ${FALLBACK_CHANNEL_SELECTION} } }`,
        variables: { channelId },
      }),
    ]);

    return normalizeChannel(data?.channel);
  }

  // -------------------------------------------------------------------- posts

  /** Cursor-walks Buffer's Relay pagination internally and returns every matching post. */
  async listPosts(params: ListPostsParams = {}): Promise<BufferPost[]> {
    const schema = await this.schema();
    const field = schema?.queryField("posts") ?? null;
    const first = params.pageSize ?? DEFAULT_PAGE_SIZE;

    const organizationId =
      params.organizationId ??
      (field?.args?.some((arg) => arg.type.kind === "NON_NULL" && /organization/i.test(arg.name))
        ? (await this.listOrganizations())[0]?.id
        : undefined);

    const all: BufferPost[] = [];
    const seen = new Set<string>();
    let after: string | undefined;

    for (let page = 0; page < MAX_PAGES; page += 1) {
      const cursor = after;
      const build = (): Attempt | null => {
        if (!schema || !field) return null;
        const shape = resultShape(schema, field);
        const selection = buildSelection(schema, this.nodeTypeName(shape), this.postWishes);
        if (!selection) return null;
        return this.plannedQuery(
          schema,
          "query",
          "FalorbBufferPosts",
          field,
          "posts",
          {
            channelId: params.channelId,
            channelIds: params.channelId ? [params.channelId] : undefined,
            organizationId,
            status: params.status,
            first,
            limit: first,
            after: cursor,
            input: {
              channelId: params.channelId,
              organizationId,
              status: params.status,
            },
          },
          this.connectionBody(schema, shape, selection),
        );
      };

      const fallback = (selection: string): Attempt => ({
        query: `query FalorbBufferPosts($channelId: ChannelId!, $first: Int, $after: String) {
          posts(channelId: $channelId, first: $first, after: $after) {
            edges { node { ${selection} } }
            pageInfo { hasNextPage endCursor }
          }
        }`,
        variables: { channelId: params.channelId, first, after: cursor },
      });

      const data = await this.runAttempts<Record<string, unknown>>([
        build,
        build,
        () => (params.channelId ? fallback(FALLBACK_POST_SELECTION) : null),
        () => (params.channelId ? fallback("id text status dueAt sentAt") : null),
      ]);

      const { nodes, pageInfo } = extractNodes(data?.posts);
      for (const node of nodes) {
        const post = normalizePost(node, params.channelId ?? null);
        if (!post || seen.has(post.id)) continue;
        seen.add(post.id);
        all.push(post);
      }

      if (!pageInfo?.hasNextPage || !pageInfo.endCursor) break;
      after = pageInfo.endCursor;
    }

    return all;
  }

  async getPost(postId: string): Promise<BufferPost | null> {
    const schema = await this.schema();
    const field = schema?.queryField("post") ?? null;

    const build = (): Attempt | null => {
      if (!schema || !field) return null;
      const shape = resultShape(schema, field);
      const selection = buildSelection(schema, this.nodeTypeName(shape), this.postWishes);
      return this.plannedQuery(
        schema,
        "query",
        "FalorbBufferPost",
        field,
        "post",
        { id: postId, postId, input: { id: postId } },
        selection,
      );
    };

    const data = await this.runAttempts<Record<string, unknown>>([
      build,
      build,
      () => ({
        query: `query FalorbBufferPost($postId: PostId!) { post(id: $postId) { ${FALLBACK_POST_SELECTION} } }`,
        variables: { postId },
      }),
    ]);

    return normalizePost(data?.post);
  }

  // ---------------------------------------------------------------- mutations

  /**
   * One mutation per channel — Buffer's `createPost` takes a single
   * `channelId`, not an array; publishing to several channels means calling
   * this once per channel.
   *
   * The payload is a union (`Post | InvalidInputError`) on current schemas and
   * a wrapper object (`{ post }`) on others, so the result is unwrapped by
   * shape rather than by assumption, and an error member is raised as a
   * `BufferApiError` instead of being returned as a post with no id.
   */
  async createPost(input: CreatePostInput): Promise<BufferPost> {
    const schema = await this.schema();
    const field = schema?.mutationField("createPost") ?? null;
    const inputTypeName = namedTypeRef(field?.args?.find((arg) => arg.name === "input")?.type)?.name ?? "CreatePostInput";
    const mode = normalizeMode(input.mode, input.dueAt);

    const wanted = {
      channelId: input.channelId,
      text: input.text,
      dueAt: mode === "schedule" ? input.dueAt : undefined,
      tags: input.tags?.length ? input.tags : undefined,
      schedulingType: inputValueForCandidates(
        schema,
        inputTypeName,
        "schedulingType",
        SCHEDULING_TYPE_CANDIDATES[mode],
      ),
      mode: inputValueForCandidates(schema, inputTypeName, "mode", MODE_CANDIDATES[mode]),
    };

    // A field Buffer doesn't define comes back null above; sending it anyway
    // is how you turn a working mutation into a validation error.
    const payload = Object.fromEntries(
      Object.entries(wanted).filter(([, value]) => value !== undefined && value !== null),
    );

    const build = (): Attempt | null => {
      if (!schema || !field) return null;
      const selection = this.payloadSelection(schema, field, this.postWishes);
      return this.plannedQuery(
        schema,
        "mutation",
        "FalorbBufferCreatePost",
        field,
        "createPost",
        { input: payload, ...payload },
        selection,
      );
    };

    const documented = (selection: string, values: Record<string, unknown>): Attempt => ({
      query: `mutation FalorbBufferCreatePost($input: CreatePostInput!) { createPost(input: $input) { ${selection} } }`,
      variables: { input: values },
    });

    const data = await this.runAttempts<Record<string, unknown>>([
      build,
      build,
      () =>
        documented(
          `__typename ... on Post { ${FALLBACK_POST_SELECTION} } ... on InvalidInputError { message }`,
          payload,
        ),
      () =>
        documented(`post { ${FALLBACK_POST_SELECTION} }`, {
          channelId: input.channelId,
          text: input.text,
          ...(mode === "schedule" && input.dueAt ? { dueAt: input.dueAt } : {}),
        }),
    ]);

    const post = this.postFromPayload(data?.createPost, input.channelId);
    if (!post) throw new BufferApiError(200, "Buffer accepted the mutation but returned no post.");
    return post;
  }

  async deletePost(postId: string): Promise<void> {
    const schema = await this.schema();
    const field = schema?.mutationField("deletePost") ?? null;
    if (schema && !field) {
      throw new BufferApiError(200, "This Buffer schema exposes no deletePost mutation.");
    }

    const build = (): Attempt | null => {
      if (!schema || !field) return null;
      const selection = this.payloadSelection(schema, field, ["id", "success", ...PAYLOAD_ERROR_WISHES]);
      return this.plannedQuery(
        schema,
        "mutation",
        "FalorbBufferDeletePost",
        field,
        "deletePost",
        { id: postId, postId, input: { id: postId, postId } },
        selection,
      );
    };

    const result = await this.runAttempts<Record<string, unknown>>([
      build,
      build,
      () => ({
        query: `mutation FalorbBufferDeletePost($input: DeletePostInput!) { deletePost(input: $input) { __typename ... on InvalidInputError { message } } }`,
        variables: { input: { id: postId } },
      }),
    ]);

    this.throwIfErrorPayload(result?.deletePost);
  }

  /** Builds the selection for a mutation payload, whatever shape it is: union, `{ post }` wrapper, or the node itself. */
  private payloadSelection(schema: BufferSchema, field: IntrospectedField, wishes: FieldWish[]): string {
    const type = schema.typeOfRef(field.type);
    if (!type?.name) return "";
    const combined = [...wishes, ...PAYLOAD_ERROR_WISHES];

    if (type.kind === "UNION") {
      const parts = ["__typename"];
      for (const possible of type.possibleTypes ?? []) {
        const member = schema.type(possible?.name);
        if (!member?.name) continue;
        const selection = buildSelection(schema, member.name, combined);
        if (selection) parts.push(`... on ${member.name} { ${selection} }`);
      }
      return parts.length > 1 ? parts.join(" ") : "";
    }

    const wrapper = schema.field(type.name, "post") ?? schema.field(type.name, "node");
    if (wrapper) {
      const wrapped = buildSelection(schema, schema.typeOfRef(wrapper.type)?.name, wishes);
      const siblings = buildSelection(schema, type.name, PAYLOAD_ERROR_WISHES);
      if (wrapped) return `${wrapper.name} { ${wrapped} }${siblings ? ` ${siblings}` : ""}`;
    }

    return buildSelection(schema, type.name, combined);
  }

  private throwIfErrorPayload(payload: unknown): void {
    if (typeof payload !== "object" || payload === null) return;
    const record = payload as Record<string, unknown>;
    const typename = typeof record.__typename === "string" ? record.__typename : "";
    const message = typeof record.message === "string" ? record.message : null;
    if (message && (/error/i.test(typename) || record.id === undefined)) {
      throw new BufferApiError(200, [{ message, type: typename || "MutationError" }]);
    }
  }

  private postFromPayload(payload: unknown, channelId: string): BufferPost | null {
    if (typeof payload !== "object" || payload === null) return null;
    const record = payload as Record<string, unknown>;
    this.throwIfErrorPayload(record);
    if (record.post && typeof record.post === "object") return normalizePost(record.post, channelId);
    if (record.node && typeof record.node === "object") return normalizePost(record.node, channelId);
    return normalizePost(record, channelId);
  }

  // ----------------------------------------------------------- health check

  /**
   * The cheapest authenticated call that proves the key works without side
   * effects. Reports the organizations the key can see, because "connected but
   * zero organizations" is the shape of a key that will sync nothing — better
   * said at connect time than discovered by an empty dashboard.
   */
  async verifyConnection(): Promise<{ ok: boolean; detail: string }> {
    try {
      const account = await this.getAccount();
      const who = account.email ?? account.name ?? account.id;
      const orgs = account.organizations.length;
      const schemaNote = this.schemaError
        ? " Schema introspection was unavailable, so Falorb is using its documented query set."
        : "";
      return {
        ok: true,
        detail: `Buffer reachable and key accepted (${who}) — ${orgs} organization${orgs === 1 ? "" : "s"}.${schemaNote}`,
      };
    } catch (error) {
      if (error instanceof BufferApiError) {
        return { ok: false, detail: `Buffer returned HTTP ${error.status}: ${JSON.stringify(error.errors)}` };
      }
      return { ok: false, detail: String(error) };
    }
  }
}

export type { BufferAccount, BufferChannel, BufferOrganization, BufferPost, BufferPostMetric };
