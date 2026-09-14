#!/usr/bin/env node
import { Command } from "commander";
import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { exploreTasks, getTask, taskUrl } from "../lib/publicApi.js";
import { formatRankTable, rankBounties, AGENT_DEFAULT_SKILLS } from "../lib/rank.js";
import { draftSubmission } from "../lib/draft.js";
import { buildApplyPackForId } from "../lib/applyPack.js";
import { formatDoctorReport, runDoctorChecks } from "../lib/doctor.js";
import { pollNewBounties, sleep } from "../lib/watch.js";
import { buildOvernightReport } from "../lib/overnightReport.js";
import { runRailsScout } from "../lib/railsScout.js";

const program = new Command();
program
  .name("gib-hunt")
  .description(
    "Gibwork bounty hunter — discover & rank coding bounties from the terminal (SDK/CLI/MCP hackathon use case)",
  )
  .version("0.2.7");

program
  .command("explore")
  .description("List open bounties from the public Gibwork API")
  .option("-p, --page <n>", "page number", "1")
  .option("-l, --limit <n>", "page size", "25")
  .option("-s, --search <q>", "search query")
  .option("--json", "raw JSON output")
  .action(async (opts) => {
    const { results, raw } = await exploreTasks({
      page: Number(opts.page),
      limit: Number(opts.limit),
      search: opts.search,
    });
    if (opts.json) {
      console.log(JSON.stringify(raw, null, 2));
      return;
    }
    if (!results.length) {
      console.log("No tasks returned. Try --json to inspect the API payload shape.");
      return;
    }
    for (const t of results) {
      const usd =
        typeof t.asset?.price === "number"
          ? `$${t.asset.price}`
          : t.asset?.amount ?? "?";
      console.log(
        `- [${t.id.slice(0, 8)}] ${t.title} | ${usd} | ${taskUrl(t.id)}`,
      );
    }
  });

program
  .command("rank")
  .description("Rank coding-oriented bounties by reward, skills, and deadline")
  .option("-p, --page <n>", "page number", "1")
  .option("-l, --limit <n>", "page size", "15")
  .option("--min-usd <n>", "minimum USD reward", process.env.GIB_HUNT_MIN_USD ?? "20")
  .option("--skills <list>", "comma-separated skill keywords")
  .option("--top <n>", "show top N", "10")
  .option("--table", "fixed-width breakdown table")
  .option("--json", "JSON output with full score breakdown")
  .action(async (opts) => {
    const { results } = await exploreTasks({
      page: Number(opts.page),
      limit: Number(opts.limit),
    });
    const skills = opts.skills
      ? String(opts.skills).split(",").map((s: string) => s.trim())
      : undefined;
    const ranked = rankBounties(results, {
      skills,
      minUsd: Number(opts.minUsd),
    }).slice(0, Number(opts.top));
    if (opts.json) {
      const payload = ranked.map((r) => ({
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
        tags: r.task.tags,
      }));
      console.log(JSON.stringify(payload, null, 2));
      return;
    }
    if (!ranked.length) {
      console.log("No matching coding bounties on this page.");
      return;
    }
    if (opts.table) {
      console.log(formatRankTable(ranked));
      console.log("");
      console.log("Legend: REW=reward SKL=skills DLN=deadline TAG=dev-tag");
      return;
    }
    for (const [i, r] of ranked.entries()) {
      const b = r.breakdown;
      console.log(
        `${i + 1}. score=${r.score.toFixed(1)} $${r.usdEstimate.toFixed(0)} — ${r.task.title}`,
      );
      console.log(`   ${taskUrl(r.task.id)}`);
      console.log(
        `   breakdown: reward=${b.reward.toFixed(1)} skills=${b.skills} deadline=${b.deadline} tags=${b.tags}` +
          (b.matchedSkills.length
            ? ` matched=[${b.matchedSkills.join(",")}]`
            : ""),
      );
      console.log(`   ${r.reasons.join(" | ")}`);
    }
  });

program
  .command("show")
  .description("Fetch one bounty by ID")
  .argument("<taskId>", "Gibwork task UUID")
  .option("--json", "JSON output")
  .action(async (taskId: string, opts) => {
    const task = await getTask(taskId);
    if (opts.json) {
      console.log(JSON.stringify(task, null, 2));
      return;
    }
    console.log(task.title);
    console.log(taskUrl(task.id));
    console.log(`open=${task.isOpen} deadline=${task.deadline ?? "n/a"}`);
    console.log(`tags=${(task.tags ?? []).join(", ")}`);
  });

program
  .command("draft")
  .description("Write a submission draft markdown for a ranked bounty ID")
  .argument("<taskId>", "Gibwork task UUID")
  .option("--repo <url>", "public GitHub repo URL")
  .option("-o, --out <path>", "output file", "submission-draft.md")
  .action(async (taskId: string, opts) => {
    const task = await getTask(taskId);
    const ranked = rankBounties([task], { minUsd: 0, codingOnly: false })[0];
    if (!ranked) {
      console.error("Could not build rank context for task");
      process.exit(1);
    }
    const md = draftSubmission(ranked, opts.repo);
    await writeFile(opts.out, md, "utf8");
    console.log(`Wrote ${opts.out}`);
  });

