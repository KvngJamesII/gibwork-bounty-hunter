import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { runRailsScout, type RailsScoutResult } from "./railsScout.js";

/**
 * One-shot overnight grind snapshot:
 * - read-only Solana wallet check (public RPC; no Phantom / no signing)
 * - rails-scout (Earn + Frantic + DeskCrew)
 * - Collaborators.build open bounties (read-only)
 */

export const DEFAULT_GRIND_WALLET =
  "2Uup61Xjcqpyh9jfSNKBfHr4J1Ju7qjzDyUzFpdmduwW";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const DEFAULT_RPC =
  process.env.GIB_HUNT_SOLANA_RPC ??
  process.env.SOLANA_RPC ??
  "https://api.mainnet-beta.solana.com";
const COLLAB_URL = "https://collaborators.build/api/bounties";

export interface WalletSnapshot {
  ok: boolean;
  error?: string;
  address: string;
  rpc: string;
  sol: number | null;
  usdc: number | null;
  solUsd: number | null;
  approxUsd: number | null;
  meetsMinUsd: boolean;
  note: string;
}

export interface CollaboratorsBountySlim {
  id: string;
  title: string;
  amountUsd: number;
  status: string;
  url: string;
  repo: string;
  pendingSubmissions: number;
  contestedFarm: boolean;
  skipHint: string | null;
}

export interface CollaboratorsSnapshot {
  ok: boolean;
  error?: string;
  total: number;
  geMin: CollaboratorsBountySlim[];
  all: CollaboratorsBountySlim[];
}

export interface GrindReportResult {
  generatedAt: string;
  minUsd: number;
  wallet: WalletSnapshot;
  rails: RailsScoutResult;
  collaborators: CollaboratorsSnapshot;
  summary: {
    walletMeetsMin: boolean;
    railsNothingNew: boolean;
    collaboratorsGeMinCount: number;
    collaboratorsActionableCount: number;
    nothingNew: boolean;
  };
  markdown: string;
}

async function rpcCall(
  rpc: string,
  method: string,
  params: unknown[],
): Promise<unknown> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20_000);
  try {
    const res = await fetch(rpc, {
      method: "POST",
      signal: ctrl.signal,
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    if (!res.ok) throw new Error(`RPC HTTP ${res.status}`);
    const body = (await res.json()) as {
      result?: unknown;
      error?: { message?: string };
    };
    if (body.error?.message) throw new Error(body.error.message);
    return body.result;
  } finally {
    clearTimeout(t);
  }
}

async function fetchSolUsd(): Promise<number | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10_000);
    try {
      const res = await fetch(
        "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd",
        { signal: ctrl.signal, headers: { Accept: "application/json" } },
      );
      if (!res.ok) return null;
      const j = (await res.json()) as { solana?: { usd?: number } };
      const n = Number(j.solana?.usd);
      return Number.isFinite(n) ? n : null;
    } finally {
      clearTimeout(t);
    }
  } catch {
    return null;
  }
}

export async function checkWalletSnapshot(opts: {
  address?: string;
  rpc?: string;
  minUsd?: number;
} = {}): Promise<WalletSnapshot> {
  const address =
    opts.address ??
    process.env.GIB_HUNT_WALLET ??
    process.env.SOLANA_WALLET ??
    DEFAULT_GRIND_WALLET;
  const rpc = opts.rpc ?? DEFAULT_RPC;
  const minUsd = opts.minUsd ?? 20;

  try {
    const [balRaw, ataRaw, solUsd] = await Promise.all([
      rpcCall(rpc, "getBalance", [address]),
      rpcCall(rpc, "getTokenAccountsByOwner", [
        address,
        { mint: USDC_MINT },
        { encoding: "jsonParsed" },
      ]),
      fetchSolUsd(),
    ]);

    const lamports = Number(
      (balRaw as { value?: number } | null)?.value ?? NaN,
    );
    const sol = Number.isFinite(lamports) ? lamports / 1e9 : null;

    let usdc = 0;
    const value = (ataRaw as { value?: unknown[] } | null)?.value;
    if (Array.isArray(value)) {
      for (const row of value) {
        const info = (
          row as {
            account?: {
              data?: {
                parsed?: { info?: { tokenAmount?: { uiAmount?: number } } };
              };
            };
          }
        ).account?.data?.parsed?.info?.tokenAmount;
        const amt = Number(info?.uiAmount ?? 0);
        if (Number.isFinite(amt)) usdc += amt;
      }
    }

    const solPart =
      sol != null && solUsd != null ? sol * solUsd : null;
    const approxUsd =
      solPart != null
        ? solPart + usdc
        : usdc > 0
          ? usdc
          : null;
    const meetsMinUsd = (approxUsd ?? 0) >= minUsd || usdc >= minUsd;

    let note: string;
    if (meetsMinUsd) {
      note = `≥$${minUsd} (approx)`;
    } else if (sol != null && sol < 0.01 && usdc <= 0) {
      note = `SOL dust; USDC empty — NOT ≥$${minUsd}`;
    } else {
      note = `below $${minUsd} floor`;
    }

    return {
      ok: true,
      address,
      rpc,
      sol,
      usdc,
      solUsd,
      approxUsd,
      meetsMinUsd,
      note,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      address,
      rpc,
      sol: null,
      usdc: null,
      solUsd: null,
      approxUsd: null,
      meetsMinUsd: false,
      note: "wallet check failed",
    };
  }
}

