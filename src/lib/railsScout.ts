/**
 * Multi-rail bounty scout: Superteam Earn (public) + Frantic board.
 * Complements Gibwork explore so overnight agents can see adjacent ≥$20 paths
 * without Phantom / Discord / X posting.
 */

export interface EarnListingSlim {
  id: string;
  title: string;
  slug: string;
  type: string;
  rewardAmount: number | null;
  token: string | null;
  deadline: string | null;
  agentAccess: string;
  compensationType: string | null;
  url: string;
  codingLikely: boolean;
  skipHint: string | null;
}

export interface FranticBountySlim {
  number: number | string;
  title: string;
  priceUsd: number;
  funded: boolean;
  workStatus: string;
  slotsAvailable: number | null;
  url: string;
}

export interface RailsScoutResult {
  generatedAt: string;
  minUsd: number;
  earn: {
    ok: boolean;
    error?: string;
    totalOpen: number;
    agentEligible: EarnListingSlim[];
    codingGeMin: EarnListingSlim[];
    all: EarnListingSlim[];
  };
  frantic: {
    ok: boolean;
    error?: string;
    openCount: number;
    geMin: FranticBountySlim[];
    open: FranticBountySlim[];
  };
  summary: {
    agentEligibleCount: number;
    earnCodingGeMinCount: number;
    franticGeMinCount: number;
    actionableCount: number;
    nothingNew: boolean;
  };
  markdown: string;
}

const EARN_OPEN_URL = "https://earn.superteam.fun/api/listings?status=open";
const FRANTIC_BOARD_URL = "https://gofrantic.com/v1/board";
const EARN_LISTING_BASE = "https://earn.superteam.fun/listing";
const FRANTIC_BASE = "https://gofrantic.com";

/** IdleDev / Crypto Guru standing skips (slug substrings or title keywords). */
export const DEFAULT_SKIP_HINTS: Array<{ match: RegExp; hint: string }> = [
  { match: /steve-agent-arena|steve agent arena/i, hint: "skip:Steve Arena (capital)" },
  { match: /\bt3n\b|trusted agent with t3n/i, hint: "skip:T3N abandoned" },
  { match: /opire/i, hint: "skip:Opire farm" },
  { match: /ideathon|demo-day-in-kyiv|ukraine/i, hint: "skip:Ukraine IDEATHON/demo" },
  { match: /create-an-app-on-cookie-chain|cookie chain/i, hint: "skip:Cookie already submitted" },
  { match: /x-post|tweet|record x video|create a post about|solara|stealf|grow app/i, hint: "skip:X/content posts" },
  { match: /trade,? tweet|trading content|kriptok|nectarfi/i, hint: "skip:trade/capital/content" },
  { match: /t-shirt|merch|vending|creator challenge|summit video|summit canada/i, hint: "skip:design/video/merch" },
  { match: /mermail/i, hint: "skip:Mermail needs X video" },
  { match: /spout finance|product feedback/i, hint: "skip:feedback/content" },
  { match: /business track milestone|pitch deck/i, hint: "skip:pitch/business track" },
];

const CODING_TITLE =
  /\b(build|develop|code|sdk|cli|mcp|api|rust|solidity|smart.?contract|audit|fix|agent|app on|backend|frontend|typescript|react|unity|ndk)\b/i;

function skipHintFor(title: string, slug: string): string | null {
  const hay = `${title} ${slug}`;
  for (const rule of DEFAULT_SKIP_HINTS) {
    if (rule.match.test(hay)) return rule.hint;
  }
  return null;
}