async function runApplyPack(
  taskId: string,
  opts: { repo?: string; out?: string; stdout?: boolean; skills?: string },
): Promise<void> {
  const skills = opts.skills
    ? String(opts.skills).split(",").map((s: string) => s.trim()).filter(Boolean)
    : [...AGENT_DEFAULT_SKILLS];
  const { task, markdown } = await buildApplyPackForId(taskId, {
    repoUrl: opts.repo,
    skills,
  });
  if (opts.stdout || !opts.out) {
    process.stdout.write(markdown);
  }
  if (opts.out) {
    await writeFile(opts.out, markdown, "utf8");
    console.error(`Wrote ${opts.out} for ${task.id}`);
  } else if (!opts.stdout) {
    // default: stdout only when no -o
  }
}

const applyPackOpts = (cmd: Command) =>
  cmd
    .argument("<taskIdOrSlug>", "Gibwork task UUID or slug")
    .option("--repo <url>", "public GitHub repo URL")
    .option(
      "--skills <list>",
      "comma-separated skills for match score",
      AGENT_DEFAULT_SKILLS.join(","),
    )
    .option("-o, --out <path>", "write markdown to file (also prints if --stdout)")
    .option("--stdout", "force print markdown to stdout");

applyPackOpts(
  program
    .command("apply-pack")
    .description(
      "Emit a markdown apply/submission pack (title, reward, skills, deadline, outline, checklist)",
    ),
).action(async (taskId: string, opts) => runApplyPack(taskId, opts));

applyPackOpts(
  program
    .command("submission-pack")
    .description("Alias for apply-pack — markdown pack for human/agent submit"),
).action(async (taskId: string, opts) => runApplyPack(taskId, opts));

program
  .command("doctor")
  .description("Check Node version, SDK package, public API reachability, optional wallet")
  .option("--json", "JSON output")
  .action(async (opts) => {
    const checks = await runDoctorChecks();
    if (opts.json) {
      console.log(JSON.stringify(checks, null, 2));
    } else {
      console.log(formatDoctorReport(checks));
    }
    if (checks.some((c) => c.status === "fail")) process.exitCode = 1;
  });

type WatchOpts = {
  minUsd: string;
  interval: string;
  pages: string;
  search?: string;
  seed?: boolean;
  json?: boolean;
  cache?: string;
};

