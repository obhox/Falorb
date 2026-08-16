-- Identity merges without rewriting history.
--
-- The problem: someone browses anonymously for a week, then signs up. Those
-- earlier events were written with an anonymous person_id. Making them appear
-- on the real profile by rewriting them would mean `ALTER TABLE ... UPDATE`
-- over potentially millions of rows — a mutation that rewrites whole parts and
-- is far too expensive to run on every signup.
--
-- Instead, merges are recorded here and resolved at *read* time through a
-- dictionary lookup. A merge becomes a single small insert, and the person's
-- entire history re-attributes itself retroactively and instantly.

CREATE TABLE IF NOT EXISTS person_overrides
(
    project_id  UInt32,
    distinct_id String,
    person_id   UUID,
    -- ReplacingMergeTree keeps the highest version per key, so a later merge
    -- always supersedes an earlier one without needing a delete.
    version     UInt64,
    updated_at  DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree(version)
ORDER BY (project_id, distinct_id);

CREATE DICTIONARY IF NOT EXISTS person_overrides_dict
(
    project_id  UInt32,
    distinct_id String,
    person_id   UUID
)
PRIMARY KEY project_id, distinct_id
-- A ClickHouse-sourced dictionary connects back to the server to load itself,
-- and does so as `default` with no password unless told otherwise — which
-- fails outright on any install that has real credentials. The placeholders
-- are substituted from the environment by the migration runner so that no
-- password is ever committed to the repository.
SOURCE(CLICKHOUSE(
    DB '{{CH_DATABASE}}'
    TABLE 'person_overrides'
    USER '{{CH_USER}}'
    PASSWORD '{{CH_PASSWORD}}'
))
-- Reloads every 30-60s. A merge therefore becomes visible in reports within
-- about a minute, which is the deliberate tradeoff for making reads free.
LIFETIME(MIN 30 MAX 60)
LAYOUT(COMPLEX_KEY_HASHED());

-- Canonical read surface. Application queries should select from `events_v`
-- rather than `events`, so that identity merges are always applied. Selecting
-- from the raw table is still correct for ingest-time diagnostics.
CREATE VIEW IF NOT EXISTS events_v AS
SELECT
    * EXCEPT (person_id),
    dictGetOrDefault(
        '{{CH_DATABASE}}.person_overrides_dict',
        'person_id',
        (project_id, distinct_id),
        person_id
    ) AS person_id
FROM events;
