import { readFile } from "node:fs/promises";
import type { PublicTaskSummary } from "./publicApi.js";
import { taskUrl } from "./publicApi.js";
import {
  rankBounties,
  codingFilterSkipReason,
  classifySubmitPath,
  type RankedBounty,
  type SubmitPathInfo,
} from "./rank.js";

export interface PriorOvernightCache {
  generatedAt: string | null;
  ids: string[];
  path: string;
}

export interface OvernightSkipRow {
  id: string;
  title: string;
  usd: number;
  reason: string;
}

export interface OvernightReportOptions {
  minUsd?: number;
  top?: number;
  skills?: string[];
  pagesScanned?: number;
  pageSize?: number;
  /** Prior cache markdown path for freshness + delta (default .cache/overnight-report.md). */
  priorCachePath?: string;
}

export interface OvernightReportResult {
  generatedAt: string;
  markdown: string;
  ranked: RankedBounty[];
  tagged: Array<{
    ranked: RankedBounty;
    submit: SubmitPathInfo;
  }>;
  skipped: OvernightSkipRow[];
  skipCounts: Record<string, number>;
  prior: PriorOvernightCache | null;
  delta: {
    priorAgeLabel: string | null;
    added: string[];
    removed: string[];
    unchanged: number;
  };
}

function parseUsdQuick(task: PublicTaskSummary): number {
  if (typeof task.asset?.price === "number") return task.asset.price;
  const amount = Number(task.asset?.amount ?? 0);
  const decimals = Number(task.asset?.decimals ?? 6);
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  return amount / 10 ** decimals;
}

/** Parse a previous overnight-report.md for Generated timestamp + bounty IDs. */
export async function readPriorOvernightCache(
  path: string,
): Promise<PriorOvernightCache | null> {
  try {
    const body = await readFile(path, "utf8");
    const gen = /Generated:\s*(\S+)/.exec(body);
    const ids = [
      ...body.matchAll(/https:\/\/gib\.work\/bounty\/([0-9a-f-]{36})/gi),
    ].map((m) => m[1].toLowerCase());
    const uniq = [...new Set(ids)];
    return {
      generatedAt: gen?.[1] ?? null,
      ids: uniq,
      path,
    };
  } catch {
    return null;
  }
}

function formatAge(iso: string | null, nowMs: number): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const sec = Math.max(0, Math.round((nowMs - t) / 1000));
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 48) return `${hr}h ago`;
  const days = Math.round(hr / 24);
  return `${days}d ago`;
}

function shortReasonKey(reason: string): string {
  const base = reason.split(" ")[0] ?? reason;
  return base;
}

/**
 * Build overnight coding bounty markdown with:
 * - reward floor (minUsd, default $20)
 * - skip reasons (closed / below_min_usd / not_coding / social / expired)
 * - AGENT_OR_EMAIL_SUBMIT vs HUMAN_BLOCKER tags
 * - prior cache freshness + id delta when .cache exists
 */
