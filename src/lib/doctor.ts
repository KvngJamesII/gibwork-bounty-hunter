/**
 * Environment / connectivity checks for gib-hunt doctor.
 */
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { exploreTasks, getTask } from "./publicApi.js";
import { tryCreateSdkClient } from "./client.js";

export type CheckStatus = "pass" | "warn" | "fail";

export interface DoctorCheck {
  name: string;
  status: CheckStatus;
  detail: string;
}

const HACKATHON_TASK_ID = "1052f22d-3f87-4b1d-b0d7-71a60679e7fa";

function parseNodeMajor(version = process.version): number {
  const m = /^v(\d+)/.exec(version);
  return m ? Number(m[1]) : 0;
}

async function resolveSdkVersion(): Promise<string> {
  // Prefer dynamic import (respects package exports), then read nearby package.json.
  await import("@gibwork/sdk");
  const require = createRequire(import.meta.url);
  // Resolve a real export entry, then walk up to package.json
  const entry = require.resolve("@gibwork/sdk");
  let dir = dirname(entry);
  for (let i = 0; i < 6; i++) {
    try {
      const raw = await readFile(join(dir, "package.json"), "utf8");
      const pkg = JSON.parse(raw) as { name?: string; version?: string };
      if (pkg.name === "@gibwork/sdk" && pkg.version) return pkg.version;
    } catch {
      /* keep walking */
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // Fallback: node_modules path relative to this file's package root
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const root = join(here, "..", "..");
    const raw = await readFile(
      join(root, "node_modules", "@gibwork", "sdk", "package.json"),
      "utf8",
    );
    const pkg = JSON.parse(raw) as { version?: string };
    if (pkg.version) return pkg.version;
  } catch {
    /* ignore */
  }
  return "unknown";
}

export async function runDoctorChecks(): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];

  // Node version
  const major = parseNodeMajor();
  checks.push({
    name: "node",
    status: major >= 22 ? "pass" : "fail",
    detail:
      major >= 22
        ? `${process.version} (>=22 required)`
        : `${process.version} — upgrade to Node >=22`,
  });

  // @gibwork/sdk package present
  try {
    const version = await resolveSdkVersion();
    checks.push({
      name: "sdk-package",
      status: "pass",
      detail: `@gibwork/sdk@${version} importable`,
    });
  } catch (err) {
    checks.push({
      name: "sdk-package",
      status: "fail",
      detail: `Cannot import @gibwork/sdk: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  // Public explore API
  try {
    const started = Date.now();
    const { results } = await exploreTasks({ page: 1, limit: 5 });
    checks.push({
      name: "public-explore",
      status: results.length > 0 ? "pass" : "warn",
      detail: `${results.length} results in ${Date.now() - started}ms`,
    });
  } catch (err) {
    checks.push({
      name: "public-explore",
      status: "fail",
      detail: err instanceof Error ? err.message : String(err),
    });
  }

  // Public task detail API
  try {
    const started = Date.now();
    const task = await getTask(HACKATHON_TASK_ID);
    checks.push({
      name: "public-task",
      status: task?.id ? "pass" : "warn",
      detail: `got "${(task.title ?? "").slice(0, 48)}" in ${Date.now() - started}ms`,
    });
  } catch (err) {
    checks.push({
      name: "public-task",
      status: "fail",
      detail: err instanceof Error ? err.message : String(err),
    });
  }

  // Optional SDK wallet client
  const sdk = await tryCreateSdkClient();
  if (sdk.ok) {
    try {
      const page = await sdk.client.tasks.listAvailable({ page: 1, limit: 3 });
      const n = Array.isArray(page.results) ? page.results.length : 0;
      checks.push({
        name: "sdk-wallet",
        status: "pass",
        detail: `OK (${sdk.walletHint}) listAvailable=${n}`,
      });
    } catch (err) {
      checks.push({
        name: "sdk-wallet",
        status: "warn",
        detail: `client OK but listAvailable failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  } else {
    checks.push({
      name: "sdk-wallet",
      status: "warn",
      detail: sdk.reason,
    });
  }

  // Env summary
  checks.push({
    name: "env",
    status: "pass",
    detail: `GIBWORK_PRODUCTION=${process.env.GIBWORK_PRODUCTION ?? "true"} GIB_HUNT_MIN_USD=${process.env.GIB_HUNT_MIN_USD ?? "20"}`,
  });

  return checks;
}

export function formatDoctorReport(checks: DoctorCheck[]): string {
  const icon = (s: CheckStatus) =>
    s === "pass" ? "PASS" : s === "warn" ? "WARN" : "FAIL";
  const lines = checks.map(
    (c) => `[${icon(c.status)}] ${c.name.padEnd(16)} ${c.detail}`,
  );
  const fails = checks.filter((c) => c.status === "fail").length;
  const warns = checks.filter((c) => c.status === "warn").length;
  lines.push("");
  lines.push(
    fails === 0
      ? `Summary: OK (${warns} warning${warns === 1 ? "" : "s"})`
      : `Summary: ${fails} failure${fails === 1 ? "" : "s"}, ${warns} warning${warns === 1 ? "" : "s"}`,
  );
  return lines.join("\n");
}
