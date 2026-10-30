// Uploads the Chrome API .env to Cloudflare as Worker secrets. Prints names only, never values.
import { spawnSync } from "node:child_process";
import { readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(here, "../chrome-extension-backend/backend/.env");
const workerDir = join(here, "chrome-api");

function arg(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function parseEnv(text) {
  const values = {};
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const eq = trimmed.indexOf("=");
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key && value) values[key] = value;
  }
  return values;
}

const api = arg("--api");
const web = arg("--web");
const values = parseEnv(readFileSync(envPath, "utf8"));
delete values.REDIS_URL;
values.PORT = "8000";
values.WEB_CONCURRENCY = "1";
values.FORWARDED_ALLOW_IPS = "*";
values.DB_SCHEMA = "chrome";
if (api) values.API_BASE_URL = api;
if (web) {
  values.WEB_APP_URL = web;
  values.CORS_ORIGINS = JSON.stringify([web]);
  values.COOKIE_SECURE = "true";
  values.COOKIE_SAMESITE = "none";
}
if (!values.REPO_SCAN_URL) {
  values.REPO_SCAN_URL = "https://vs-ext-backend.stack3security.workers.dev";
}

const file = join(tmpdir(), `stack3-chrome-secrets-${process.pid}.json`);
writeFileSync(file, JSON.stringify(values), { mode: 0o600 });
const result = spawnSync("npx", ["wrangler", "secret", "bulk", file], {
  cwd: workerDir,
  stdio: "inherit",
});
unlinkSync(file);
if (result.status !== 0) process.exit(result.status ?? 1);
console.log(`Uploaded ${Object.keys(values).length} Chrome API secret names.`);
