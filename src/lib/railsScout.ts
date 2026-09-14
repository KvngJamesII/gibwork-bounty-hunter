import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * Multi-rail bounty scout: Superteam Earn (public) + Frantic board + DeskCrew.
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

export interface DeskCrewBountySlim {
  id: string;
  title: string;
  priceUsd: number;
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
  deskcrew: {
    ok: boolean;
    error?: string;
    openCount: number;
    openValueUsd: number;
    avgValueUsd: number;
    attemptCostUsd: number;
    geMin: DeskCrewBountySlim[];
    capitalGate: true;
    network?: string;
  };
  summary: {
    agentEligibleCount: number;
    earnCodingGeMinCount: number;
    franticGeMinCount: number;
    deskcrewGeMinCount: number;
    actionableCount: number;
    nothingNew: boolean;
  };
  /** Earn open-slug delta vs prior `.cache/rails-scout-last.json` (when writeCache). */
  earnDelta: {
    priorGeneratedAt: string | null;
    priorAgeLabel: string | null;
    added: string[];
    removed: string[];
    unchanged: number;
    cachePath: string;
  };
  markdown: string;
}

const EARN_OPEN_URL = "https://earn.superteam.fun/api/listings?status=open";
const FRANTIC_BOARD_URL = "https://gofrantic.com/v1/board";
const EARN_LISTING_BASE = "https://earn.superteam.fun/listing";
const FRANTIC_BASE = "https://gofrantic.com";
const DESKCREW_X402_URL = "https://deskcrew.io/.well-known/x402";
const DESKCREW_BOUNTIES_URL = "https://deskcrew.io/api/bounties";
const DESKCREW_ARENA = "https://deskcrew.io/arena";

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

function readEarnInfo(x402: unknown): {
  openCount: number;
  openValueUsd: number;
  avgValueUsd: number;
  attemptCostUsd: number;
  network?: string;
} | null {
  if (!x402 || typeof x402 !== "object") return null;
  const ext = (x402 as { extensions?: { earn?: { info?: Record<string, unknown> } } })
    .extensions;
  const info = ext?.earn?.info;
  if (!info || typeof info !== "object") return null;
  const openCount = Number(info.open ?? 0);
  const openValueUsd = Number(info.openValueUsd ?? 0);
  const avgValueUsd = Number(info.avgValueUsd ?? 0);
  const attemptCostUsd = Number(info.attemptCostUsd ?? 0);
  const network =
    info.network != null && String(info.network).length
      ? String(info.network)
      : undefined;
  return {
    openCount: Number.isFinite(openCount) ? openCount : 0,
    openValueUsd: Number.isFinite(openValueUsd) ? openValueUsd : 0,
    avgValueUsd: Number.isFinite(avgValueUsd) ? avgValueUsd : 0,
    attemptCostUsd: Number.isFinite(attemptCostUsd) ? attemptCostUsd : 0,
    network,
  };
}

function normalizeDeskCrewBounties(
  raw: unknown,
  minUsd: number,
): {
  openCount: number;
  openValueUsd: number;
  avgValueUsd: number;
  geMin: DeskCrewBountySlim[];
  humanPage: string;
} {
  const body = (raw && typeof raw === "object" ? raw : {}) as Record<
    string,
    unknown
  >;
  const list = Array.isArray(body.bounties) ? body.bounties : [];
  const humanPage =
    body.humanPage != null && String(body.humanPage).length
      ? String(body.humanPage)
      : DESKCREW_ARENA;
  const economics =
    body.economics && typeof body.economics === "object"
      ? (body.economics as Record<string, unknown>)
      : {};
  const openCount =
    Number.isFinite(Number(economics.openBounties ?? body.count ?? list.length))
      ? Number(economics.openBounties ?? body.count ?? list.length)
      : list.length;
  const openValueUsd = Number.isFinite(Number(economics.openBountyUsd ?? 0))
    ? Number(economics.openBountyUsd ?? 0)
    : 0;
  const avgValueUsd = Number.isFinite(Number(economics.avgBountyUsd ?? 0))
    ? Number(economics.avgBountyUsd ?? 0)
    : 0;

  const geMin: DeskCrewBountySlim[] = [];
  for (const row of list) {
    const b = row as Record<string, unknown>;
    const price = Number(b.bountyUsd ?? b.netRewardUsd ?? 0);
    if (!Number.isFinite(price) || price < minUsd) continue;
    const id = String(b.ticketId ?? "");
    geMin.push({
      id,
      title: String(b.subject ?? "(untitled)"),
      priceUsd: price,
      url: `${humanPage}${humanPage.includes("?") ? "&" : "?"}ticket=${encodeURIComponent(id)}`,
    });
  }

  return { openCount, openValueUsd, avgValueUsd, geMin, humanPage };
}


