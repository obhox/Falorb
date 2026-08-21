/**
 * Turns whatever shape Buffer's beta schema hands back into the flat rows
 * `apps/worker/src/jobs/buffer-sync.ts` writes.
 *
 * The client asks the live schema what its fields look like
 * (`schema.ts`), which means a field can legitimately arrive as a scalar on
 * one account and an object on another as Buffer iterates — `weeklyPostingLimit`
 * is exactly that case: documented flat, actually a `WeeklyPostingLimit`
 * object. Everything here therefore accepts both and keeps the raw object
 * alongside the flattened value rather than throwing away what it didn't
 * understand.
 *
 * Pure functions, no network: this is the part of the integration CI can
 * actually test without a Buffer account.
 */

export interface BufferOrganization {
  id: string;
  name: string | null;
  [key: string]: unknown;
}

export interface BufferAccount {
  id: string;
  email: string | null;
  name: string | null;
  organizations: BufferOrganization[];
  [key: string]: unknown;
}

export interface BufferChannel {
  id: string;
  name: string | null;
  displayName: string | null;
  avatar: string | null;
  service: string | null;
  isDisconnected: boolean;
  isQueuePaused: boolean;
  timezone: string | null;
  /** Flattened count when Buffer expresses a limit as (or inside) a number; see `normalizeWeeklyPostingLimit`. */
  weeklyPostingLimit: number | null;
  /** The whole `WeeklyPostingLimit` object when it is one — nothing is discarded just because it didn't flatten. */
  weeklyPostingLimitDetail: Record<string, unknown> | null;
  postingSchedule: unknown[] | Record<string, unknown> | null;
  postingGoal: Record<string, unknown> | null;
  allowedActions: string[] | null;
  /** Buffer organization this channel belongs to, when the query was scoped to one. */
  organizationId: string | null;
  [key: string]: unknown;
}

export interface BufferPostMetric {
  type: string | null;
  name: string | null;
  value: number | null;
  unit: string | null;
  [key: string]: unknown;
}

export interface BufferPost {
  id: string;
  text: string | null;
  channelId: string;
  /** ISO string or Unix seconds depending on the account's schema version — `toDate` in the sync job takes both. */
  dueAt: string | number | null;
  sentAt: string | number | null;
  status: string | null;
  shareMode: string | null;
  schedulingType: string | null;
  tags: string[] | null;
  metrics: BufferPostMetric[] | null;
  metricsUpdatedAt: string | number | null;
  /** Buffer's own failure text for a post it couldn't publish, flattened from string or `{ message }`. */
  errorMessage: string | null;
  [key: string]: unknown;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function firstString(source: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.length) return value;
  }
  return null;
}

function toStringOrNull(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

/** A timestamp can arrive as an ISO string, Unix seconds, or `{ iso }`/`{ timestamp }`. */
export function normalizeTimestamp(value: unknown): string | number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "number") return value;
  if (isRecord(value)) {
    const iso = firstString(value, ["iso", "isoString", "datetime", "date"]);
    if (iso) return iso;
    for (const key of ["timestamp", "epoch", "unix", "seconds"]) {
      const candidate = value[key];
      if (typeof candidate === "number" && Number.isFinite(candidate)) return candidate;
    }
  }
  return null;
}

/**
 * `weeklyPostingLimit` is a `WeeklyPostingLimit` object in the live schema,
 * not the `Int` the docs imply. Falorb's mirror stores one number (the cap),
 * so pull the most cap-like number out of the object and keep the object
 * itself in `weeklyPostingLimitDetail` — a rename of its inner field costs
 * the flattened count, not the data.
 */
export function normalizeWeeklyPostingLimit(value: unknown): {
  limit: number | null;
  detail: Record<string, unknown> | null;
} {
  if (typeof value === "number" && Number.isFinite(value)) return { limit: value, detail: null };
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
    return { limit: Number(value), detail: null };
  }
  if (!isRecord(value)) return { limit: null, detail: null };

  // Most specific first: a "limit"/"max" wins over "remaining"/"used", which
  // describe consumption rather than the cap itself.
  for (const key of ["limit", "weeklyLimit", "max", "maximum", "value", "count", "total", "remaining"]) {
    const candidate = value[key];
    if (typeof candidate === "number" && Number.isFinite(candidate)) {
      return { limit: candidate, detail: value };
    }
  }
  return { limit: null, detail: value };
}

/** Tags come back as strings or `{ id, name }` objects depending on schema version. */
export function normalizeTags(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const tags = value
    .map((tag) => (typeof tag === "string" ? tag : isRecord(tag) ? firstString(tag, ["name", "label", "id"]) : null))
    .filter((tag): tag is string => Boolean(tag));
  return tags.length ? tags : null;
}

/** Metrics arrive either as a list of measurements or as a `{ likes: 3 }` map. */
export function normalizeMetrics(value: unknown): BufferPostMetric[] | null {
  const fromRecord = (raw: Record<string, unknown>): BufferPostMetric => ({
    ...raw,
    type: firstString(raw, ["type", "kind"]),
    name: firstString(raw, ["name", "label", "displayName"]),
    value: typeof raw.value === "number" ? raw.value : Number.isFinite(Number(raw.value)) ? Number(raw.value) : null,
    unit: firstString(raw, ["unit", "suffix"]),
  });

  if (Array.isArray(value)) {
    const metrics = value.filter(isRecord).map(fromRecord);
    return metrics.length ? metrics : null;
  }
  if (isRecord(value)) {
    const metrics = Object.entries(value)
      .filter(([key, entry]) => key !== "__typename" && (typeof entry === "number" || typeof entry === "string"))
      .map(([key, entry]) => ({
        type: null,
        name: key,
        value: Number.isFinite(Number(entry)) ? Number(entry) : null,
        unit: null,
      }));
    return metrics.length ? metrics : null;
  }
  return null;
}

