-- Pre-aggregated rollups. One narrow table per breakdown dimension rather than
-- a single wide one: a combined (path x country x browser x channel) key would
-- multiply out to millions of rows a day for even a modest site, which defeats
-- the purpose. Split this way each table stays small and each dashboard panel
-- reads exactly the rollup it needs.

-- Headline numbers per project/day. Powers the all-projects overview.
CREATE TABLE IF NOT EXISTS daily_stats
(
    project_id  UInt32,
    date        Date,
    host        LowCardinality(String),
    visitors    AggregateFunction(uniqCombined64, UUID),
    sessions    AggregateFunction(uniqCombined64, UUID),
    pageviews   SimpleAggregateFunction(sum, UInt64),
    events      SimpleAggregateFunction(sum, UInt64),
    revenue     SimpleAggregateFunction(sum, Float64)
)
ENGINE = AggregatingMergeTree
PARTITION BY toYYYYMM(date)
ORDER BY (project_id, date, host);

CREATE MATERIALIZED VIEW IF NOT EXISTS daily_stats_mv TO daily_stats AS
SELECT
    project_id,
    toDate(timestamp)                       AS date,
    host,
    uniqCombined64State(person_id)          AS visitors,
    uniqCombined64State(session_id)         AS sessions,
    countIf(name = '$pageview')             AS pageviews,
    count()                                 AS events,
    sum(ifNull(toFloat64(revenue), 0))      AS revenue
FROM events
WHERE is_bot = 0
GROUP BY project_id, date, host;

-- Top pages / content performance.
CREATE TABLE IF NOT EXISTS daily_paths
(
    project_id  UInt32,
    date        Date,
    host        LowCardinality(String),
    path        String,
    visitors    AggregateFunction(uniqCombined64, UUID),
    pageviews   SimpleAggregateFunction(sum, UInt64),
    total_time_ms SimpleAggregateFunction(sum, UInt64),
    scroll_sum  SimpleAggregateFunction(sum, UInt64),
    scroll_n    SimpleAggregateFunction(sum, UInt64)
)
ENGINE = AggregatingMergeTree
PARTITION BY toYYYYMM(date)
ORDER BY (project_id, date, host, path);

CREATE MATERIALIZED VIEW IF NOT EXISTS daily_paths_mv TO daily_paths AS
SELECT
    project_id,
    toDate(timestamp)               AS date,
    host,
    path,
    uniqCombined64State(person_id)  AS visitors,
    countIf(name = '$pageview')     AS pageviews,
    sum(duration_ms)                AS total_time_ms,
    -- Kept as sum + count rather than an average so that partial merges stay
    -- correct; the mean is computed at read time.
    sum(toUInt64(props_num['scroll_depth']))      AS scroll_sum,
    countIf(has(mapKeys(props_num), 'scroll_depth')) AS scroll_n
FROM events
WHERE is_bot = 0
GROUP BY project_id, date, host, path;

-- Acquisition: which channels, campaigns and referring sites bring people in.
CREATE TABLE IF NOT EXISTS daily_sources
(
    project_id    UInt32,
    date          Date,
    channel       LowCardinality(String),
    source        LowCardinality(String),
    referrer_host LowCardinality(String),
    utm_campaign  String,
    visitors      AggregateFunction(uniqCombined64, UUID),
    sessions      AggregateFunction(uniqCombined64, UUID),
    pageviews     SimpleAggregateFunction(sum, UInt64),
    revenue       SimpleAggregateFunction(sum, Float64)
)
ENGINE = AggregatingMergeTree
PARTITION BY toYYYYMM(date)
ORDER BY (project_id, date, channel, source, referrer_host, utm_campaign);

CREATE MATERIALIZED VIEW IF NOT EXISTS daily_sources_mv TO daily_sources AS
SELECT
    project_id,
    toDate(timestamp)                   AS date,
    channel,
    source,
    referrer_host,
    utm_campaign,
    uniqCombined64State(person_id)      AS visitors,
    uniqCombined64State(session_id)     AS sessions,
    countIf(name = '$pageview')         AS pageviews,
    sum(ifNull(toFloat64(revenue), 0))  AS revenue
