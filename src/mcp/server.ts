#!/usr/bin/env node
/**
 * MCP server: expose Gibwork bounty discovery/ranking as tools for AI agents.
 * Non-web use case for the Gibwork Developer Hackathon.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { exploreTasks, getTask, taskUrl } from "../lib/publicApi.js";
import { rankBounties, AGENT_DEFAULT_SKILLS } from "../lib/rank.js";
import { draftSubmission } from "../lib/draft.js";
import { buildApplyPackForId } from "../lib/applyPack.js";
import { runDoctorChecks } from "../lib/doctor.js";
import { pollNewBounties } from "../lib/watch.js";
import { writeFile, mkdir } from "node:fs/promises";

const server = new Server(
  { name: "gibwork-bounty-hunter", version: "0.2.2" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "gib_explore_bounties",
      description: "List open Gibwork bounties (public API).",
      inputSchema: {
        type: "object",
        properties: {
          page: { type: "number" },
          limit: { type: "number" },
          search: { type: "string" },
        },
      },
    },
    {
      name: "gib_rank_coding_bounties",
      description:
        "Rank coding/dev Gibwork bounties by reward, skill match, and deadline. Returns score breakdown.",
      inputSchema: {
        type: "object",
        properties: {
          page: { type: "number" },
          limit: { type: "number" },
          minUsd: { type: "number" },
          skills: {
            type: "array",
            items: { type: "string" },
          },
          top: { type: "number" },
        },
      },
    },
    {
      name: "gib_get_bounty",
      description: "Fetch a single Gibwork bounty by UUID.",
      inputSchema: {
        type: "object",
        properties: { taskId: { type: "string" } },
        required: ["taskId"],
      },
    },
    {
      name: "gib_draft_submission",
      description:
        "Generate a markdown submission draft for a bounty (no on-chain payment).",
      inputSchema: {
        type: "object",
        properties: {
          taskId: { type: "string" },
          repoUrl: { type: "string" },
        },
        required: ["taskId"],
      },
    },
    {
      name: "gib_watch_new_bounties",
      description:
        "One-shot poll for newly appearing bounties above minUsd. Uses a file-based seen cache (.cache/). Pass seedOnly=true to populate cache without alerts.",
      inputSchema: {
        type: "object",
        properties: {
          minUsd: { type: "number" },
          pages: { type: "number" },
          search: { type: "string" },
          seedOnly: { type: "boolean" },
          cachePath: { type: "string" },
        },
      },
    },
    {
      name: "gib_doctor",
      description:
        "Run environment checks: Node version, @gibwork/sdk presence, public API reachability, optional wallet SDK.",
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
    {
      name: "gib_apply_pack",
      description:
        "Build a markdown apply/submission pack for a bounty (title, reward, skills, deadline, outline, checklist). Accepts UUID or slug.",
      inputSchema: {
        type: "object",
        properties: {
          taskIdOrSlug: { type: "string" },
          repoUrl: { type: "string" },
          skills: { type: "array", items: { type: "string" } },
        },
        required: ["taskIdOrSlug"],
      },
    },
    {
      name: "gib_overnight_report",
      description:
        "Scan explore pages and write/return an overnight coding bounty report with skill-match scores vs default agent skills. Also writes .cache/overnight-report.md when writeCache is true.",
      inputSchema: {
        type: "object",
        properties: {
          minUsd: { type: "number" },
          pages: { type: "number" },
          limit: { type: "number" },
          top: { type: "number" },
          skills: { type: "array", items: { type: "string" } },
          writeCache: { type: "boolean" },
        },
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const name = req.params.name;
  const args = (req.params.arguments ?? {}) as Record<string, unknown>;

  try {
    if (name === "gib_explore_bounties") {
      const { results } = await exploreTasks({
        page: Number(args.page ?? 1),
        limit: Number(args.limit ?? 15),
        search: args.search ? String(args.search) : undefined,
      });
      const slim = results.map((t) => ({
        id: t.id,
        title: t.title,
        url: taskUrl(t.id),
        usd: t.asset?.price,
        deadline: t.deadline,
        tags: t.tags,
      }));
      return {
        content: [{ type: "text", text: JSON.stringify(slim, null, 2) }],
      };
    }

    if (name === "gib_rank_coding_bounties") {
      const { results } = await exploreTasks({
        page: Number(args.page ?? 1),
        limit: Number(args.limit ?? 15),
      });
      const ranked = rankBounties(results, {
        minUsd: args.minUsd != null ? Number(args.minUsd) : undefined,
        skills: Array.isArray(args.skills)
          ? (args.skills as string[])
          : undefined,
      }).slice(0, Number(args.top ?? 10));
      const slim = ranked.map((r) => ({
        score: Number(r.score.toFixed(2)),
        usd: r.usdEstimate,
        daysLeft: r.daysLeft,
        breakdown: {
          reward: Number(r.breakdown.reward.toFixed(2)),
          skills: r.breakdown.skills,
          deadline: r.breakdown.deadline,
          tags: r.breakdown.tags,
          matchedSkills: r.breakdown.matchedSkills,
        },
        reasons: r.reasons,
        id: r.task.id,
        title: r.task.title,
        url: taskUrl(r.task.id),
      }));
      return {
        content: [{ type: "text", text: JSON.stringify(slim, null, 2) }],
      };
    }

    if (name === "gib_get_bounty") {
      const task = await getTask(String(args.taskId));
      return {
        content: [{ type: "text", text: JSON.stringify(task, null, 2) }],
      };
    }

    if (name === "gib_draft_submission") {
      const task = await getTask(String(args.taskId));
      const ranked = rankBounties([task], { minUsd: 0, codingOnly: false })[0];
      const md = draftSubmission(
        ranked,
        args.repoUrl ? String(args.repoUrl) : undefined,
      );
      return { content: [{ type: "text", text: md }] };
    }

    if (name === "gib_watch_new_bounties") {
      const result = await pollNewBounties({
        minUsd: args.minUsd != null ? Number(args.minUsd) : undefined,
        pages: args.pages != null ? Number(args.pages) : undefined,
        search: args.search ? String(args.search) : undefined,
        seedOnly: Boolean(args.seedOnly),
        cachePath: args.cachePath ? String(args.cachePath) : undefined,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    if (name === "gib_doctor") {
      const checks = await runDoctorChecks();
      return {
        content: [{ type: "text", text: JSON.stringify(checks, null, 2) }],
      };
    }

    if (name === "gib_apply_pack") {
      const skills = Array.isArray(args.skills)
        ? (args.skills as string[])
        : [...AGENT_DEFAULT_SKILLS];
      const { markdown } = await buildApplyPackForId(String(args.taskIdOrSlug), {
        repoUrl: args.repoUrl ? String(args.repoUrl) : undefined,
        skills,
      });
      return { content: [{ type: "text", text: markdown }] };
    }

    if (name === "gib_overnight_report") {
      const pages = Number(args.pages ?? 3);
      const limit = Number(args.limit ?? 15);
      const top = Number(args.top ?? 15);
      const minUsd = args.minUsd != null ? Number(args.minUsd) : 20;
      const skills = Array.isArray(args.skills)
        ? (args.skills as string[])
        : [...AGENT_DEFAULT_SKILLS];
      const all: Awaited<ReturnType<typeof exploreTasks>>["results"] = [];
      for (let page = 1; page <= pages; page++) {
        try {
          const { results } = await exploreTasks({ page, limit });
          all.push(...results);
        } catch {
          break;
        }
      }
      const ranked = rankBounties(all, {
        minUsd,
        codingOnly: true,
        skills,
      }).slice(0, top);
      const slim = ranked.map((r) => ({
        score: Number(r.score.toFixed(2)),
        usd: r.usdEstimate,
        skillMatch: r.breakdown.skills,
        matchedSkills: r.breakdown.matchedSkills,
        id: r.task.id,
        title: r.task.title,
        url: taskUrl(r.task.id),
      }));
      if (args.writeCache !== false) {
        const lines = [
          `# Gibwork overnight coding bounty report`,
          ``,
          `Generated: ${new Date().toISOString()}`,
          `Skill list: ${skills.join(", ")}`,
          ``,
          `| # | USD | Score | Skill pts | Matched | Title | URL |`,
          `| - | --- | ----- | --------- | ------- | ----- | --- |`,
          ...ranked.map(
            (r, i) =>
              `| ${i + 1} | $${r.usdEstimate.toFixed(0)} | ${r.score.toFixed(1)} | ${r.breakdown.skills} | ${r.breakdown.matchedSkills.join(", ") || "—"} | ${r.task.title.replace(/\|/g, "/")} | ${taskUrl(r.task.id)} |`,
          ),
          ``,
        ];
        await mkdir(".cache", { recursive: true });
        await writeFile(
          ".cache/overnight-report.md",
          lines.join("\n") + "\n",
          "utf8",
        );
      }
      return {
        content: [{ type: "text", text: JSON.stringify(slim, null, 2) }],
      };
    }

    return {
      content: [{ type: "text", text: `Unknown tool: ${name}` }],
      isError: true,
    };
  } catch (err) {
    return {
      content: [
        {
          type: "text",
          text: err instanceof Error ? err.message : String(err),
        },
      ],
      isError: true,
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
