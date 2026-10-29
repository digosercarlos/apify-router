# Making agents use the router

Coding agents read plain files for standing instructions. `scripts/install-rules.mjs` writes the same short block into each of them.

| Agent | File it reads |
|---|---|
| Claude Code | `CLAUDE.md` (project) or `~/.claude/CLAUDE.md` (global) |
| Codex | `AGENTS.md` or `~/.codex/AGENTS.md` |
| OpenCode | `AGENTS.md` or `~/.config/opencode/AGENTS.md` |
| Cursor | `.cursor/rules/apify-router.mdc` and `AGENTS.md` |
| Gemini CLI | `GEMINI.md` or `~/.gemini/GEMINI.md` |

## Install the rules

```bash
node scripts/install-rules.mjs --url https://YOUR-ROUTER                # this project
node scripts/install-rules.mjs --url https://YOUR-ROUTER --global       # every project
node scripts/install-rules.mjs --url https://YOUR-ROUTER --only claude  # one agent
node scripts/install-rules.mjs --remove                                 # take it out
```

Flags: `--dir <path>` to target another project, `--token-var <NAME>` if your token lives in a variable other than `APIFY_ROUTER_TOKEN`, `--dry-run` to see what would change.

## Make it stick

A rules file asks the model to behave. It does not stop a script from calling Apify directly. To close the gap:

1. Put the router token in the environment your agent runs in: `export APIFY_ROUTER_TOKEN=...`
2. Point anything that reads `APIFY_API_TOKEN` at the router token instead of a raw Apify key.
3. Set the base URL to the router wherever the client lets you (`baseUrl` in `apify-client` for JS, `api_url` in Python).

## The Apify MCP server

The Apify MCP server is configured with a raw key. Until it supports a custom base URL, it bypasses the router. Use the router's REST endpoint for runs that matter for balance tracking.
