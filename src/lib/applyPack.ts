import type { PublicTaskSummary } from "./publicApi.js";
import { exploreTasks, getTask, taskUrl } from "./publicApi.js";
import { rankBounties, AGENT_DEFAULT_SKILLS, type RankedBounty } from "./rank.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function parseUsd(task: PublicTaskSummary): number {
  if (typeof task.asset?.price === "number") return task.asset.price;
  const amount = Number(task.asset?.amount ?? 0);
  const decimals = Number(task.asset?.decimals ?? 6);
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  return amount / 10 ** decimals;
}

/** Resolve a task UUID or slug via detail API / explore search. */
export async function resolveTask(idOrSlug: string): Promise<PublicTaskSummary> {
  const key = idOrSlug.trim();
  if (UUID_RE.test(key)) {
    return getTask(key);
  }

  // Try detail endpoint in case API accepts slugs
  try {
    return await getTask(key);
  } catch {
    /* fall through to explore */
  }

  const needle = key.toLowerCase();
  for (let page = 1; page <= 5; page++) {
    const { results } = await exploreTasks({
      page,
      limit: 15,
      search: key,
    });
    const hit =
      results.find((t) => (t.slug ?? "").toLowerCase() === needle) ??
      results.find((t) => t.id.toLowerCase() === needle) ??
      results.find((t) => t.id.toLowerCase().startsWith(needle)) ??
      results.find((t) => (t.title ?? "").toLowerCase().includes(needle));
    if (hit) {
      try {
        return await getTask(hit.id);
      } catch {
        return hit;
      }
    }
    if (!results.length) break;
  }

  throw new Error(`Could not resolve task id/slug: ${idOrSlug}`);
}

export interface ApplyPackOptions {
  repoUrl?: string;
  skills?: string[];
}

/** Build a markdown apply/submission pack for human or agent submit. */
export function buildApplyPack(
  task: PublicTaskSummary,
  opts: ApplyPackOptions = {},
): string {
  const skills = opts.skills ?? [...AGENT_DEFAULT_SKILLS];
  const ranked: RankedBounty | undefined = rankBounties([task], {
    skills,
    minUsd: 0,
    codingOnly: false,
  })[0];

  const usd = ranked?.usdEstimate ?? parseUsd(task);
  const daysLeft = ranked?.daysLeft;
  const matched = ranked?.breakdown.matchedSkills ?? [];
  const skillScore = ranked?.breakdown.skills ?? 0;
  const tags = task.tags ?? [];
  const primary =
    task.primarySkill?.label ?? task.primarySkill?.slug ?? "(none)";
  const excerpt = stripHtml(task.content ?? "").slice(0, 600);
  const deadline = task.deadline
    ? new Date(task.deadline).toISOString()
    : "n/a";

  const lines = [
    `# Apply pack — ${task.title}`,
    ``,
    `Generated: ${new Date().toISOString()}`,
    ``,
    `## Summary`,
    ``,
    `| Field | Value |`,
    `| --- | --- |`,
    `| Title | ${task.title.replace(/\|/g, "/")} |`,
    `| Reward | $${usd.toFixed(2)} ${task.asset?.symbol ?? "USDC"} |`,
    `| Deadline | ${deadline} |`,
    `| Days left | ${daysLeft == null ? "n/a" : daysLeft.toFixed(1)} |`,
    `| Open | ${task.isOpen !== false ? "yes" : "no"} |`,
    `| Primary skill | ${primary} |`,
    `| Tags | ${tags.length ? tags.join(", ") : "(none)"} |`,
    `| Skill match | ${skillScore} pts · matched=[${matched.join(", ") || "none"}] vs [${skills.join(", ")}] |`,
    `| URL | ${taskUrl(task.id)} |`,
    `| ID | \`${task.id}\` |`,
    task.slug ? `| Slug | \`${task.slug}\` |` : null,
    ``,
    `## Description excerpt`,
    ``,
    excerpt || "_No description available._",
    ``,
    `## Draft outline`,
    ``,
    `1. Re-read acceptance criteria on the bounty page; note must-haves vs nice-to-haves.`,
    `2. Scaffold or reuse a non-web deliverable (CLI / MCP / SDK script) that proves the ask.`,
    `3. Implement against live Gibwork public API or \`@gibwork/sdk\` as required.`,
    `4. Add README: install, env, sample commands, screenshots/CLI output.`,
    `5. Record a short demo (terminal or MCP tool calls) — no Phantom required for draft.`,
    `6. Human: pay participation fee + submit on gib.work when ready.`,
    ``,
    `## Submission checklist`,
    ``,
    `- [ ] Requirements confirmed from bounty description`,
    `- [ ] Public GitHub repo: ${opts.repoUrl ?? "(add URL)"}`,
    `- [ ] README with setup + sample I/O`,
    `- [ ] Demo video / GIF of happy path`,
    `- [ ] Screenshots of CLI or MCP tools`,
    `- [ ] Skills tagged correctly on submission`,
    `- [ ] Deadline still open (${deadline})`,
    `- [ ] Wallet ready for 0.15 USDC fee (human step — no Phantom in agent flow)`,
    `- [ ] Idempotency key persisted before any paid \`submissions.create\``,
    ``,
    `## Rank reasons`,
    ``,
    ranked?.reasons.length
      ? ranked.reasons.map((r) => `- ${r}`).join("\n")
      : "- (no rank context)",
    ``,
    `## Agent blockers`,
    ``,
    task.isTwitterTask ? `- **Twitter-gated** — skip for autonomous overnight grind.` : `- Not Twitter-gated.`,
    task.allowOnlyDiscordGuildSubmissions
      ? `- **Discord guild required**${task.requiredDiscordGuildName ? ` (${task.requiredDiscordGuildName})` : ""} — human join/role.`
      : `- No Discord guild gate on API fields.`,
    /social|twitter|content|marketing|outreach/i.test(tags.join(" "))
      ? `- **Social/outreach tags** — skip under standing order (no gib social spam).`
      : null,
    ``,
    `## Notes for agents`,
    ``,
    `- This pack is draft-only; it does not pay or submit.`,
    `- Prefer local keypair over browser wallets if wiring paid submit later.`,
    `- Skip Discord/social spam; human owns attendance when required.`,
  ].filter((line) => line !== null) as string[];

  return lines.join("\n") + "\n";
}

export async function buildApplyPackForId(
  idOrSlug: string,
  opts: ApplyPackOptions = {},
): Promise<{ task: PublicTaskSummary; markdown: string }> {
  const task = await resolveTask(idOrSlug);
  return { task, markdown: buildApplyPack(task, opts) };
}
