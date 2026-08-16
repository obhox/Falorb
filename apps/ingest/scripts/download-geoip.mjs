#!/usr/bin/env node
import { execFile } from "node:child_process";
import { mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

/**
 * Downloads the MaxMind GeoLite2 databases used for geo and ASN enrichment.
 *
 * These are not committed: the City database is ~70MB, MaxMind's licence
 * forbids redistribution, and the data is stale within weeks. Ingest degrades
 * gracefully when they are absent, so this is a setup step rather than a build
 * dependency.
 *
 * Requires a free MaxMind account and a licence key:
 *   https://www.maxmind.com/en/geolite2/signup
 *   MAXMIND_LICENSE_KEY=... pnpm --filter @falorb/ingest geoip:download
 */

const execFileAsync = promisify(execFile);

const EDITIONS = [
  { id: "GeoLite2-City", required: true },
  // Optional: only drives the "skip company lookup for consumer ISPs" filter.
  { id: "GeoLite2-ASN", required: false },
];

const licenseKey = process.env.MAXMIND_LICENSE_KEY;
if (!licenseKey) {
  console.error(
    [
      "MAXMIND_LICENSE_KEY is not set.",
      "",
      "Geo enrichment is optional — ingest runs without it and leaves country,",
      "region and city empty. To enable it:",
      "",
      "  1. Create a free account at https://www.maxmind.com/en/geolite2/signup",
      "  2. Generate a licence key",
      "  3. Add MAXMIND_LICENSE_KEY=... to .env",
      "  4. Re-run this command",
    ].join("\n"),
  );
  process.exit(1);
}

const targetDir =
  process.env.MAXMIND_DB_DIR ??
  join(dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url))))), "infra", "geoip");

await mkdir(targetDir, { recursive: true });

// `tar` is required to unpack MaxMind's archives. It ships with macOS and
// every mainstream Linux, and shelling out avoids adding a tar library to the
// dependency tree for a script that runs a handful of times a year.
try {
  await execFileAsync("tar", ["--version"]);
} catch {
  console.error("`tar` was not found on PATH. Install it, or unpack the archives manually.");
  process.exit(1);
}

let downloaded = 0;

for (const edition of EDITIONS) {
  const url =
    `https://download.maxmind.com/app/geoip_download` +
    `?edition_id=${edition.id}&license_key=${encodeURIComponent(licenseKey)}&suffix=tar.gz`;

  const archive = join(targetDir, `${edition.id}.tar.gz`);
  const extractDir = join(targetDir, `${edition.id}.tmp`);

  process.stdout.write(`  ${edition.id} … `);

  try {
    const response = await fetch(url);

    if (!response.ok) {
      // 401 here almost always means the key is valid but not yet activated,
      // or was created for the wrong product.
      const hint =
        response.status === 401
          ? " (check the licence key is active and has GeoLite2 access)"
          : "";
      throw new Error(`HTTP ${response.status}${hint}`);
    }
    if (!response.body) throw new Error("empty response body");

    await pipeline(response.body, createWriteStream(archive));

    await rm(extractDir, { recursive: true, force: true });
    await mkdir(extractDir, { recursive: true });
    await execFileAsync("tar", ["-xzf", archive, "-C", extractDir]);

    // The archive contains a date-stamped directory; find the .mmdb inside it
    // rather than assuming today's date.
    const inner = await readdir(extractDir);
    let found = null;
    for (const entry of inner) {
      const candidate = join(extractDir, entry, `${edition.id}.mmdb`);
      try {
        await stat(candidate);
        found = candidate;
        break;
      } catch {
        /* keep looking */
      }
    }
    if (!found) throw new Error("no .mmdb inside the archive");

    const destination = join(targetDir, `${edition.id}.mmdb`);
    await rename(found, destination);
    const { size } = await stat(destination);

    await rm(archive, { force: true });
    await rm(extractDir, { recursive: true, force: true });

    console.log(`${(size / 1_048_576).toFixed(1)} MB → ${destination}`);
    downloaded++;
  } catch (error) {
    await rm(archive, { force: true });
    await rm(extractDir, { recursive: true, force: true });

    const message = error instanceof Error ? error.message : String(error);
    if (edition.required) {
      console.error(`failed — ${message}`);
      process.exit(1);
    }
    console.log(`skipped (${message})`);
  }
}

console.log(
  `\n${downloaded} database(s) ready. Set MAXMIND_DB_PATH=${join(targetDir, "GeoLite2-City.mmdb")} in .env.`,
);