export async function buildOvernightReport(
  tasks: PublicTaskSummary[],
  opts: OvernightReportOptions = {},
): Promise<OvernightReportResult> {
  const minUsd = opts.minUsd ?? 20;
  const top = opts.top ?? 15;
  const skills = opts.skills;
  const pagesScanned = opts.pagesScanned ?? 0;
  const pageSize = opts.pageSize ?? 15;
  const priorPath = opts.priorCachePath ?? ".cache/overnight-report.md";
  const now = new Date();
  const generatedAt = now.toISOString();
  const nowMs = now.getTime();

  // Dedupe by id (multi-page explore can overlap)
  const seen = new Set<string>();
  const unique: PublicTaskSummary[] = [];
  for (const t of tasks) {
    const id = (t.id ?? "").toLowerCase();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    unique.push(t);
  }

  const skipped: OvernightSkipRow[] = [];
  const skipCounts: Record<string, number> = {};
  for (const task of unique) {
    const reason = codingFilterSkipReason(task, { minUsd, codingOnly: true });
    if (reason) {
      skipped.push({
        id: task.id,
        title: task.title ?? "(untitled)",
        usd: parseUsdQuick(task),
        reason,
      });
      const key = shortReasonKey(reason);
      skipCounts[key] = (skipCounts[key] ?? 0) + 1;
    }
  }

  const ranked = rankBounties(unique, {
    minUsd,
    codingOnly: true,
    skills,
  }).slice(0, top);

  const tagged = ranked.map((r) => ({
    ranked: r,
    submit: classifySubmitPath(r.task),
  }));

  const prior = await readPriorOvernightCache(priorPath);
  const currentIds = ranked.map((r) => r.task.id.toLowerCase());
  const priorIds = prior?.ids ?? [];
  const priorSet = new Set(priorIds);
  const currentSet = new Set(currentIds);
  const added = currentIds.filter((id) => !priorSet.has(id));
  const removed = priorIds.filter((id) => !currentSet.has(id));
  const unchanged = currentIds.filter((id) => priorSet.has(id)).length;
  const priorAgeLabel = prior
    ? formatAge(prior.generatedAt, nowMs)
    : null;

  const skillList =
    skills?.join(", ") ??
    "(default / env GIB_HUNT_SKILLS)";

  const lines: string[] = [
    `# Gibwork overnight coding bounty report`,
    ``,
    `Generated: ${generatedAt}`,
    `Scanned: ${unique.length} unique tasks (${pagesScanned} pages × ${pageSize})`,
    `Filter: codingOnly + anti-social/outreach, minUsd≥${minUsd}, top ${top}`,
    `Skill list: ${skillList}`,
    ``,
  ];

  if (prior) {
    lines.push(`## Cache freshness`);
    lines.push(``);
    lines.push(
      `- Prior report: \`${prior.path}\`${
        prior.generatedAt ? ` @ ${prior.generatedAt}` : ""
      }${priorAgeLabel ? ` (${priorAgeLabel})` : ""}`,
    );
    lines.push(
      `- Delta vs prior ranked set: **+${added.length}** new · **−${removed.length}** gone · **${unchanged}** unchanged`,
    );
    if (added.length) {
      lines.push(`- New IDs: ${added.map((id) => `\`${id.slice(0, 8)}\``).join(", ")}`);
    }
    if (removed.length) {
      lines.push(
        `- Gone IDs: ${removed.map((id) => `\`${id.slice(0, 8)}\``).join(", ")}`,
      );
    }
    lines.push(``);
  } else {
    lines.push(`## Cache freshness`);
    lines.push(``);
    lines.push(`- No prior report at \`${priorPath}\` (first run or cache cleared).`);
    lines.push(``);
  }

  lines.push(`## Skipped (why not ranked)`);
  lines.push(``);
  const skipSummary = Object.entries(skipCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${k}=${n}`)
    .join(", ");
  lines.push(
    skipped.length
      ? `Total skipped: **${skipped.length}** (${skipSummary || "—"})`
      : `_Nothing skipped — all scanned tasks passed coding+minUsd filters (or scan empty)._`,
  );
  lines.push(``);
  if (skipped.length) {
    lines.push(`| Reason | USD | Title | ID |`);
    lines.push(`| ------ | --- | ----- | -- |`);
    // Cap table to keep report readable; full counts above
    const show = skipped.slice(0, 40);
    for (const s of show) {
      lines.push(
        `| ${s.reason.replace(/\|/g, "/")} | $${s.usd.toFixed(0)} | ${s.title.replace(/\|/g, "/").slice(0, 60)} | \`${s.id.slice(0, 8)}\` |`,
      );
    }
    if (skipped.length > show.length) {
      lines.push(
        `| … | … | _(+${skipped.length - show.length} more omitted)_ | … |`,
      );
    }
    lines.push(``);
  }

  lines.push(`## Ranked coding bounties`);
  lines.push(``);
  lines.push(
    `Tags: **AGENT_OR_EMAIL_SUBMIT** = no Discord/Twitter/capital/wallet gate on API fields; **HUMAN_BLOCKER** = needs human (Discord/Twitter/capital/signature).`,
  );
  lines.push(``);

  if (!tagged.length) {
    lines.push(`_No matching coding bounties._`);
  } else {
    lines.push(
      `| # | USD | Score | Tag | Skill pts | Matched | Title | URL |`,
    );
    lines.push(
      `| - | --- | ----- | --- | --------- | ------- | ----- | --- |`,
    );
    tagged.forEach(({ ranked: r, submit }, i) => {
      const matched = r.breakdown.matchedSkills.join(", ") || "—";
      lines.push(
        `| ${i + 1} | $${r.usdEstimate.toFixed(0)} | ${r.score.toFixed(1)} | ${submit.tag} | ${r.breakdown.skills} | ${matched} | ${r.task.title.replace(/\|/g, "/")} | ${taskUrl(r.task.id)} |`,
      );
    });
    lines.push("");
    lines.push("## Top by reward (skill match)");
    const byReward = [...tagged].sort(
      (a, b) => b.ranked.usdEstimate - a.ranked.usdEstimate,
    );
    byReward.forEach(({ ranked: r, submit }, i) => {
      lines.push(
        `${i + 1}. $${r.usdEstimate.toFixed(0)} · ${submit.tag} · skill=${r.breakdown.skills} [${r.breakdown.matchedSkills.join(", ") || "none"}] · ${r.task.title}`,
      );
      lines.push(`   ${taskUrl(r.task.id)}`);
    });
    lines.push("");
    lines.push("## Breakdown");
    for (const [i, { ranked: r, submit }] of tagged.entries()) {
      lines.push(`### ${i + 1}. ${r.task.title}`);
      lines.push(
        `- **${submit.tag}**${
          submit.blockers.length
            ? ` — blockers: ${submit.blockers.join(", ")}`
            : " — no API-level human gates"
        }`,
      );
      lines.push(
        `- score ${r.score.toFixed(1)} · $${r.usdEstimate.toFixed(0)} · skillMatch=${r.breakdown.skills} [${r.breakdown.matchedSkills.join(", ") || "none"}] · daysLeft=${r.daysLeft?.toFixed?.(1) ?? r.daysLeft}`,
      );
      lines.push(`- ${r.reasons.join(" | ")}`);
      lines.push(`- ${taskUrl(r.task.id)}`);
      lines.push("");
    }
  }

  return {
    generatedAt,
    markdown: lines.join("\n") + "\n",
    ranked,
    tagged,
    skipped,
    skipCounts,
    prior,
    delta: {
      priorAgeLabel,
      added,
      removed,
      unchanged,
    },
  };
}