function skipHintCollaborators(
  title: string,
  repo: string,
  pending: number,
): string | null {
  const hay = `${title} ${repo}`.toLowerCase();
  if (
    /andr-drgm\/collaborators/.test(hay) &&
    /readme|enchance|enhance/.test(hay)
  ) {
    return "skip:Collaborators README contested farm";
  }
  if (pending >= 5) {
    return "skip:contested (≥5 pending PRs)";
  }
  return null;
}

export async function fetchCollaborators(
  minUsd = 20,
): Promise<CollaboratorsSnapshot> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 20_000);
    let raw: unknown;
    try {
      const res = await fetch(COLLAB_URL, {
        signal: ctrl.signal,
        headers: { Accept: "application/json" },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${COLLAB_URL}`);
      raw = await res.json();
    } finally {
      clearTimeout(t);
    }

    const list = Array.isArray(raw)
      ? raw
      : Array.isArray((raw as { bounties?: unknown[] })?.bounties)
        ? ((raw as { bounties: unknown[] }).bounties ?? [])
        : [];

    const all: CollaboratorsBountySlim[] = list.map((row) => {
      const r = row as Record<string, unknown>;
      const amount = Number(r.bountyAmount ?? r.amount ?? 0);
      const owner = String(r.githubRepoOwner ?? "");
      const name = String(r.githubRepoName ?? "");
      const repo = owner && name ? `${owner}/${name}` : "";
      const subs = Array.isArray(r.submissions) ? r.submissions : [];
      const pending = subs.filter(
        (s) =>
          String((s as { status?: string }).status ?? "").toUpperCase() ===
          "PENDING",
      ).length;
      const title = String(r.title ?? "(untitled)");
      const contestedFarm = pending >= 5;
      return {
        id: String(r.id ?? ""),
        title,
        amountUsd: Number.isFinite(amount) ? amount : 0,
        status: String(r.status ?? ""),
        url: String(r.githubIssueUrl ?? ""),
        repo,
        pendingSubmissions: pending,
        contestedFarm,
        skipHint: skipHintCollaborators(title, repo, pending),
      };
    });

    const geMinActive = all.filter(
      (b) =>
        b.amountUsd >= minUsd && String(b.status).toUpperCase() === "ACTIVE",
    );

    return {
      ok: true,
      total: all.length,
      geMin: geMinActive,
      all,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      total: 0,
      geMin: [],
      all: [],
    };
  }
}

export interface GrindReportOptions {
  minUsd?: number;
  wallet?: string;
  rpc?: string;
  includeSkipped?: boolean;
  /** Write rails-scout Earn slug cache (default true). */
  writeRailsCache?: boolean;
  outPath?: string;
}

function formatWalletMd(w: WalletSnapshot, minUsd: number): string[] {
  const lines: string[] = [`## Wallet`, ``];
  if (!w.ok) {
    lines.push(`_Check failed:_ ${w.error ?? "unknown"}`);
    lines.push(`- Address: \`${w.address}\``);
    lines.push(``);
    return lines;
  }
  const solStr =
    w.sol != null
      ? `${w.sol.toFixed(9).replace(/0+$/, "").replace(/\.$/, "")}`
      : "?";
  const usdcStr = w.usdc != null ? w.usdc.toFixed(2) : "?";
  const px =
    w.solUsd != null ? ` @ ~$${w.solUsd.toFixed(2)}/SOL` : "";
  const approx =
    w.approxUsd != null ? ` · ≈$${w.approxUsd.toFixed(2)}` : "";
  lines.push(
    `- SOL **${solStr}**${px}; USDC **$${usdcStr}**${approx} — **${w.meetsMinUsd ? `≥$${minUsd}` : `NOT ≥$${minUsd}`}**`,
  );
  lines.push(`- \`${w.address}\``);
  lines.push(`- ${w.note}`);
  lines.push(``);
  return lines;
}

function formatCollaboratorsMd(
  c: CollaboratorsSnapshot,
  minUsd: number,
): string[] {
  const lines: string[] = [
    `## Collaborators.build`,
    ``,
  ];
  if (!c.ok) {
    lines.push(`_Fetch failed:_ ${c.error ?? "unknown"}`);
    lines.push(``);
    return lines;
  }
  lines.push(`Open/listed: **${c.total}** · ≥$${minUsd}: **${c.geMin.length}**`);
  lines.push(``);
  if (!c.geMin.length) {
    lines.push(`_No ACTIVE bounties ≥$${minUsd}._`);
  } else {
    for (const b of c.geMin) {
      const hint = b.skipHint ? ` · **${b.skipHint}**` : "";
      const farm = b.contestedFarm
        ? ` · pendingPRs=${b.pendingSubmissions} (contested)`
        : b.pendingSubmissions
          ? ` · pendingPRs=${b.pendingSubmissions}`
          : "";
      lines.push(
        `- **$${b.amountUsd}** — ${b.title} · \`${b.repo}\`${farm}${hint}`,
      );
      if (b.url) lines.push(`  ${b.url}`);
    }
  }
  lines.push(``);
  return lines;
}

export async function buildGrindReport(
  opts: GrindReportOptions = {},
): Promise<GrindReportResult> {
  const minUsd = opts.minUsd ?? 20;
  const generatedAt = new Date().toISOString();

  const [wallet, rails, collaborators] = await Promise.all([
    checkWalletSnapshot({
      address: opts.wallet,
      rpc: opts.rpc,
      minUsd,
    }),
    runRailsScout({
      minUsd,
      includeSkipped: opts.includeSkipped,
      writeCache: opts.writeRailsCache ?? true,
    }),
    fetchCollaborators(minUsd),
  ]);

  const collaboratorsActionableCount = collaborators.geMin.filter(
    (b) => !b.skipHint,
  ).length;

  const nothingNew =
    rails.summary.nothingNew && collaboratorsActionableCount === 0;

  const summary = {
    walletMeetsMin: wallet.meetsMinUsd,
    railsNothingNew: rails.summary.nothingNew,
    collaboratorsGeMinCount: collaborators.geMin.length,
    collaboratorsActionableCount,
    nothingNew,
  };

  const lines: string[] = [
    `# Overnight grind report`,
    ``,
    `Generated: ${generatedAt}`,
    `Min USD: ≥$${minUsd}`,
    `Verdict: **${nothingNew ? "nothing new" : "paths found"}** · wallet=${wallet.meetsMinUsd ? "≥min" : "below"} · rails=${rails.summary.nothingNew ? "empty" : "open"} · collabActionable=${collaboratorsActionableCount}`,
    ``,
    ...formatWalletMd(wallet, minUsd),
    `## Rails scout summary`,
    ``,
    `- Earn open: **${rails.earn.ok ? rails.earn.totalOpen : "fail"}** · agentEligible=${rails.summary.agentEligibleCount} · coding≥min=${rails.summary.earnCodingGeMinCount}`,
    `- Earn delta: +${rails.earnDelta.added.length} / −${rails.earnDelta.removed.length} / ${rails.earnDelta.unchanged} unchanged${rails.earnDelta.priorAgeLabel ? ` (vs ${rails.earnDelta.priorAgeLabel})` : " (no prior cache)"}`,
    `- Frantic ≥$${minUsd}: **${rails.summary.franticGeMinCount}** (open=${rails.frantic.openCount})`,
    `- DeskCrew ≥$${minUsd}: **${rails.summary.deskcrewGeMinCount}** (open=${rails.deskcrew.openCount}, openValueUsd=$${rails.deskcrew.openValueUsd}, capitalGate=true)`,
    ``,
  ];

  if (rails.earn.agentEligible.length) {
    lines.push(`### AGENT_ALLOWED / AGENT_ONLY`);
    lines.push(``);
    for (const e of rails.earn.agentEligible) {
      lines.push(
        `- **${e.title}** · $${e.rewardAmount ?? "?"} · \`${e.agentAccess}\` · ${e.url}`,
      );
    }
    lines.push(``);
  }

  if (rails.frantic.geMin.length) {
    lines.push(`### Frantic ≥$${minUsd}`);
    lines.push(``);
    for (const b of rails.frantic.geMin) {
      lines.push(`- **$${b.priceUsd}** — ${b.title} · ${b.url}`);
    }
    lines.push(``);
  } else if (rails.frantic.ok && rails.frantic.open.length) {
    lines.push(
      `### Frantic (all below $${minUsd}): ${rails.frantic.open.map((b) => `$${b.priceUsd}`).join("/")}`,
    );
    lines.push(``);
  }

  if (rails.deskcrew.geMin.length) {
    lines.push(`### DeskCrew ≥$${minUsd}`);
    lines.push(``);
    for (const b of rails.deskcrew.geMin) {
      lines.push(`- **$${b.priceUsd}** — ${b.title} · ${b.url}`);
    }
    lines.push(``);
  }

  lines.push(...formatCollaboratorsMd(collaborators, minUsd));

  lines.push(`## Notes`);
  lines.push(``);
  lines.push(
    `- Read-only: public Solana RPC + public Earn/Frantic/DeskCrew/Collaborators APIs. **No Phantom / no signing.**`,
  );
  lines.push(
    `- Full rails markdown available via \`gib-hunt rails-scout\`; this report is the overnight one-pager.`,
  );
  lines.push(``);

  const markdown = lines.join("\n");

  if (opts.outPath) {
    await mkdir(dirname(opts.outPath) || ".", { recursive: true });
    await writeFile(opts.outPath, markdown, "utf8");
  }

  return {
    generatedAt,
    minUsd,
    wallet,
    rails,
    collaborators,
    summary,
    markdown,
  };
}
