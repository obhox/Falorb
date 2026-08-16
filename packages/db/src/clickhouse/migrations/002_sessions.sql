-- Session rollup, maintained incrementally by a materialized view.
--
-- No PARTITION BY, and that is deliberate. A session can straddle a month
-- boundary; partitioning by any timestamp-derived expression would scatter one
-- session's rows across partitions, and AggregatingMergeTree only merges
-- *within* a partition. The result would be silently duplicated half-sessions
-- in every report. Sessions run roughly a tenth the row count of events, so an
-- unpartitioned table is comfortable at this scale, and the retention worker
-- prunes old rows with a lightweight DELETE.

CREATE TABLE IF NOT EXISTS sessions
(
    project_id       UInt32,
    session_id       UUID,

    person_id        SimpleAggregateFunction(any, UUID),
    distinct_id      SimpleAggregateFunction(any, String),

    started_at       SimpleAggregateFunction(min, DateTime64(3, 'UTC')),
    ended_at         SimpleAggregateFunction(max, DateTime64(3, 'UTC')),

    pageviews        SimpleAggregateFunction(sum, UInt64),
    event_count      SimpleAggregateFunction(sum, UInt64),
    total_duration_ms SimpleAggregateFunction(sum, UInt64),

    -- Every event carries the URL of the page it happened on, so the path at
    -- max(timestamp) is literally the page the visitor was looking at when the
    -- session ended. That is the drop-off point.
    entry_path       AggregateFunction(argMin, String, DateTime64(3, 'UTC')),
    exit_path        AggregateFunction(argMax, String, DateTime64(3, 'UTC')),

    -- First-touch attribution, frozen at the session's first event
    entry_host       AggregateFunction(argMin, String, DateTime64(3, 'UTC')),
    channel          AggregateFunction(argMin, String, DateTime64(3, 'UTC')),
    source           AggregateFunction(argMin, String, DateTime64(3, 'UTC')),
    referrer_host    AggregateFunction(argMin, String, DateTime64(3, 'UTC')),
    utm_campaign     AggregateFunction(argMin, String, DateTime64(3, 'UTC')),

    country          AggregateFunction(argMin, String, DateTime64(3, 'UTC')),
    region           AggregateFunction(argMin, String, DateTime64(3, 'UTC')),
    city             AggregateFunction(argMin, String, DateTime64(3, 'UTC')),
    device_type      AggregateFunction(argMin, String, DateTime64(3, 'UTC')),
    browser          AggregateFunction(argMin, String, DateTime64(3, 'UTC')),
    os               AggregateFunction(argMin, String, DateTime64(3, 'UTC')),

    -- Qualitative signals, surfaced as "frustrated sessions" in the dashboard
    max_scroll       SimpleAggregateFunction(max, UInt8),
    rage_clicks      SimpleAggregateFunction(sum, UInt64),
    dead_clicks      SimpleAggregateFunction(sum, UInt64),
    errors           SimpleAggregateFunction(sum, UInt64),

    -- Decimal128, not Decimal64: summing a Decimal64(4) widens the result to
    -- Decimal(38,4), and SimpleAggregateFunction requires the column type to
    -- match the aggregate's return type exactly.
    revenue          SimpleAggregateFunction(sum, Decimal128(4))
)
ENGINE = AggregatingMergeTree
ORDER BY (project_id, session_id);

