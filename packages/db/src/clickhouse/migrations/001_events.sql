-- The event firehose. Immutable, append-only, one row per tracked interaction.
--
-- ORDER BY choice, which governs essentially every query's speed:
--   project_id       — always filtered; makes the index dense per tenant
--   toDate(timestamp)— date pruning before anything else, so a "last 7 days"
--                      scan touches only the relevant granules
--   name             — most reports filter to one event ($pageview, a goal)
--   person_id        — makes a single person's timeline a short seek rather
--                      than a partition scan
--   timestamp        — final ordering within a granule
--
-- Deliberately absent: any column holding an IP address. Ingest hashes the
-- address with a daily-rotating salt and discards the original before an event
-- is ever constructed, so there is no column here for one to land in.

CREATE TABLE IF NOT EXISTS events
(
    project_id       UInt32,
    event_id         UUID,
    -- Millisecond precision, because ordering events within a single pageview
    -- (click before submit, submit before navigation) needs sub-second
    -- resolution to reconstruct a session timeline correctly.
    --
    -- Trap: windowFunnel() rejects DateTime64 outright and requires DateTime.
    -- Every funnel query must pass toDateTime(timestamp) as its first argument
    -- or it fails with ILLEGAL_TYPE_OF_ARGUMENT.
    timestamp        DateTime64(3, 'UTC'),
    name             LowCardinality(String),

    -- Identity. `distinct_id` is what the client sent; `person_id` is the
    -- resolution at write time. Later merges are applied at *read* time via
    -- the person_overrides dictionary rather than by rewriting these rows.
    distinct_id      String,
    person_id        UUID,
    session_id       UUID,

    -- Page context
    url              String,
    path             String,
    host             LowCardinality(String),
    title            String,
    referrer         String,
    referrer_host    LowCardinality(String),

    -- Acquisition
    utm_source       LowCardinality(String),
    utm_medium       LowCardinality(String),
    utm_campaign     String,
    utm_term         String,
    utm_content      String,
    channel          LowCardinality(String),
    source           LowCardinality(String),

    -- Device
    browser          LowCardinality(String),
    browser_version  LowCardinality(String),
    os               LowCardinality(String),
    os_version       LowCardinality(String),
    device_type      LowCardinality(String),
    screen_w         UInt16,
    screen_h         UInt16,
    viewport_w       UInt16,
    viewport_h       UInt16,

    -- Geography, resolved from the IP in memory and then discarded
    country          LowCardinality(String),
    region           LowCardinality(String),
    city             String,
    timezone         LowCardinality(String),
    language         LowCardinality(String),
    asn              UInt32,
    asn_org          String,

    -- Filled asynchronously by the enrichment worker; empty at ingest time
    company_domain   LowCardinality(String),

    -- Custom properties, split by type so numeric aggregation needs no casting
    props_str        Map(String, String),
    props_num        Map(String, Float64),
    props_raw        String,

    -- Commerce
    revenue          Nullable(Decimal64(4)),
    currency         LowCardinality(String),

    -- Duration: time-on-page for $pageleave, total length for $session_end
    duration_ms      UInt32,

    -- Provenance
    is_bot           UInt8,
    bot_name         LowCardinality(String),
    ip_hash          String,
    tracker_version  LowCardinality(String),
    ingested_at      DateTime DEFAULT now(),

    -- Skip indexes for the access patterns the sort key does not cover.
    -- GRANULARITY 1 on person_id keeps profile lookups near-instant.
    INDEX idx_person  person_id  TYPE bloom_filter(0.01) GRANULARITY 1,
    INDEX idx_session session_id TYPE bloom_filter(0.01) GRANULARITY 1,
    INDEX idx_path    path       TYPE bloom_filter(0.01) GRANULARITY 4,
    INDEX idx_host    host       TYPE set(64)            GRANULARITY 4
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(timestamp)
ORDER BY (project_id, toDate(timestamp), name, person_id, timestamp)
TTL toDateTime(timestamp) + INTERVAL 25 MONTH
SETTINGS index_granularity = 8192;
