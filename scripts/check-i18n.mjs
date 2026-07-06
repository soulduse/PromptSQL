#!/usr/bin/env node
/**
 * i18n locale parity checker.
 * Compares every locale file against en.json (source of truth) and reports
 * missing / extra keys. Exits 1 on any mismatch unless --warn-only is passed.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const LOCALES_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "i18n", "locales");
const BASE_LOCALE = "en.json";
const warnOnly = process.argv.includes("--warn-only");

function flattenKeys(obj, prefix = "", out = []) {
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      flattenKeys(value, path, out);
    } else {
      out.push(path);
    }
  }
  return out;
}

const baseKeys = new Set(
  flattenKeys(JSON.parse(readFileSync(join(LOCALES_DIR, BASE_LOCALE), "utf8"))),
);

let failed = false;
for (const file of readdirSync(LOCALES_DIR).filter((f) => f.endsWith(".json") && f !== BASE_LOCALE)) {
  const keys = new Set(flattenKeys(JSON.parse(readFileSync(join(LOCALES_DIR, file), "utf8"))));
  const missing = [...baseKeys].filter((k) => !keys.has(k));
  const extra = [...keys].filter((k) => !baseKeys.has(k));

  if (missing.length === 0 && extra.length === 0) {
    console.log(`✓ ${file}: in sync (${keys.size} keys)`);
    continue;
  }
  failed = true;
  if (missing.length > 0) {
    console.log(`✗ ${file}: ${missing.length} missing key(s)`);
    for (const k of missing) console.log(`    - ${k}`);
  }
  if (extra.length > 0) {
    console.log(`✗ ${file}: ${extra.length} extra key(s) not in ${BASE_LOCALE}`);
    for (const k of extra) console.log(`    + ${k}`);
  }
}

if (failed) {
  if (warnOnly) {
    console.log("\ni18n parity check failed (warn-only mode — not failing the build).");
  } else {
    console.error("\ni18n parity check failed.");
    process.exit(1);
  }
} else {
  console.log("\nAll locales in sync.");
}
