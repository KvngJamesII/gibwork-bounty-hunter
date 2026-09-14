# gibwork-bounty-hunter

**Non-web Gibwork use case** for the [Gibwork Developer Hackathon Bounty](https://gib.work/bounty/1052f22d-3f87-4b1d-b0d7-71a60679e7fa) (up to **1000 USDC**, deadline **2026-10-30**).

A terminal **CLI + MCP server** that helps developers and AI agents **discover, rank, watch, and draft submissions** for coding bounties on Gibwork — using the official **`@gibwork/sdk`** (and public API fallback). Not a web app / dashboard.

| Piece | Role |
| --- | --- |
| `gib-hunt` CLI | explore / rank / show / draft / apply-pack / overnight-report / rails-scout / watch / alert / doctor |
| MCP server | tools for Cursor / Claude / other agents |
| `@gibwork/sdk` | wallet-authenticated discovery & submissions when a local keypair is configured |

## Why this is valuable

Browsing Gibwork in a browser does not fit agent workflows. Agents need **stdio tools** and **CLI commands** that:

1. Pull open bounties
2. Score them against skills + reward + deadline (with transparent breakdown)
3. Watch for newly posted high-value bounties (file-based seen cache)
4. Emit a submission draft (repo + demo checklist) **before** paying the participation fee
5. Optionally call the official SDK with a **local Solana keypair** (no Phantom / browser wallet)

## Requirements

- Node.js **≥ 22**
- Optional: Solana keypair file for authenticated SDK calls (`GIBWORK_PRIVATE_KEY` or `GIBWORK_KEYPAIR_PATH`)

## Install

```bash
git clone https://github.com/KvngJamesII/gibwork-bounty-hunter.git
cd gibwork-bounty-hunter
npm install
npm run build
npm link   # optional: puts gib-hunt + gibwork-bounty-hunter-mcp on PATH
```

Copy `.env.example` → `.env` if you will use wallet-authenticated SDK methods.

## CLI usage

```bash
# Public discovery (no wallet)
gib-hunt explore --limit 10
gib-hunt rank --top 5 --min-usd 50
gib-hunt rank --top 5 --table          # fixed-width score breakdown
gib-hunt rank --top 5 --json           # JSON with breakdown object
gib-hunt show 1052f22d-3f87-4b1d-b0d7-71a60679e7fa
gib-hunt draft 1052f22d-3f87-4b1d-b0d7-71a60679e7fa \
  --repo https://github.com/KvngJamesII/gibwork-bounty-hunter

# Apply / submission pack (agent-friendly markdown)
gib-hunt apply-pack 1052f22d-3f87-4b1d-b0d7-71a60679e7fa \
  --repo https://github.com/KvngJamesII/gibwork-bounty-hunter -o apply-pack.md
gib-hunt submission-pack 1052f22d-3f87-4b1d-b0d7-71a60679e7fa   # alias → stdout

# Overnight coding snapshot (+ .cache/overnight-report.md)
gib-hunt overnight-report --min-usd 20 --top 10

# Adjacent rails: Superteam Earn + Frantic + DeskCrew (≥$20, standing skips)
gib-hunt rails-scout --min-usd 20
gib-hunt earn-scout --json   # alias

# New bounty alerts (seen IDs under .cache/gib-hunt-seen.json)
gib-hunt watch --seed                  # seed cache without alerts
gib-hunt watch --min-usd 50            # one-shot: print newly seen ≥$50
gib-hunt alert --min-usd 100 --interval 300   # poll every 5 min

gib-hunt doctor                        # Node / SDK / API health
gib-hunt hackathon                     # IdleDev path notes
```

After `npm run build`:

```bash
node dist/cli/index.js rank --top 5 --table
```

## MCP install (agents)

Copy a sample from `samples/` and replace `/absolute/path/to/...` with your clone path.

**Cursor** (`samples/mcp.cursor.json`):

```json
{
  "mcpServers": {
    "gibwork-bounty-hunter": {
      "command": "node",
      "args": ["/absolute/path/to/gibwork-bounty-hunter/dist/mcp/server.js"],
      "env": {
        "GIB_HUNT_MIN_USD": "20",
        "GIB_HUNT_SKILLS": "development,typescript,rust,solana,cli,mcp,sdk"
      }
    }
  }
}
```

**Claude Desktop** — same shape (`samples/mcp.claude-desktop.json`).

**Dev (tsx, no build)** — `samples/mcp.dev.json`:

```json
{
  "mcpServers": {
    "gibwork-bounty-hunter": {
      "command": "npx",
      "args": ["tsx", "/absolute/path/to/gibwork-bounty-hunter/src/mcp/server.ts"]
    }
  }
}
```

Or after `npm link`:

```json
{
  "mcpServers": {
    "gibwork-bounty-hunter": {
      "command": "gibwork-bounty-hunter-mcp"
    }
  }
}
```

### Tools

| Tool | Description |
| --- | --- |
| `gib_explore_bounties` | List open bounties |
| `gib_rank_coding_bounties` | Rank coding/dev bounties (includes score breakdown) |
| `gib_get_bounty` | Fetch one bounty by UUID |
| `gib_draft_submission` | Markdown submission draft (no payment) |
| `gib_apply_pack` | Apply/submission pack (outline + checklist; UUID or slug) |
| `gib_overnight_report` | Overnight coding bounty snapshot + skill-match scores |
| `gib_rails_scout` | Superteam Earn + Frantic + DeskCrew ≥minUsd agent/coding scout |
| `gib_watch_new_bounties` | One-shot poll for newly appearing ≥minUsd bounties |
| `gib_doctor` | Node / SDK / public API health checks |

## Official Gibwork toolset used

- **`@gibwork/sdk`** — TypeScript client for wallet-authenticated External API (`tasks.listAvailable`, submissions, etc.)
- Optional companion packages from Gibwork: `@gibwork/cli`, `@gibwork/mcp`
- Public REST fallback: `https://api.gib.work/explore` and `https://gib.work/api/tasks/{id}` when no keypair is present

## Sample output

```text
$ gib-hunt rank --top 3 --min-usd 20 --table
 #  SCORE  USD    DAYS  REW  SKL  DLN  TAG  TITLE
----------------------------------------------------------------------------------------------------
 1   72.1  $1000    47   36   36    0    0  Gibwork Developer Hackathon Bounty
```

```text
$ gib-hunt watch --min-usd 50
New bounties (1) ≥$50:
- $200 — Example coding bounty
  https://gib.work/bounty/...
Cache: .cache/gib-hunt-seen.json (12 seen)
```

## Safety / non-goals

- **No Phantom signatures** — local keypair only
- **No automatic paid submissions** in v0.2.x — drafts / apply-packs only until you explicitly wire `submissions.create` with a persisted idempotency key
- Does **not** fake Discord attendance (human must join + attend ≥2 sessions)

## Hackathon path (IdleDev)

1. ✅ Google Form submitted (`onlyidledev@gmail.com`)
2. Join Discord → wait for **Hackathon** role  
   - https://discord.gg/2577tTsRt (listing)  
   - https://discord.gg/jJa6tffXj (form)
3. Attend **≥ 2** Discord hackathon sessions (schedule announced in Discord; agent cannot attend)
4. Ship demo video + screenshots
5. Submit on gib.work before **2026-10-30**

Payout wallet (Solana): `2Uup61Xjcqpyh9jfSNKBfHr4J1Ju7qjzDyUzFpdmduwW`  
GitHub: [KvngJamesII](https://github.com/KvngJamesII) · Email: onlyidledev@gmail.com

## License

MIT
