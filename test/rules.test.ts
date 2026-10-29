import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain JS module
import { applyBlock, removeBlock, renderBlock } from '../scripts/install-rules.mjs';

const URL_ = 'https://router.example.test';

describe('rules block', () => {
  it('appends to an existing file and is idempotent', () => {
    const once = applyBlock('# Mine\n', renderBlock(URL_));
    expect(once.startsWith('# Mine\n')).toBe(true);
    expect(applyBlock(once, renderBlock(URL_))).toBe(once);
  });
  it('replaces the block when the url changes', () => {
    const a = applyBlock('# Mine\n', renderBlock(URL_));
    const b = applyBlock(a, renderBlock('https://other.example.test'));
    expect(b).toContain('other.example.test');
    expect(b).not.toContain('router.example.test');
    expect(b.match(/apify-router:start/g)).toHaveLength(1);
  });
  it('removes only its own block', () => {
    const a = applyBlock('# Mine\n', renderBlock(URL_));
    expect(removeBlock(a).trim()).toBe('# Mine');
  });
});

describe('cli', () => {
  it('writes the four project files, cursor with frontmatter', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rules-'));
    execFileSync('node', ['scripts/install-rules.mjs', '--url', URL_, '--dir', dir]);
    for (const f of ['CLAUDE.md', 'AGENTS.md', 'GEMINI.md']) expect(readFileSync(join(dir, f), 'utf8')).toContain(URL_);
    const cursor = readFileSync(join(dir, '.cursor/rules/apify-router.mdc'), 'utf8');
    expect(cursor.startsWith('---\n')).toBe(true);
    expect(cursor).toContain('alwaysApply: true');
  });
  it('dry run writes nothing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rules-'));
    execFileSync('node', ['scripts/install-rules.mjs', '--url', URL_, '--dir', dir, '--dry-run']);
    expect(existsSync(join(dir, 'CLAUDE.md'))).toBe(false);
  });
});
