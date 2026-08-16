import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { clickhouseConfigFromEnv, createBootstrapClient, createClickHouse } from "./client";
import { loadRootEnv } from "../load-env";

loadRootEnv();

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "migrations");

/**
 * Split a migration file into individual statements.
 *
 * ClickHouse's HTTP interface accepts one statement per request, so files have
 * to be split. A naive `split(";")` would break on any semicolon inside a
 * string literal or comment, so this walks the text tracking quote and comment
 * state instead.
 */
export function splitStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;
  let inBacktick = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i]!;
    const next = sql[i + 1];

    if (inLineComment) {
      if (ch === "\n") inLineComment = false;
      current += ch;
      continue;
    }
    if (inBlockComment) {
      if (ch === "*" && next === "/") {
        inBlockComment = false;
        current += "*/";
        i++;
        continue;
      }
      current += ch;
      continue;
    }
    if (!inSingle && !inDouble && !inBacktick) {
      if (ch === "-" && next === "-") {
        inLineComment = true;
        current += ch;
        continue;
      }
      if (ch === "/" && next === "*") {
        inBlockComment = true;
        current += "/*";
        i++;
        continue;
      }
    }

    if (ch === "'" && !inDouble && !inBacktick) inSingle = !inSingle;
    else if (ch === '"' && !inSingle && !inBacktick) inDouble = !inDouble;
    else if (ch === "`" && !inSingle && !inDouble) inBacktick = !inBacktick;

    if (ch === ";" && !inSingle && !inDouble && !inBacktick) {
      const trimmed = stripComments(current);
      if (trimmed) statements.push(current.trim());
      current = "";
      continue;
    }

    current += ch;
  }

  const tail = stripComments(current);
  if (tail) statements.push(current.trim());
  return statements;
}

/** Whether a chunk contains anything other than comments and whitespace. */
function stripComments(chunk: string): string {
  return chunk
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/--[^\n]*/g, "")
    .trim();
}

/**
 * Substitute `{{PLACEHOLDER}}` tokens in a migration.
 *
 * Needed because a ClickHouse-sourced DICTIONARY has to embed the credentials
 * it uses to load itself, and those must not live in version control. Throws
 * on an unknown placeholder rather than silently producing SQL containing a
 * literal `{{...}}`, which would fail much further downstream.
 */
export function substitute(sql: string, values: Record<string, string>): string {
  return sql.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    const value = values[key];
    if (value === undefined) {
      throw new Error(`Migration references unknown placeholder {{${key}}}`);
    }
    // ClickHouse string literals are single-quoted; escaping prevents a
    // password containing a quote from breaking out of the literal.
    return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  });
}

export async function migrate(): Promise<void> {
  const config = clickhouseConfigFromEnv();
  const placeholders: Record<string, string> = {
    CH_DATABASE: config.database,
    CH_USER: config.username,
    CH_PASSWORD: config.password,
  };

  // The database has to exist before a database-bound client can connect.
  const bootstrap = createBootstrapClient(config);
  await bootstrap.command({
    query: `CREATE DATABASE IF NOT EXISTS ${escapeIdent(config.database)}`,
  });
  await bootstrap.close();

  const client = createClickHouse(config);

  await client.command({
    query: `
      CREATE TABLE IF NOT EXISTS _migrations (
        name       String,
        applied_at DateTime DEFAULT now()
      ) ENGINE = MergeTree ORDER BY name
    `,
  });

  const applied = new Set(
    (
      await (
        await client.query({ query: "SELECT name FROM _migrations", format: "JSONEachRow" })
      ).json<{ name: string }>()
    ).map((r) => r.name),
  );

  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();

  let ran = 0;
  for (const file of files) {
    if (applied.has(file)) {
      console.log(`  skip  ${file}`);
      continue;
    }

    const sql = substitute(await readFile(join(MIGRATIONS_DIR, file), "utf8"), placeholders);
    const statements = splitStatements(sql);
    console.log(`  apply ${file} (${statements.length} statements)`);

    for (const [i, statement] of statements.entries()) {
      try {
        await client.command({ query: statement });
      } catch (error) {
        // Statements can carry substituted credentials, so never echo one raw.
        const safe = config.password
          ? statement.replaceAll(config.password, "***")
          : statement;
        console.error(`\nFailed in ${file}, statement ${i + 1}:\n${safe}\n`);
        throw error;
      }
    }

    await client.insert({
      table: "_migrations",
      values: [{ name: file }],
      format: "JSONEachRow",
    });
    ran++;
  }

  await client.close();
  console.log(ran === 0 ? "\nClickHouse already up to date." : `\nApplied ${ran} migration(s).`);
}

/** ClickHouse identifiers are backtick-quoted; embedded backticks are doubled. */
function escapeIdent(name: string): string {
  return `\`${name.replace(/`/g, "``")}\``;
}

// Run directly: `pnpm --filter @falorb/db ch:migrate`
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop() ?? "")) {
  migrate().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