CREATE MATERIALIZED VIEW IF NOT EXISTS sessions_mv TO sessions AS
SELECT
    project_id,
    session_id,
    any(person_id)                                  AS person_id,
    any(distinct_id)                                AS distinct_id,
    min(timestamp)                                  AS started_at,
    max(timestamp)                                  AS ended_at,
    countIf(name = '$pageview')                     AS pageviews,
    count()                                         AS event_count,
    sum(duration_ms)                                AS total_duration_ms,

    argMinState(path, timestamp)                    AS entry_path,
    argMaxState(path, timestamp)                    AS exit_path,
    argMinState(host, timestamp)                    AS entry_host,
    argMinState(channel, timestamp)                 AS channel,
    argMinState(source, timestamp)                  AS source,
    argMinState(referrer_host, timestamp)           AS referrer_host,
    argMinState(utm_campaign, timestamp)            AS utm_campaign,
    argMinState(country, timestamp)                 AS country,
    argMinState(region, timestamp)                  AS region,
    argMinState(city, timestamp)                    AS city,
    argMinState(device_type, timestamp)             AS device_type,
    argMinState(browser, timestamp)                 AS browser,
    argMinState(os, timestamp)                      AS os,

    max(toUInt8(props_num['scroll_depth']))         AS max_scroll,
    countIf(name = '$rage_click')                   AS rage_clicks,
    countIf(name = '$dead_click')                   AS dead_clicks,
    countIf(name = '$error')                        AS errors,
    sum(ifNull(revenue, toDecimal64(0, 4)))         AS revenue
FROM events
WHERE is_bot = 0
GROUP BY project_id, session_id;

-- Readable wrapper. AggregatingMergeTree merges are eventual, so every query
-- must GROUP BY the sort key and apply -Merge. Doing that once here keeps the
-- application's SQL free of combinator noise.
--
-- The aggregation sits in a subquery with `_agg`-suffixed names on purpose.
-- Writing `min(started_at) AS started_at` and then referring to `started_at`
-- again in a derived expression makes ClickHouse resolve the argument to the
-- alias, and it rejects the query as a nested aggregate.
CREATE VIEW IF NOT EXISTS sessions_v AS
SELECT
    project_id,
    session_id,
    person_id,
    distinct_id,
    started_at_agg                                          AS started_at,
    ended_at_agg                                            AS ended_at,
    dateDiff('second', started_at_agg, ended_at_agg)        AS duration_sec,
    pageviews_agg                                           AS pageviews,
    events_agg                                              AS event_count,
    entry_path,
    exit_path,
    entry_host,
    channel,
    source,
    referrer_host,
    utm_campaign,
    country,
    region,
    city,
    device_type,
    browser,
    os,
    max_scroll_agg                                          AS max_scroll,
    rage_clicks_agg                                         AS rage_clicks,
    dead_clicks_agg                                         AS dead_clicks,
    errors_agg                                              AS errors,
    revenue_agg                                             AS revenue,
    -- A bounce is one pageview and no meaningful interaction. Counting any
    -- custom event as engagement avoids labelling a reader who scrolled an
    -- entire article and clicked a CTA as a bounce.
    pageviews_agg <= 1 AND events_agg <= 2                  AS is_bounce
FROM
(
    SELECT
        project_id,
        session_id,
        any(person_id)              AS person_id,
        any(distinct_id)            AS distinct_id,
        min(started_at)             AS started_at_agg,
        max(ended_at)               AS ended_at_agg,
        sum(pageviews)              AS pageviews_agg,
        sum(event_count)            AS events_agg,
        argMinMerge(entry_path)     AS entry_path,
        argMaxMerge(exit_path)      AS exit_path,
        argMinMerge(entry_host)     AS entry_host,
        argMinMerge(channel)        AS channel,
        argMinMerge(source)         AS source,
        argMinMerge(referrer_host)  AS referrer_host,
        argMinMerge(utm_campaign)   AS utm_campaign,
        argMinMerge(country)        AS country,
        argMinMerge(region)         AS region,
        argMinMerge(city)           AS city,
        argMinMerge(device_type)    AS device_type,
        argMinMerge(browser)        AS browser,
        argMinMerge(os)             AS os,
        max(max_scroll)             AS max_scroll_agg,
        sum(rage_clicks)            AS rage_clicks_agg,
        sum(dead_clicks)            AS dead_clicks_agg,
        sum(errors)                 AS errors_agg,
        sum(revenue)                AS revenue_agg
    FROM sessions
    GROUP BY project_id, session_id
);