async function runWatch(opts: WatchOpts): Promise<void> {
  const intervalSec = Number(opts.interval);
  const once = !Number.isFinite(intervalSec) || intervalSec <= 0;

  const runOnce = async () => {
    const result = await pollNewBounties({
      minUsd: Number(opts.minUsd),
      pages: Number(opts.pages),
      search: opts.search,
      seedOnly: Boolean(opts.seed),
      cachePath: opts.cache,
    });
    if (opts.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    if (opts.seed) {
      console.log(
        `Seeded cache with ${result.seenCount} seen ids (scanned ${result.scanned}).`,
      );
      console.log(`Cache: ${result.cachePath}`);
      return;
    }
    if (!result.newHits.length) {
      console.log(
        `No new bounties ≥$${opts.minUsd} (scanned ${result.scanned}, seen ${result.seenCount}).`,
      );
      return;
    }
    console.log(`New bounties (${result.newHits.length}) ≥$${opts.minUsd}:`);
    for (const h of result.newHits) {
      console.log(`- $${h.usd.toFixed(0)} — ${h.title}`);
      console.log(`  ${h.url}`);
    }
    console.log(`Cache: ${result.cachePath} (${result.seenCount} seen)`);
  };

  if (once) {
    await runOnce();
    return;
  }

  console.log(
    `Watching every ${intervalSec}s for new bounties ≥$${opts.minUsd} (Ctrl+C to stop)…`,
  );
  // Seed first so the initial page isn't all "new"
  await pollNewBounties({
    minUsd: Number(opts.minUsd),
    pages: Number(opts.pages),
    search: opts.search,
    seedOnly: true,
    cachePath: opts.cache,
  });
  for (;;) {
    await runOnce();
    await sleep(intervalSec * 1000);
  }
}

const watchOpts = (cmd: Command) =>
  cmd
    .option("--min-usd <n>", "minimum USD reward", process.env.GIB_HUNT_MIN_USD ?? "20")
    .option("--interval <sec>", "poll interval seconds (0 = once)", "0")
    .option("--pages <n>", "explore pages per poll", "2")
    .option("-s, --search <q>", "search query")
    .option("--seed", "seed seen-cache with current listings (no alerts)")
    .option("--json", "JSON output")
    .option("--cache <path>", "override seen-cache path");

watchOpts(
  program
    .command("watch")
    .description(
      "Poll open bounties and print newly appearing ones above min USD (seen cache under .cache/)",
    ),
).action(async (opts: WatchOpts) => runWatch(opts));

watchOpts(
  program
    .command("alert")
    .description("Alias for watch — one-shot or interval poll for new high-value bounties"),
).action(async (opts: WatchOpts) => runWatch(opts));

program
  .command("hackathon")
  .description("Print IdleDev path notes for the Developer Hackathon bounty")
  .action(async () => {
    await mkdir("docs", { recursive: true });
    console.log(`Bounty: https://gib.work/bounty/1052f22d-3f87-4b1d-b0d7-71a60679e7fa`);
    console.log(`Deadline: 2026-10-30 (1000 USDC escrowed)`);
    console.log(`Discord (bounty page): https://discord.gg/2577tTsRt`);
    console.log(`Discord (form): https://discord.gg/jJa6tffXj`);
    console.log(`Required: Google Form → Hackathon Discord role → attend ≥2 sessions`);
    console.log(`Deliverables: public GitHub + README + demo video + screenshots`);
  });


program
  .command("overnight-report")
  .description(
    "Write coding bounty overnight report (≥ min USD) with skip reasons, submit tags, and cache delta",
  )
  .option("--min-usd <n>", "minimum USD", process.env.GIB_HUNT_MIN_USD ?? "20")
  .option("--pages <n>", "explore pages to scan", "3")
  .option("--limit <n>", "page size", "25")
  .option("--top <n>", "top N to include", "15")
  .option(
    "--skills <list>",
    "comma-separated skills for match score",
    AGENT_DEFAULT_SKILLS.join(","),
  )
  .option("-o, --out <path>", "primary output markdown path", "docs/overnight-bounty-report.md")
  .option(
    "--cache-out <path>",
    "also write cache copy",
    ".cache/overnight-report.md",
  )
  .option("--json", "also print JSON to stdout")
  .action(async (opts) => {
    const pages = Number(opts.pages);
    const limit = Number(opts.limit);
    const skills = String(opts.skills)
      .split(",")
      .map((s: string) => s.trim())
      .filter(Boolean);
    const all: Awaited<ReturnType<typeof exploreTasks>>["results"] = [];
    let pagesScanned = 0;
    for (let page = 1; page <= pages; page++) {
      try {
        const { results } = await exploreTasks({ page, limit });
        all.push(...results);
        pagesScanned = page;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`explore page ${page} skipped: ${msg}`);
        break;
      }
    }
    const report = await buildOvernightReport(all, {
      minUsd: Number(opts.minUsd),
      top: Number(opts.top),
      skills,
      pagesScanned,
      pageSize: limit,
      priorCachePath: String(opts.cacheOut),
    });
    await mkdir("docs", { recursive: true });
    await writeFile(opts.out, report.markdown, "utf8");
    const cachePath = String(opts.cacheOut);
    await mkdir(".cache", { recursive: true });
    await writeFile(cachePath, report.markdown, "utf8");
    console.log(
      `Wrote ${opts.out} and ${cachePath} (${report.ranked.length} bounties, ${report.skipped.length} skipped)`,
    );
    if (opts.json) {
      console.log(
        JSON.stringify(
          {
            generatedAt: report.generatedAt,
            skipCounts: report.skipCounts,
            delta: report.delta,
            ranked: report.tagged.map(({ ranked: r, submit }) => ({
              score: r.score,
              usd: r.usdEstimate,
              tag: submit.tag,
              blockers: submit.blockers,
              skillMatch: r.breakdown.skills,
              matchedSkills: r.breakdown.matchedSkills,
              id: r.task.id,
              title: r.task.title,
              url: taskUrl(r.task.id),
            })),
          },
          null,
          2,
        ),
      );
    }
  });



program
  .command("rails-scout")
  .alias("earn-scout")
  .description(
    "Scout Superteam Earn + Frantic + DeskCrew for ≥minUsd agent/coding paths (standing skips applied)",
  )
  .option("--min-usd <n>", "minimum USD", process.env.GIB_HUNT_MIN_USD ?? "20")
  .option("--include-skipped", "do not apply IdleDev standing skip hints")
  .option("-o, --out <path>", "write markdown report")
  .option("--json", "print JSON to stdout (default: markdown)")
  .action(async (opts) => {
    const report = await runRailsScout({
      minUsd: Number(opts.minUsd),
      includeSkipped: Boolean(opts.includeSkipped),
    });
    if (opts.out) {
      await mkdir(dirname(opts.out) || ".", { recursive: true });
      await writeFile(opts.out, report.markdown, "utf8");
      console.error(`Wrote ${opts.out}`);
    }
    if (opts.json) {
      const { markdown: _md, ...rest } = report;
      console.log(JSON.stringify(rest, null, 2));
    } else {
      process.stdout.write(report.markdown);
    }
    if (report.summary.nothingNew) process.exitCode = 2;
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
