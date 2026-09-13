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
import { rankBounties } from "../lib/rank.js";
import { draftSubmission } from "../lib/draft.js";

const server = new Server(
  { name: "gibwork-bounty-hunter", version: "0.1.0" },
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
        "Rank coding/dev Gibwork bounties by reward, skill match, and deadline.",
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
        score: r.score,
        usd: r.usdEstimate,
        daysLeft: r.daysLeft,
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
