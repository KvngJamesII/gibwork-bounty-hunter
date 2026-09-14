# IdleDev status — Gibwork Developer Hackathon (2026-09-13)

| Item | Status |
| --- | --- |
| Google Form | **Submitted** — page confirmation: "Your response has been recorded." Fields used onlyidledev@gmail.com, https://github.com/KvngJamesII, Discord **IdleDev**, building product Yes, tools Claude/Cursor/Grok, langs TS/Python/Rust |
| Repo | **https://github.com/KvngJamesII/gibwork-bounty-hunter** (public) |
| Local path | `/workspace/crypto-guru/gibwork-hackathon` |
| Smoke test | `gib-hunt explore/rank/show/draft/watch/doctor` against live public API |
| Discord join / Hackathon role | **Blocked (human)** — see `docs/DISCORD_AND_SESSIONS.md` |
| Attend ≥2 sessions | **Blocked (human)** — schedule only inside Discord after join |
| Demo video | Pending |
| Final gib.work submission | Pending (after role + sessions + video) |

## Overnight deepen (v0.2.0)

Shipped without Phantom / approvals:

1. **`watch` / `alert`** — polls explore pages; prints newly appearing bounties ≥ min USD; file-based seen cache under `.cache/gib-hunt-seen.json` (`--seed` to warm cache).
2. **Rank breakdown** — human lines + `--table` + `--json` with `{reward,skills,deadline,tags,matchedSkills}`.
3. **Hardened `doctor`** — Node ≥22, `@gibwork/sdk` resolve, public explore + task detail latency, optional wallet SDK (warn if absent).
4. **MCP parity** — `gib_watch_new_bounties`, `gib_doctor`; rank tool returns breakdown.
5. **Samples** — `samples/mcp.cursor.json`, `mcp.claude-desktop.json`, `mcp.dev.json`; README MCP install section.

**Do not** revive T3N. **No** Phantom signatures. Skip social/referral gib spam under $20.

## Overnight deepen (v0.2.1)

- Added `overnight-report` — markdown snapshot of top coding bounties (graceful stop when explore pagination requires auth).

## Overnight deepen (v0.2.2)

Shipped without Phantom / Discord / approvals:

1. **`apply-pack` / `submission-pack`** — markdown pack for a task id/slug: title, reward, skills, deadline, draft outline, submission checklist (stdout or `-o` file).
2. **`overnight-report`** — also writes `.cache/overnight-report.md`; ranks with skill match vs default list `typescript,solana,react,rust,python` (overridable via `--skills`); table includes skill pts + matched skills; top-by-reward section.
3. **MCP parity** — `gib_apply_pack`, `gib_overnight_report` (optional cache write).
4. Version bump **0.2.2**; README CLI/MCP tables updated.

**Still human-blocked:** Discord role + ≥2 sessions + demo video + final gib.work submit.

## Overnight deepen (v0.2.3)

Shipped without Phantom / Discord / approvals:

1. **Rank anti-spam** — `codingOnly` now drops Social Media / Twitter / outreach / "share your" / deal-close spam that was polluting overnight reports.
2. **Skill word-boundary match** — `rust` no longer matches inside `trust` (false skill pts).
3. **Apply-pack blockers** — surfaces Twitter gate + Discord guild requirement from task API fields.
4. Version bump **0.2.3**.

**Still human-blocked:** Discord role + ≥2 sessions + demo video + final gib.work submit.


## Overnight deepen (v0.2.4)

Shipped without Phantom / Discord / approvals:

1. **`overnightReport` module** — skip reasons (`closed` / `below_min_usd` / `not_coding` / `social_outreach` / `expired`), **AGENT_OR_EMAIL_SUBMIT** vs **HUMAN_BLOCKER** tags, prior-cache freshness + id delta.
2. **CLI + MCP** `overnight-report` / `gib_overnight_report` use the shared builder.
3. Version bump **0.2.4**.

**Still human-blocked:** Discord role + ≥2 sessions + demo video + final gib.work submit.
