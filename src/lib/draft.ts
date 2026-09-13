import type { RankedBounty } from "./rank.js";
import { taskUrl } from "./publicApi.js";

/** Produce a submission draft markdown a human/agent can refine before paying the 0.15 USDC fee. */
export function draftSubmission(ranked: RankedBounty, repoUrl?: string): string {
  const { task, usdEstimate, daysLeft, reasons } = ranked;
  const lines = [
    `# Submission draft — ${task.title}`,
    ``,
    `- Bounty: ${taskUrl(task.id)}`,
    `- Est. reward: $${usdEstimate.toFixed(2)} ${task.asset?.symbol ?? "USDC"}`,
    `- Days left: ${daysLeft == null ? "n/a" : daysLeft.toFixed(1)}`,
    `- Rank reasons: ${reasons.join("; ")}`,
    ``,
    `## Proposed approach`,
    ``,
    `1. Confirm requirements and acceptance criteria from the bounty description.`,
    `2. Implement the non-web deliverable (CLI / MCP / automation) against @gibwork/sdk.`,
    `3. Document setup, env vars, sample I/O in README.`,
    `4. Record a short demo video of the happy-path workflow.`,
    `5. Submit via Gibwork (wallet-authenticated; participation fee currently 0.15 USDC).`,
    ``,
    `## Links`,
    ``,
    `- Repo: ${repoUrl ?? "(add public GitHub URL)"}`,
    `- Demo video: (add URL)`,
    ``,
    `## Notes for agent operators`,
    ``,
    `- Do NOT use Phantom browser signatures in this workflow — use a local keypair file.`,
    `- Persist idempotencyKey before any paid submission.prepare/create call.`,
    `- Attend ≥2 Discord hackathon sessions before final submit when required.`,
  ];
  return lines.join("\n");
}