async function fetchJson(url: string, timeoutMs = 20_000): Promise<unknown> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { Accept: "application/json" },
      redirect: "follow",
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} for ${url}`);
    }
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

function normalizeEarn(raw: unknown): EarnListingSlim[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((row) => {
    const r = row as Record<string, unknown>;
    const title = String(r.title ?? "(untitled)");
    const slug = String(r.slug ?? "");
    const reward =
      r.rewardAmount == null || r.rewardAmount === ""
        ? null
        : Number(r.rewardAmount);
    const agentAccess = String(r.agentAccess ?? "UNKNOWN");
    return {
      id: String(r.id ?? ""),
      title,
      slug,
      type: String(r.type ?? ""),
      rewardAmount: Number.isFinite(reward as number) ? (reward as number) : null,
      token: r.token != null ? String(r.token) : null,
      deadline: r.deadline != null ? String(r.deadline) : null,
      agentAccess,
      compensationType:
        r.compensationType != null ? String(r.compensationType) : null,
      url: `${EARN_LISTING_BASE}/${slug}/`,
      codingLikely: CODING_TITLE.test(title),
      skipHint: skipHintFor(title, slug),
    };
  });
}

function normalizeFrantic(raw: unknown): FranticBountySlim[] {
  const board =
    raw && typeof raw === "object" && "board" in (raw as object)
      ? ((raw as { board: Record<string, unknown> }).board ?? {})
      : {};
  const open = Array.isArray(board.open_bounties) ? board.open_bounties : [];
  return open.map((row) => {
    const b = row as Record<string, unknown>;
    const slots = (b.claim_slots ?? {}) as Record<string, unknown>;
    const path = String(b.url ?? `/bounties/${b.number}`);
    const price = Number(b.price_usd ?? 0);
    return {
      number: (b.number as number | string) ?? "?",
      title: String(b.title ?? "(untitled)"),
      priceUsd: Number.isFinite(price) ? price : 0,
      funded: Boolean(b.funded),
      workStatus: String(b.work_status ?? ""),
      slotsAvailable:
        slots.available != null && Number.isFinite(Number(slots.available))
          ? Number(slots.available)
          : null,
      url: path.startsWith("http") ? path : `${FRANTIC_BASE}${path}`,
    };
  });
}

export interface RailsScoutOptions {
  minUsd?: number;
  /** Include listings that match DEFAULT_SKIP_HINTS in agentEligible / codingGeMin. Default false. */
  includeSkipped?: boolean;
}

export async function runRailsScout(
  opts: RailsScoutOptions = {},
): Promise<RailsScoutResult> {
  const minUsd = opts.minUsd ?? 20;
  const includeSkipped = opts.includeSkipped ?? false;
  const generatedAt = new Date().toISOString();

  const earn: RailsScoutResult["earn"] = {
    ok: false,
    totalOpen: 0,
    agentEligible: [],
    codingGeMin: [],
    all: [],
  };
  const frantic: RailsScoutResult["frantic"] = {
    ok: false,
    openCount: 0,
    geMin: [],
    open: [],
  };

  try {
    const raw = await fetchJson(EARN_OPEN_URL);
    const all = normalizeEarn(raw);
    earn.ok = true;
    earn.all = all;
    earn.totalOpen = all.length;
    const passSkip = (e: EarnListingSlim) =>
      includeSkipped || !e.skipHint;
    earn.agentEligible = all.filter(
      (e) =>
        (e.agentAccess === "AGENT_ALLOWED" || e.agentAccess === "AGENT_ONLY") &&
        (e.rewardAmount == null || e.rewardAmount >= minUsd) &&
        passSkip(e),
    );
    earn.codingGeMin = all.filter(
      (e) =>
        e.codingLikely &&
        (e.rewardAmount ?? 0) >= minUsd &&
        passSkip(e),
    );
  } catch (err) {
    earn.error = err instanceof Error ? err.message : String(err);
  }

  try {
    const raw = await fetchJson(FRANTIC_BOARD_URL);
    const open = normalizeFrantic(raw);
    frantic.ok = true;
    frantic.open = open;
    frantic.openCount = open.length;
    frantic.geMin = open.filter((b) => b.funded && b.priceUsd >= minUsd);
  } catch (err) {
    frantic.error = err instanceof Error ? err.message : String(err);
  }

  const actionableCount =
    earn.agentEligible.length +
    earn.codingGeMin.filter(
      (e) =>
        !earn.agentEligible.some((a) => a.id === e.id) &&
        e.agentAccess !== "HUMAN_ONLY",
    ).length +
    frantic.geMin.length;

  // "nothing new" for IdleDev overnight: no AGENT_ALLOWED left after skips, no Frantic ≥min
  const nothingNew =
    earn.agentEligible.length === 0 && frantic.geMin.length === 0;

  const summary = {
    agentEligibleCount: earn.agentEligible.length,
    earnCodingGeMinCount: earn.codingGeMin.length,
    franticGeMinCount: frantic.geMin.length,
    actionableCount,
    nothingNew,
  };

  const markdown = formatRailsScoutMarkdown({
    generatedAt,
    minUsd,
    earn,
    frantic,
    summary,
  });

  return { generatedAt, minUsd, earn, frantic, summary, markdown };
}

function formatRailsScoutMarkdown(r: {
  generatedAt: string;
  minUsd: number;
  earn: RailsScoutResult["earn"];
  frantic: RailsScoutResult["frantic"];
  summary: RailsScoutResult["summary"];
}): string {
  const lines: string[] = [
    `# Rails scout (Earn + Frantic)`,
    ``,
    `Generated: ${r.generatedAt}`,
    `Min USD: ≥$${r.minUsd}`,
    `Verdict: **${r.summary.nothingNew ? "nothing new" : "paths found"}** · agentEligible=${r.summary.agentEligibleCount} · earnCoding≥min=${r.summary.earnCodingGeMinCount} · frantic≥min=${r.summary.franticGeMinCount}`,
    ``,
    `## Superteam Earn`,
    ``,
  ];

  if (!r.earn.ok) {
    lines.push(`_Fetch failed:_ ${r.earn.error ?? "unknown"}`);
    lines.push(``);
  } else {
    lines.push(`Open listings: **${r.earn.totalOpen}**`);
    lines.push(``);
    lines.push(`### AGENT_ALLOWED / AGENT_ONLY (≥$${r.minUsd}, skips applied)`);
    lines.push(``);
    if (!r.earn.agentEligible.length) {
      lines.push(`_None._`);
    } else {
      for (const e of r.earn.agentEligible) {
        lines.push(
          `- **${e.title}** · $${e.rewardAmount ?? "?"} ${e.token ?? ""} · \`${e.agentAccess}\` · ${e.url}`,
        );
      }
    }
    lines.push(``);
    lines.push(`### Coding-likely ≥$${r.minUsd} (skips applied)`);
    lines.push(``);
    if (!r.earn.codingGeMin.length) {
      lines.push(`_None after standing skips._`);
    } else {
      for (const e of r.earn.codingGeMin) {
        lines.push(
          `- **${e.title}** · $${e.rewardAmount ?? "?"} · \`${e.agentAccess}\` · ${e.url}`,
        );
      }
    }
    lines.push(``);
    const skipped = r.earn.all.filter((e) => e.skipHint);
    if (skipped.length) {
      lines.push(`### Standing skips (${skipped.length})`);
      lines.push(``);
      for (const e of skipped.slice(0, 25)) {
        lines.push(
          `- ${e.skipHint} — ${e.title.slice(0, 70)} (\`${e.agentAccess}\`)`,
        );
      }
      lines.push(``);
    }
  }

  lines.push(`## Frantic (Base USDC — not Solana)`);
  lines.push(``);
  if (!r.frantic.ok) {
    lines.push(`_Fetch failed:_ ${r.frantic.error ?? "unknown"}`);
  } else {
    lines.push(`Open funded: **${r.frantic.openCount}**`);
    lines.push(``);
    if (!r.frantic.geMin.length) {
      lines.push(`_No open funded bounties ≥$${r.minUsd}._`);
      if (r.frantic.open.length) {
        lines.push(``);
        lines.push(`Open (all, below floor):`);
        for (const b of r.frantic.open) {
          lines.push(
            `- $${b.priceUsd} — ${b.title} · slots=${b.slotsAvailable ?? "?"} · ${b.url}`,
          );
        }
      }
    } else {
      for (const b of r.frantic.geMin) {
        lines.push(
          `- **$${b.priceUsd}** — ${b.title} · slots=${b.slotsAvailable ?? "?"} · ${b.url}`,
        );
      }
    }
  }
  lines.push(``);
  return lines.join("\n");
}
