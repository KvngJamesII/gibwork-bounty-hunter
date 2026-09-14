import type { PublicTaskSummary } from "./publicApi.js";

/** Per-component score contribution for transparent ranking. */
export interface ScoreBreakdown {
  reward: number;
  skills: number;
  deadline: number;
  tags: number;
  matchedSkills: string[];
}

export interface RankedBounty {
  task: PublicTaskSummary;
  score: number;
  reasons: string[];
  usdEstimate: number;
  daysLeft: number | null;
  breakdown: ScoreBreakdown;
}

function parseUsd(task: PublicTaskSummary): number {
  if (typeof task.asset?.price === "number") return task.asset.price;
  const amount = Number(task.asset?.amount ?? 0);
  const decimals = Number(task.asset?.decimals ?? 6);
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  return amount / 10 ** decimals;
}

function daysUntil(deadline?: string | null): number | null {
  if (!deadline) return null;
  const ms = Date.parse(deadline) - Date.now();
  if (!Number.isFinite(ms)) return null;
  return ms / (1000 * 60 * 60 * 24);
}

export function rankBounties(
  tasks: PublicTaskSummary[],
  opts: { skills?: string[]; minUsd?: number; codingOnly?: boolean } = {},
): RankedBounty[] {
  const skills = (opts.skills ?? defaultSkills()).map((s) => s.toLowerCase());
  const minUsd = opts.minUsd ?? 20;
  const codingOnly = opts.codingOnly ?? true;

  const ranked: RankedBounty[] = [];
  for (const task of tasks) {
    if (task.isOpen === false) continue;
    const usd = parseUsd(task);
    if (usd < minUsd) continue;

    const hay = [
      task.title ?? "",
      task.primarySkill?.label ?? "",
      task.primarySkill?.slug ?? "",
      ...(task.tags ?? []),
      stripHtml(task.content ?? "").slice(0, 500),
    ]
      .join(" ")
      .toLowerCase();

    if (codingOnly && !looksLikeCoding(hay)) continue;
    if (codingOnly && isSocialOrOutreachSpam(task, hay)) continue;

    const reasons: string[] = [];
    const breakdown: ScoreBreakdown = {
      reward: 0,
      skills: 0,
      deadline: 0,
      tags: 0,
      matchedSkills: [],
    };

    // Reward weight (log scale, cap 40)
    breakdown.reward = Math.min(40, Math.log10(usd + 1) * 18);
    reasons.push(`reward~$${usd.toFixed(0)}(+${breakdown.reward.toFixed(1)})`);

    // Skill match
    const matched = skills.filter((s) => skillTokenMatch(hay, s));
    breakdown.matchedSkills = matched;
    breakdown.skills = matched.length * 12;
    if (matched.length) {
      reasons.push(`skills:${matched.join(",")}(+${breakdown.skills})`);
    }

    // Deadline urgency (prefer 3–21 days left)
    const days = daysUntil(task.deadline);
    if (days != null) {
      if (days < 0) continue;
      if (days <= 21) {
        breakdown.deadline = 10;
        reasons.push(`deadline:${days.toFixed(1)}d(+10)`);
      } else if (days <= 45) {
        breakdown.deadline = 5;
        reasons.push(`deadline:${days.toFixed(1)}d(+5)`);
      } else if (days > 60) {
        breakdown.deadline = -5;
        reasons.push(`deadline:${days.toFixed(1)}d(-5)`);
      } else {
        reasons.push(`deadline:${days.toFixed(1)}d(+0)`);
      }
    }

    // Prefer Development-tagged / general coding
    if ((task.tags ?? []).some((t) => /dev|code|typescript|rust|solana/i.test(t))) {
      breakdown.tags = 8;
      reasons.push("dev-tag(+8)");
    }

    const score =
      breakdown.reward + breakdown.skills + breakdown.deadline + breakdown.tags;

    ranked.push({
      task,
      score,
      reasons,
      usdEstimate: usd,
      daysLeft: days,
      breakdown,
    });
  }

  return ranked.sort((a, b) => b.score - a.score);
}

/** Format a human-readable score table (fixed-width columns). */
export function formatRankTable(ranked: RankedBounty[]): string {
  if (!ranked.length) return "(no matches)";
  const header =
    " #  SCORE  USD    DAYS  REW  SKL  DLN  TAG  TITLE";
  const sep = "-".repeat(Math.min(100, header.length + 40));
  const rows = ranked.map((r, i) => {
    const days =
      r.daysLeft == null ? "  n/a" : r.daysLeft.toFixed(0).padStart(5);
    const title = (r.task.title ?? "").slice(0, 48);
    return [
      String(i + 1).padStart(2),
      r.score.toFixed(1).padStart(6),
      ("$" + r.usdEstimate.toFixed(0)).padStart(6),
      days,
      r.breakdown.reward.toFixed(0).padStart(4),
      r.breakdown.skills.toFixed(0).padStart(4),
      r.breakdown.deadline.toFixed(0).padStart(4),
      r.breakdown.tags.toFixed(0).padStart(4),
      " " + title,
    ].join(" ");
  });
  return [header, sep, ...rows].join("\n");
}

/** Default skill list for agent overnight scoring (typescript/solana/react/rust/python). */
export const AGENT_DEFAULT_SKILLS = [
  "typescript",
  "solana",
  "react",
  "rust",
  "python",
] as const;

export function defaultSkills(): string[] {
  const env = process.env.GIB_HUNT_SKILLS;
  if (env) return env.split(",").map((s) => s.trim()).filter(Boolean);
  return [
    "development",
    ...AGENT_DEFAULT_SKILLS,
    "cli",
    "mcp",
    "sdk",
  ];
}

function looksLikeCoding(hay: string): boolean {
  return /\b(develop(?:ment|er)?|coding|typescript|javascript|rust|python|sdk|cli|mcp|api|solana|github|repo|backend|automat(?:e|ion)?)\b/i.test(
    hay,
  );
}

/** Social / sales / Discord-outreach spam that falsely matches coding filters. */
export function isSocialOrOutreachSpam(
  task: PublicTaskSummary,
  hay?: string,
): boolean {
  const tags = (task.tags ?? []).map((t) => t.toLowerCase());
  if (tags.some((t) => /social|twitter|content|marketing|outreach|influencer/.test(t))) {
    return true;
  }
  const h =
    hay ??
    [
      task.title ?? "",
      task.primarySkill?.label ?? "",
      ...(task.tags ?? []),
      stripHtml(task.content ?? "").slice(0, 800),
    ]
      .join(" ")
      .toLowerCase();
  if (
    /\b(share (?:your|how)|x post|tweet|follow us on x|discord (?:server|join)|close a deal|outreach agent|pick one theme|video reaction)\b/i.test(
      h,
    )
  ) {
    return true;
  }
  // Twitter-gated gib tasks
  if (task.isTwitterTask) return true;
  return false;
}

function skillTokenMatch(hay: string, skill: string): boolean {
  const s = skill.trim().toLowerCase();
  if (!s) return false;
  // Word-boundary match so "rust" does not hit "trust" / "frustration".
  const escaped = s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`, "i").test(hay);
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}