const DEFAULT_RAILS_CACHE = ".cache/rails-scout-last.json";

export interface RailsScoutCacheFile {
  generatedAt: string;
  minUsd: number;
  earnSlugs: string[];
  earnTitles?: Record<string, string>;
}

function ageLabel(iso: string | null): string | null {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  const mins = Math.round(ms / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

async function loadRailsCache(
  cachePath: string,
): Promise<RailsScoutCacheFile | null> {
  try {
    const raw = await readFile(cachePath, "utf8");
    const parsed = JSON.parse(raw) as RailsScoutCacheFile;
    if (!parsed || !Array.isArray(parsed.earnSlugs)) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function saveRailsCache(
  cachePath: string,
  payload: RailsScoutCacheFile,
): Promise<void> {
  await mkdir(dirname(cachePath) || ".", { recursive: true });
  await writeFile(cachePath, JSON.stringify(payload, null, 2) + "\n", "utf8");
}

export interface RailsScoutOptions {
  minUsd?: number;
  /** Include listings that match DEFAULT_SKIP_HINTS in agentEligible / codingGeMin. Default false. */
  includeSkipped?: boolean;
  /** Persist / compare Earn slug set (default `.cache/rails-scout-last.json`). */
  cachePath?: string;
  /** Write cache after scout (default true). */
  writeCache?: boolean;
}

export async function runRailsScout(
  opts: RailsScoutOptions = {},
): Promise<RailsScoutResult> {
  const minUsd = opts.minUsd ?? 20;
  const includeSkipped = opts.includeSkipped ?? false;
  const cachePath = opts.cachePath ?? DEFAULT_RAILS_CACHE;
  const writeCache = opts.writeCache ?? true;
  const generatedAt = new Date().toISOString();
  const priorCache = await loadRailsCache(cachePath);

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
  const deskcrew: RailsScoutResult["deskcrew"] = {
    ok: false,
    openCount: 0,
    openValueUsd: 0,
    avgValueUsd: 0,
    attemptCostUsd: 0,
    geMin: [],
    capitalGate: true,
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

  {
    const errors: string[] = [];
    let x402Info: ReturnType<typeof readEarnInfo> = null;
    let bountyNorm: ReturnType<typeof normalizeDeskCrewBounties> | null = null;

    try {
      const x402 = await fetchJson(DESKCREW_X402_URL);
      x402Info = readEarnInfo(x402);
      if (!x402Info) errors.push("x402 missing extensions.earn.info");
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }

    try {
      const raw = await fetchJson(DESKCREW_BOUNTIES_URL);
      bountyNorm = normalizeDeskCrewBounties(raw, minUsd);
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }

    if (x402Info || bountyNorm) {
      deskcrew.ok = true;
      deskcrew.openCount = x402Info?.openCount ?? bountyNorm?.openCount ?? 0;
      deskcrew.openValueUsd =
        x402Info?.openValueUsd ?? bountyNorm?.openValueUsd ?? 0;
      deskcrew.avgValueUsd =
        x402Info?.avgValueUsd ?? bountyNorm?.avgValueUsd ?? 0;
      deskcrew.attemptCostUsd = x402Info?.attemptCostUsd ?? 0;
      deskcrew.network = x402Info?.network;
      deskcrew.geMin = bountyNorm?.geMin ?? [];
      deskcrew.capitalGate = true;
      if (errors.length && (!x402Info || !bountyNorm)) {
        deskcrew.error = errors.join("; ");
      }
    } else {
      deskcrew.error = errors.join("; ") || "DeskCrew fetch failed";
    }
  }

  const actionableCount =
    earn.agentEligible.length +
    earn.codingGeMin.filter(
      (e) =>
        !earn.agentEligible.some((a) => a.id === e.id) &&
        e.agentAccess !== "HUMAN_ONLY",
    ).length +
    frantic.geMin.length +
    deskcrew.geMin.length;

  // "nothing new" for IdleDev overnight: no AGENT_ALLOWED left after skips,
  // no Frantic ≥min, no DeskCrew ≥min
  const nothingNew =
    earn.agentEligible.length === 0 &&
    frantic.geMin.length === 0 &&
    deskcrew.geMin.length === 0;

  const summary = {
    agentEligibleCount: earn.agentEligible.length,
    earnCodingGeMinCount: earn.codingGeMin.length,
    franticGeMinCount: frantic.geMin.length,
    deskcrewGeMinCount: deskcrew.geMin.length,
    actionableCount,
    nothingNew,
  };

  const currentSlugs = earn.all.map((e) => e.slug).filter(Boolean);
  const priorSlugs = new Set(priorCache?.earnSlugs ?? []);
  const currentSet = new Set(currentSlugs);
  const added = currentSlugs.filter((s) => !priorSlugs.has(s));
  const removed = [...priorSlugs].filter((s) => !currentSet.has(s));
  const unchanged = currentSlugs.filter((s) => priorSlugs.has(s)).length;
  const earnDelta = {
    priorGeneratedAt: priorCache?.generatedAt ?? null,
    priorAgeLabel: ageLabel(priorCache?.generatedAt ?? null),
    added,
    removed,
    unchanged,
    cachePath,
  };

  if (writeCache && earn.ok) {
    const earnTitles: Record<string, string> = {};
    for (const e of earn.all) earnTitles[e.slug] = e.title;
    await saveRailsCache(cachePath, {
      generatedAt,
      minUsd,
      earnSlugs: currentSlugs,
      earnTitles,
    });
  }

  const markdown = formatRailsScoutMarkdown({
    generatedAt,
    minUsd,
    earn,
    frantic,
    deskcrew,
    summary,
    earnDelta,
  });

  return {
    generatedAt,
    minUsd,
    earn,
    frantic,
    deskcrew,
    summary,
    earnDelta,
    markdown,
  };
}

function formatRailsScoutMarkdown(r: {
  generatedAt: string;
  minUsd: number;
  earn: RailsScoutResult["earn"];
  frantic: RailsScoutResult["frantic"];
  deskcrew: RailsScoutResult["deskcrew"];
  summary: RailsScoutResult["summary"];
  earnDelta: RailsScoutResult["earnDelta"];
}): string {
  const d = r.earnDelta;
  const deltaLine =
    d.priorGeneratedAt == null
      ? `_No prior cache_ (\`${d.cachePath}\`) — baseline written this run.`
      : `Vs prior @ ${d.priorGeneratedAt} (${d.priorAgeLabel ?? "?"}): **+${d.added.length}** new · **−${d.removed.length}** gone · **${d.unchanged}** unchanged`;
  const lines: string[] = [
    `# Rails scout (Earn + Frantic + DeskCrew)`,
    ``,
    `Generated: ${r.generatedAt}`,
    `Min USD: ≥$${r.minUsd}`,
    `Verdict: **${r.summary.nothingNew ? "nothing new" : "paths found"}** · agentEligible=${r.summary.agentEligibleCount} · earnCoding≥min=${r.summary.earnCodingGeMinCount} · frantic≥min=${r.summary.franticGeMinCount} · deskcrew≥min=${r.summary.deskcrewGeMinCount}`,
    ``,
    `## Earn listing delta`,
    ``,
    deltaLine,
  ];
  if (d.added.length) {
    lines.push(``);
    lines.push(`New slugs:`);
    for (const s of d.added.slice(0, 30)) lines.push(`- \`${s}\``);
  }
  if (d.removed.length) {
    lines.push(``);
    lines.push(`Gone slugs:`);
    for (const s of d.removed.slice(0, 30)) lines.push(`- \`${s}\``);
  }
  lines.push(``);
  lines.push(`## Superteam Earn`);
  lines.push(``);

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

  lines.push(`## DeskCrew (x402 support-ticket board)`);
  lines.push(``);
  if (!r.deskcrew.ok) {
    lines.push(`_Fetch failed:_ ${r.deskcrew.error ?? "unknown"}`);
  } else {
    const net = r.deskcrew.network ? ` · network=\`${r.deskcrew.network}\`` : "";
    lines.push(
      `Open: **${r.deskcrew.openCount}** · openValueUsd=$${r.deskcrew.openValueUsd} · avg=$${r.deskcrew.avgValueUsd} · attemptCostUsd=$${r.deskcrew.attemptCostUsd}${net}`,
    );
    lines.push(``);
    lines.push(
      `**capitalGate: true** — attempts need a funded USDC wallet for x402 tool fees (read-only scout; no live submit).`,
    );
    lines.push(``);
    if (!r.deskcrew.geMin.length) {
      lines.push(`_No open tickets ≥$${r.minUsd} (geMin empty)._`);
    } else {
      for (const b of r.deskcrew.geMin) {
        lines.push(
          `- **$${b.priceUsd}** — ${b.title} · \`${b.id}\` · ${b.url}`,
        );
      }
    }
    if (r.deskcrew.error) {
      lines.push(``);
      lines.push(`_Partial:_ ${r.deskcrew.error}`);
    }
  }
  lines.push(``);
  return lines.join("\n");
}
