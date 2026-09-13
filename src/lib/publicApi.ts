/** Unauthenticated Gibwork public API helpers (no wallet / no Phantom). */

/** Discovery listing host (api2 is often IP-blocked; api.gib.work works). */
const EXPLORE_API =
  process.env.GIBWORK_EXPLORE_API_URL ?? "https://api.gib.work";

/** Task detail host used by the web app. */
const TASK_API =
  process.env.GIBWORK_TASK_API_URL ?? "https://gib.work/api";

export interface PublicTaskSummary {
  id: string;
  title: string;
  deadline?: string | null;
  isOpen?: boolean;
  tags?: string[];
  primarySkill?: { slug?: string; label?: string } | null;
  asset?: {
    symbol?: string;
    amount?: string;
    price?: number;
    decimals?: number;
    mintAddress?: string;
  } | null;
  user?: { username?: string; firstName?: string } | null;
  minSubmissionAmount?: number | string;
  xpBonus?: number;
  slug?: string;
  content?: string;
  status?: string;
}

export async function exploreTasks(opts: {
  page?: number;
  limit?: number;
  search?: string;
} = {}): Promise<{ results: PublicTaskSummary[]; raw: unknown }> {
  const page = opts.page ?? 1;
  // Unauthenticated explore often caps around 15; larger limits return 401.
  const requested = opts.limit ?? 15;
  const limit = Math.min(Math.max(1, requested), 15);
  const params = new URLSearchParams({
    page: String(page),
    limit: String(limit),
  });
  if (opts.search) params.set("search", opts.search);

  const res = await fetch(`${EXPLORE_API}/explore?${params}`, {
    headers: {
      Accept: "application/json",
      "User-Agent": "gibwork-bounty-hunter/0.1 (+https://github.com/KvngJamesII/gibwork-bounty-hunter)",
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`explore failed ${res.status}: ${body.slice(0, 300)}`);
  }
  const raw = await res.json();
  const results: PublicTaskSummary[] = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as { results?: unknown }).results)
      ? ((raw as { results: PublicTaskSummary[] }).results)
      : Array.isArray((raw as { data?: unknown }).data)
        ? ((raw as { data: PublicTaskSummary[] }).data)
        : [];
  return { results, raw };
}

export async function getTask(taskId: string): Promise<PublicTaskSummary> {
  const res = await fetch(`${TASK_API}/tasks/${taskId}`, {
    headers: {
      Accept: "application/json",
      "User-Agent": "gibwork-bounty-hunter/0.1 (+https://github.com/KvngJamesII/gibwork-bounty-hunter)",
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`getTask failed ${res.status}: ${body.slice(0, 300)}`);
  }
  return (await res.json()) as PublicTaskSummary;
}

export function taskUrl(taskId: string): string {
  return `https://gib.work/bounty/${taskId}`;
}
