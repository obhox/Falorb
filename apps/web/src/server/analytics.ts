import "server-only";
import * as q from "@falorb/queries";
import { ch } from "./clickhouse";

/**
 * The dashboard's read surface.
 *
 * Every one of these is `@falorb/queries` with the ClickHouse client already
 * bound. Nothing here reshapes results or adds logic — the query layer is
 * complete and smoke-tested against a live database, and a second layer of
 * transformation would be a second place for a metric to be defined.
 *
 * What this file *does* add is a single import site. Server components call
 * `totals({ projectIds, range })` and never see a client, which is what keeps
 * the credential from drifting into a component.
 *
 * `projectIds` always comes from the session's project list, never from the
 * URL. See `requireProject` in ./session.
 */

export type {
  AttributionModel,
  AttributionRow,
  BreakdownRow,
  DateRange,
  Filter,
  FunnelOptions,
  FunnelStep,
  FunnelStepResult,
  GoalDefinition,
  GoalResult,
  Interval,
  Metric,
  QueryScope,
  RetentionRow,
  SessionRow,
  TotalsRow,
  TrendPoint,
} from "@falorb/queries";

export const FILTERABLE_FIELDS = q.FILTERABLE_FIELDS;
export const isFilterableField = q.isFilterableField;
export const FilterError = q.FilterError;

// ---- Trends and totals -----------------------------------------------------

export const totals = (o: q.QueryScope) => q.totals(ch(), o);
export const trend = (o: q.TrendOptions) => q.trend(ch(), o);
export const breakdown = (
  o: q.QueryScope & { field: string; limit?: number; orderBy?: q.BreakdownMetric },
) => q.breakdown(ch(), o);

// ---- Funnels ---------------------------------------------------------------

export const funnel = (o: q.FunnelOptions) => q.funnel(ch(), o);
export const funnelDropoffs = (o: q.FunnelOptions & { atStep: number; limit?: number }) =>
  q.funnelDropoffs(ch(), o);

// ---- Goals and attribution -------------------------------------------------

export const goalConversions = (o: q.QueryScope & { goals: q.GoalDefinition[] }) =>
  q.goalConversions(ch(), o);
export const attribution = (
  o: q.QueryScope & { goal: q.GoalDefinition; model?: q.AttributionModel; limit?: number },
) => q.attribution(ch(), o);

// ---- Retention -------------------------------------------------------------

export const retention = (o: q.RetentionOptions) => q.retention(ch(), o);
export const stickiness = (o: q.RetentionOptions) => q.stickiness(ch(), o);

// ---- Paths -----------------------------------------------------------------

export const pathTransitions = (o: q.QueryScope & { limit?: number; startPath?: string }) =>
  q.pathTransitions(ch(), o);
export const exitPages = (o: q.QueryScope & { limit?: number; minPageviews?: number }) =>
  q.exitPages(ch(), o);
export const entryPages = (o: q.QueryScope & { limit?: number }) => q.entryPages(ch(), o);
export const frustration = (o: q.QueryScope & { limit?: number }) => q.frustration(ch(), o);

// ---- People ----------------------------------------------------------------

export const personList = (o: q.QueryScope & { limit?: number; offset?: number }) =>
  q.personList(ch(), o);
export const personTimeline = (o: {
  personId: string;
  projectIds: number[];
  before?: number;
  limit?: number;
}) => q.personTimeline(ch(), o);
export const personProjects = (o: { personId: string; projectIds: number[] }) =>
  q.personProjects(ch(), o);
export const acquisitionChain = (o: { personId: string; projectIds: number[]; limit?: number }) =>
  q.acquisitionChain(ch(), o);
export const personInterests = (o: { personId: string; projectIds: number[]; limit?: number }) =>
  q.personInterests(ch(), o);

// ---- Sessions --------------------------------------------------------------

export const sessionList = (o: q.QueryScope & { personId?: string; limit?: number; offset?: number }) =>
  q.sessionList(ch(), o);
export const sessionEvents = (o: { sessionId: string; projectIds: number[]; limit?: number }) =>
  q.sessionEvents(ch(), o);

// ---- Live ------------------------------------------------------------------

export const liveVisitors = (o: {
  projectIds: number[];
  windowMs?: number;
  limit?: number;
  now?: number;
}) => q.liveVisitors(ch(), o);
export const liveCounts = (o: { projectIds: number[]; windowMs?: number; now?: number }) =>
  q.liveCounts(ch(), o);
export const liveFeed = (o: {
  projectIds: number[];
  since?: number;
  limit?: number;
  includeBots?: boolean;
}) => q.liveFeed(ch(), o);

// ---- Portfolio -------------------------------------------------------------

export const portfolioOverview = (o: { projectIds: number[]; range: q.DateRange }) =>
  q.portfolioOverview(ch(), o);
export const portfolioSparklines = (o: { projectIds: number[]; range: q.DateRange }) =>
  q.portfolioSparklines(ch(), o);
export const crossProjectPeople = (o: {
  projectIds: number[];
  range: q.DateRange;
  minProjects?: number;
  limit?: number;
}) => q.crossProjectPeople(ch(), o);
