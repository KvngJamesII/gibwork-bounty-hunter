# gibwork-bounty-hunter

**Non-web Gibwork use case** for the [Gibwork Developer Hackathon Bounty](https://gib.work/bounty/1052f22d-3f87-4b1d-b0d7-71a60679e7fa) (up to **1000 USDC**, deadline **2026-10-30**).

A terminal **CLI + MCP server** that helps developers and AI agents **discover, rank, and draft submissions** for coding bounties on Gibwork — using the official **`@gibwork/sdk`** (and public API fallback). Not a web app / dashboard.

| Piece | Role |
| --- | --- |
| `gib-hunt` CLI | explore / rank / show / draft / doctor |
| MCP server | tools for Cursor / Claude / other agents |
| `@gibwork/sdk` | wallet-authenticated discovery & submissions when a local keypair is configured |

## Why this is valuable

Browsing Gibwork in a browser does not fit agent workflows. Agents need **stdio tools** and **CLI commands** that:

1. Pull open bounties
2. Score them against skills + reward + deadline
3. Emit a submission draft (repo + demo checklist) **before** paying the participation fee
4. Optionally call the official SDK with a **local Solana keypair** (no Phantom / browser wallet)

## Requirements

- Node.js **≥ 22**
- Optional: Solana keypair file for authenticated SDK calls (`GIBWORK_PRIVATE_KEY` or `GIBWORK_KEYPAIR_PATH`)

## Install

```bash
git clone https://github.com/KvngJamesII/gibwork-bounty-hunter.git
cd gibwork-bounty-hunter
npm install
npm run build
npm link   # optional: puts gib-hunt on PATH
```

Copy `.env.example` → `.env` if you will use wallet-authenticated SDK methods.

## CLI usage

```bash
# Public discovery (no wallet)
npx tsx src/cli/index.ts explore --limit 10
npx tsx src/cli/index.ts rank --top 5 --min-usd 50
npx tsx src/cli/index.ts show 1052f22d-3f87-4b1d-b0d7-71a60679e7fa
npx tsx src/cli/index.ts draft 1052f22d-3f87-4b1d-b0d7-71a60679e7fa \
  --repo https://github.com/KvngJamesII/gibwork-bounty-hunter
npx tsx src/cli/index.ts doctor
npx tsx src/cli/index.ts hackathon
```

After `npm run build`:

```bash
node dist/cli/index.js rank --top 5
```

## MCP usage

Add to your MCP client config (example Cursor / Claude Desktop):

```json
{
  "mcpServers": {
    "gibwork-bounty-hunter": {
      "command": "node",
      "args": ["/absolute/path/to/gibwork-bounty-hunter/dist/mcp/server.js"]
    }
  }
}
```

Or during development:

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

### Tools

| Tool | Description |
| --- | --- |
| `gib_explore_bounties` | List open bounties |
| `gib_rank_coding_bounties` | Rank coding/dev bounties |
| `gib_get_bounty` | Fetch one bounty by UUID |
| `gib_draft_submission` | Markdown submission draft (no payment) |

## Official Gibwork toolset used

- **`@gibwork/sdk`** — TypeScript client for wallet-authenticated External API (`tasks.listAvailable`, submissions, etc.)
- Optional companion packages from Gibwork: `@gibwork/cli`, `@gibwork/mcp`
- Public REST fallback: `https://api2.gib.work/explore` and `/tasks/{id}` when no keypair is present

## Sample output

```text
$ gib-hunt rank --top 3 --min-usd 20
1. score=52.3 $1000 — Gibwork Developer Hackathon Bounty
   https://gib.work/bounty/1052f22d-...
   reward~$1000 | skills:development,sdk,cli,mcp | deadline:46.2d | dev-tag
```

## Safety / non-goals

- **No Phantom signatures** — local keypair only
- **No automatic paid submissions** in v0.1 — drafts only until you explicitly wire `submissions.create` with a persisted idempotency key
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
