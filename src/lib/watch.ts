/**
 * Poll open bounties and surface newly appearing ones above a min USD.
 * Seen IDs are persisted under .cache/ so restarts don't re-alert everything.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { exploreTasks, taskUrl, type PublicTaskSummary } from "./publicApi.js";

export interface WatchHit {
  id: string;
  title: string;
  url: string;
  usd: number;
  deadline?: string | null;
  tags?: string[];
  firstSeenAt: string;
}

export interface WatchResult {
  newHits: WatchHit[];
  scanned: number;
  cachePath: string;
  seenCount: number;
}

function parseUsd(task: PublicTaskSummary): number {
  if (typeof task.asset?.price === "number") return task.asset.price;
  const amount = Number(task.asset?.amount ?? 0);
  const decimals = Number(task.asset?.decimals ?? 6);
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  return amount / 10 ** decimals;
}

export function defaultCachePath(cwd = process.cwd()): string {
  return (
    process.env.GIB_HUNT_WATCH_CACHE ??
    join(cwd, ".cache", "gib-hunt-seen.json")
  );
}

interface SeenCache {
  version: 1;
  updatedAt: string;
  /** taskId -> ISO first-seen timestamp */
  seen: Record<string, string>;
}

async function loadCache(path: string): Promise<SeenCache> {
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as SeenCache;
    if (parsed?.version === 1 && parsed.seen && typeof parsed.seen === "object") {
      return parsed;
    }
  } catch {
    /* fresh cache */
  }
  return { version: 1, updatedAt: new Date().toISOString(), seen: {} };
}

async function saveCache(path: string, cache: SeenCache): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  cache.updatedAt = new Date().toISOString();
  await writeFile(path, JSON.stringify(cache, null, 2) + "\n", "utf8");
}

/** One poll pass: explore pages, return newly seen tasks above minUsd. */
export async function pollNewBounties(opts: {
  minUsd?: number;
  pages?: number;
  limit?: number;
  search?: string;
  cachePath?: string;
  /** If true, seed cache with current IDs without reporting them as new. */
  seedOnly?: boolean;
} = {}): Promise<WatchResult> {
  const minUsd = opts.minUsd ?? Number(process.env.GIB_HUNT_MIN_USD ?? 20);
  const pages = Math.max(1, opts.pages ?? 2);
  const limit = opts.limit ?? 15;
  const cachePath = opts.cachePath ?? defaultCachePath();
  const cache = await loadCache(cachePath);

  const byId = new Map<string, PublicTaskSummary>();
  for (let page = 1; page <= pages; page++) {
    const { results } = await exploreTasks({
      page,
      limit,
      search: opts.search,
    });
    for (const t of results) byId.set(t.id, t);
    if (results.length < limit) break;
  }

  const now = new Date().toISOString();
  const newHits: WatchHit[] = [];

  for (const task of byId.values()) {
    if (task.isOpen === false) continue;
    const usd = parseUsd(task);
    if (usd < minUsd) continue;

    if (cache.seen[task.id]) continue;

    cache.seen[task.id] = now;
    if (!opts.seedOnly) {
      newHits.push({
        id: task.id,
        title: task.title,
        url: taskUrl(task.id),
        usd,
        deadline: task.deadline,
        tags: task.tags,
        firstSeenAt: now,
      });
    }
  }

  await saveCache(cachePath, cache);

  return {
    newHits: newHits.sort((a, b) => b.usd - a.usd),
    scanned: byId.size,
    cachePath,
    seenCount: Object.keys(cache.seen).length,
  };
}

/** Sleep helper for watch loop. */
export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
