#!/usr/bin/env node
// Writes (or removes) a block of rules in the instruction files of coding agents so that
// every Apify call goes through the router. Safe to run twice: the block is replaced in place.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const START = '<!-- apify-router:start -->';
export const END = '<!-- apify-router:end -->';

export function renderBlock(url, tokenVar = 'APIFY_ROUTER_TOKEN') {
  const base = url.replace(/\/+$/, '');
  return `${START}
## Apify goes through apify-router

Every Apify call (REST API, \`apify-client\`, Apify CLI, scripts, MCP) goes through the router at ${base}.
Never call \`api.apify.com\` directly and never use a raw Apify key.

- Base URL: \`${base}\` instead of \`https://api.apify.com\`.
- Token: \`$${tokenVar}\` goes wherever an Apify token is expected (\`APIFY_API_TOKEN=$${tokenVar}\`).
- JS: \`new ApifyClient({ baseUrl: '${base}', token: process.env.${tokenVar} })\`.
- Python: \`ApifyClient(os.environ['${tokenVar}'], api_url='${base}')\`.
- curl: \`curl -H "Authorization: Bearer $${tokenVar}" ${base}/v2/acts/<actor>/runs -d '{...}'\`.
- Do not ask the user for individual Apify keys and do not store any. The router holds them and rotates between them.
- A \`503 router_exhausted\` means every key is out of credits. Stop, tell the user, and do not retry in a loop.
- Check balances with \`GET ${base}/_router/status\`.
${END}
`;
}

export function applyBlock(text, block) {
  const s = text.indexOf(START);
  const e = text.indexOf(END);
  if (s !== -1 && e > s) return text.slice(0, s) + block.trimEnd() + text.slice(e + END.length);
  const sep = text.length === 0 ? '' : text.endsWith('\n\n') ? '' : text.endsWith('\n') ? '\n' : '\n\n';
  return text + sep + block;
}

export function removeBlock(text) {
  const s = text.indexOf(START);
  const e = text.indexOf(END);
  if (s === -1 || e < s) return text;
  return (text.slice(0, s).replace(/\n+$/, '\n') + text.slice(e + END.length).replace(/^\n+/, '')).trimStart() || '';
}

const CURSOR_FRONTMATTER = `---
description: Route every Apify call through apify-router
alwaysApply: true
---

`;

export function targets({ dir, global }) {
  const home = homedir();
  if (global) {
    return [
      { name: 'claude', file: join(home, '.claude', 'CLAUDE.md') },
      { name: 'codex', file: join(home, '.codex', 'AGENTS.md') },
      { name: 'opencode', file: join(home, '.config', 'opencode', 'AGENTS.md') },
      { name: 'gemini', file: join(home, '.gemini', 'GEMINI.md') },
    ];
  }
  return [
    { name: 'claude', file: join(dir, 'CLAUDE.md') },
    { name: 'agents', file: join(dir, 'AGENTS.md') }, // Codex, OpenCode, Cursor and others read this one
    { name: 'cursor', file: join(dir, '.cursor', 'rules', 'apify-router.mdc'), prefix: CURSOR_FRONTMATTER },
    { name: 'gemini', file: join(dir, 'GEMINI.md') },
  ];
}

function parseArgs(argv) {
  const o = { dir: process.cwd(), global: false, remove: false, dry: false, only: null, url: null, tokenVar: 'APIFY_ROUTER_TOKEN' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--url') o.url = argv[++i];
    else if (a === '--dir') o.dir = resolve(argv[++i]);
    else if (a === '--token-var') o.tokenVar = argv[++i];
    else if (a === '--only') o.only = argv[++i].split(',');
    else if (a === '--global') o.global = true;
    else if (a === '--remove') o.remove = true;
    else if (a === '--dry-run') o.dry = true;
    else if (a === '-h' || a === '--help') o.help = true;
  }
  return o;
}

const HELP = `apify-router-rules --url <router url> [options]

  --url <url>         Where your router is deployed (required unless --remove)
  --dir <path>        Project to write into (default: current directory)
  --global            Write to the user-level files of each agent instead of a project
  --only <a,b>        Limit to: claude, agents, cursor, codex, opencode, gemini
  --token-var <name>  Env var that holds the router token (default APIFY_ROUTER_TOKEN)
  --remove            Take the block out again
  --dry-run           Show what would change, write nothing
`;

function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.help || (!o.url && !o.remove)) {
    console.log(HELP);
    process.exit(o.help ? 0 : 1);
  }
  const block = o.remove ? '' : renderBlock(o.url, o.tokenVar);
  for (const t of targets(o)) {
    if (o.only && !o.only.includes(t.name)) continue;
    const exists = existsSync(t.file);
    if (o.remove && !exists) continue;
    const current = exists ? readFileSync(t.file, 'utf8') : t.prefix ?? '';
    const next = o.remove ? removeBlock(current) : applyBlock(current, block);
    if (next === current) {
      console.log(`unchanged  ${t.file}`);
      continue;
    }
    console.log(`${o.dry ? 'would write' : o.remove ? 'removed from' : 'wrote'}  ${t.file}`);
    if (o.dry) continue;
    mkdirSync(dirname(t.file), { recursive: true });
    writeFileSync(t.file, next);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
