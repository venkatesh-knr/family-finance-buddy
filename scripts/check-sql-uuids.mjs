/**
 * Family Finance Buddy — every UUID literal in SQL is actually a UUID.
 *
 * Fixtures use readable ids — `f1110000-…-m001` for a member, `-h001` for a
 * holding — and the letters that make them readable are often not hexadecimal.
 * Postgres rejects those at runtime with `invalid input syntax for type uuid`,
 * which means a test file that looks right fails only once CI has spun up a
 * database. That has happened four times in this repository.
 *
 * The shape is unmistakable — 8-4-4-4-12 between quotes — so the check is
 * cheap, and it runs before anything needs a container.
 *
 * Run: node scripts/check-sql-uuids.mjs
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SHAPE = /'([0-9a-zA-Z]{8}-[0-9a-zA-Z]{4}-[0-9a-zA-Z]{4}-[0-9a-zA-Z]{4}-[0-9a-zA-Z]{12})'/g;
const HEX = /^[0-9a-fA-F-]+$/;

function walk(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? walk(path) : path.endsWith('.sql') ? [path] : [];
  });
}

const problems = [];
for (const file of walk('supabase')) {
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    for (const match of line.matchAll(SHAPE)) {
      if (!HEX.test(match[1])) {
        const bad = [...new Set([...match[1]].filter((c) => !/[0-9a-fA-F-]/.test(c)))].join(', ');
        problems.push(`${file}:${String(i + 1)}  ${match[1]}   (not hex: ${bad})`);
      }
    }
  });
}

if (problems.length > 0) {
  console.log('  ✗ These look like UUIDs but Postgres will refuse them:\n');
  for (const problem of problems) console.log(`      ${problem}`);
  console.log(`
  Readable fixture ids are worth keeping — just spell them in hex. 'm' for
  member becomes 'c', 'h' for holding becomes 'b', and so on.
`);
  process.exit(1);
}

console.log('  ✓ Every UUID literal in supabase/ is valid hexadecimal.');