/** Buffer reports a failed post as a string or an object carrying `message`. */
export function normalizeErrorMessage(value: unknown): string | null {
  if (typeof value === "string") return value.length ? value : null;
  if (isRecord(value)) return firstString(value, ["message", "text", "detail", "reason", "description"]);
  return null;
}

export function normalizeAllowedActions(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const actions = value
    .map((action) =>
      typeof action === "string" ? action : isRecord(action) ? firstString(action, ["name", "action", "id"]) : null,
    )
    .filter((action): action is string => Boolean(action));
  return actions.length ? actions : null;
}

export function normalizeChannel(raw: unknown, organizationId?: string | null): BufferChannel | null {
  if (!isRecord(raw)) return null;
  const id = toStringOrNull(raw.id);
  if (!id) return null;

  const weekly = normalizeWeeklyPostingLimit(raw.weeklyPostingLimit);
  const postingSchedule = Array.isArray(raw.postingSchedule)
    ? raw.postingSchedule
    : isRecord(raw.postingSchedule)
      ? raw.postingSchedule
      : null;

  return {
    ...raw,
    id,
    name: firstString(raw, ["name", "handle", "username"]),
    displayName: firstString(raw, ["displayName", "name"]),
    avatar: firstString(raw, ["avatar", "avatarUrl", "avatarHttps", "image"]),
    service: firstString(raw, ["service", "serviceType", "platform"]),
    isDisconnected: Boolean(raw.isDisconnected),
    isQueuePaused: Boolean(raw.isQueuePaused),
    timezone: firstString(raw, ["timezone", "timeZone"]),
    weeklyPostingLimit: weekly.limit,
    weeklyPostingLimitDetail: weekly.detail,
    postingSchedule,
    postingGoal: isRecord(raw.postingGoal) ? raw.postingGoal : null,
    allowedActions: normalizeAllowedActions(raw.allowedActions),
    organizationId:
      toStringOrNull(raw.organizationId) ??
      (isRecord(raw.organization) ? toStringOrNull(raw.organization.id) : null) ??
      organizationId ??
      null,
  };
}

/**
 * `fallbackChannelId` is the channel the query was scoped to: newer schema
 * versions return `channel { id }` rather than a flat `channelId`, and older
 * ones may return neither when the caller already knows which channel it
 * asked about.
 */
export function normalizePost(raw: unknown, fallbackChannelId?: string | null): BufferPost | null {
  if (!isRecord(raw)) return null;
  const id = toStringOrNull(raw.id);
  if (!id) return null;

  const channelId =
    toStringOrNull(raw.channelId) ??
    (isRecord(raw.channel) ? toStringOrNull(raw.channel.id) : null) ??
    fallbackChannelId ??
    null;
  if (!channelId) return null;

  return {
    ...raw,
    id,
    text: firstString(raw, ["text", "body", "content"]),
    channelId,
    dueAt: normalizeTimestamp(raw.dueAt ?? raw.scheduledAt),
    sentAt: normalizeTimestamp(raw.sentAt ?? raw.publishedAt),
    status: firstString(raw, ["status", "state"]),
    shareMode: firstString(raw, ["shareMode", "mode"]),
    schedulingType: firstString(raw, ["schedulingType", "type"]),
    tags: normalizeTags(raw.tags),
    metrics: normalizeMetrics(raw.metrics ?? raw.statistics ?? raw.analytics),
    metricsUpdatedAt: normalizeTimestamp(raw.metricsUpdatedAt ?? raw.statisticsUpdatedAt),
    errorMessage: normalizeErrorMessage(raw.error ?? raw.errorMessage ?? raw.failure),
  };
}

export function normalizeAccount(raw: unknown): BufferAccount | null {
  if (!isRecord(raw)) return null;
  const id = toStringOrNull(raw.id) ?? "";
  const organizations = extractNodes(raw.organizations)
    .nodes.filter(isRecord)
    .map((org) => ({ ...org, id: toStringOrNull(org.id) ?? "", name: firstString(org, ["name", "displayName"]) }))
    .filter((org) => org.id.length > 0);
  return {
    ...raw,
    id,
    email: firstString(raw, ["email", "emailAddress"]),
    name: firstString(raw, ["name", "displayName"]),
    organizations,
  };
}

export interface PageInfo {
  hasNextPage: boolean;
  endCursor: string | null;
}

/**
 * Pulls rows out of whichever container Buffer used — a plain list, a Relay
 * `edges { node }` connection, or a `nodes` connection — so the caller doesn't
 * have to have guessed right when it built the query.
 */
export function extractNodes(value: unknown): { nodes: unknown[]; pageInfo: PageInfo | null } {
  if (Array.isArray(value)) return { nodes: value, pageInfo: null };
  if (!isRecord(value)) return { nodes: [], pageInfo: null };

  const pageInfoRaw = isRecord(value.pageInfo) ? value.pageInfo : null;
  const pageInfo: PageInfo | null = pageInfoRaw
    ? {
        hasNextPage: Boolean(pageInfoRaw.hasNextPage),
        endCursor: toStringOrNull(pageInfoRaw.endCursor ?? pageInfoRaw.cursor),
      }
    : null;

  if (Array.isArray(value.edges)) {
    const nodes = value.edges.map((edge) => (isRecord(edge) && "node" in edge ? edge.node : edge));
    return { nodes, pageInfo };
  }
  for (const key of ["nodes", "items", "results", "data"]) {
    const candidate = value[key];
    if (Array.isArray(candidate)) return { nodes: candidate, pageInfo };
  }
  return { nodes: [], pageInfo };
}