FROM events
WHERE is_bot = 0
GROUP BY project_id, date, channel, source, referrer_host, utm_campaign;

-- Geography.
CREATE TABLE IF NOT EXISTS daily_geo
(
    project_id UInt32,
    date       Date,
    country    LowCardinality(String),
    region     LowCardinality(String),
    visitors   AggregateFunction(uniqCombined64, UUID),
    sessions   AggregateFunction(uniqCombined64, UUID),
    pageviews  SimpleAggregateFunction(sum, UInt64)
)
ENGINE = AggregatingMergeTree
PARTITION BY toYYYYMM(date)
ORDER BY (project_id, date, country, region);

CREATE MATERIALIZED VIEW IF NOT EXISTS daily_geo_mv TO daily_geo AS
SELECT
    project_id,
    toDate(timestamp)               AS date,
    country,
    region,
    uniqCombined64State(person_id)  AS visitors,
    uniqCombined64State(session_id) AS sessions,
    countIf(name = '$pageview')     AS pageviews
FROM events
WHERE is_bot = 0
GROUP BY project_id, date, country, region;

-- Device and browser mix.
CREATE TABLE IF NOT EXISTS daily_tech
(
    project_id  UInt32,
    date        Date,
    device_type LowCardinality(String),
    browser     LowCardinality(String),
    os          LowCardinality(String),
    visitors    AggregateFunction(uniqCombined64, UUID),
    pageviews   SimpleAggregateFunction(sum, UInt64)
)
ENGINE = AggregatingMergeTree
PARTITION BY toYYYYMM(date)
ORDER BY (project_id, date, device_type, browser, os);

CREATE MATERIALIZED VIEW IF NOT EXISTS daily_tech_mv TO daily_tech AS
SELECT
    project_id,
    toDate(timestamp)               AS date,
    device_type,
    browser,
    os,
    uniqCombined64State(person_id)  AS visitors,
    countIf(name = '$pageview')     AS pageviews
FROM events
WHERE is_bot = 0
GROUP BY project_id, date, device_type, browser, os;

-- One row per person per active day. This is the input to retention cohorts;
-- computing retention straight off `events` would scan the whole firehose.
CREATE TABLE IF NOT EXISTS person_daily
(
    project_id UInt32,
    date       Date,
    person_id  UUID,
    events     SimpleAggregateFunction(sum, UInt64),
    pageviews  SimpleAggregateFunction(sum, UInt64),
    sessions   AggregateFunction(uniqCombined64, UUID)
)
ENGINE = AggregatingMergeTree
PARTITION BY toYYYYMM(date)
ORDER BY (project_id, date, person_id);

CREATE MATERIALIZED VIEW IF NOT EXISTS person_daily_mv TO person_daily AS
SELECT
    project_id,
    toDate(timestamp)               AS date,
    person_id,
    count()                         AS events,
    countIf(name = '$pageview')     AS pageviews,
    uniqCombined64State(session_id) AS sessions
FROM events
WHERE is_bot = 0
GROUP BY project_id, date, person_id;

-- Page-to-page transitions, powering the Sankey user-flow diagram.
--
-- NOT a materialized view: an MV only ever sees the single block being
-- inserted, so it cannot look at the previous row in a session. Computing a
-- transition needs `lagInFrame` across a session's ordered pageviews, which
-- means a periodic INSERT ... SELECT. The rollups worker owns this table.
CREATE TABLE IF NOT EXISTS path_transitions
(
    project_id  UInt32,
    date        Date,
    from_path   String,
    to_path     String,
    transitions SimpleAggregateFunction(sum, UInt64),
    visitors    AggregateFunction(uniqCombined64, UUID)
)
ENGINE = AggregatingMergeTree
PARTITION BY toYYYYMM(date)
ORDER BY (project_id, date, from_path, to_path);
