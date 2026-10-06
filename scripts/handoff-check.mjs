/**
 * Family Finance Buddy — is anything stranded on this machine?
 *
 * The work is done in one place at a time, the local machine or a cloud session,
 * and handed over through git. The only way that goes wrong is work left on the
 * machine being left: an uncommitted edit, a commit nobody pushed, a branch the
 * other side does not know exists. Git already knows all of that. This asks it.
 *
 *   node scripts/handoff-check.mjs --leaving    before stopping here. Exits 1 if
 *                                               anything exists only on this machine.
 *   node scripts/handoff-check.mjs --arriving   before starting here. Fetches, then
 *                                               says where the last session stopped.
 *
 * It changes nothing. It never pushes, pulls, stashes or discards: a script that
 * tidied for you would be the one that lost the work.
 *
 * See docs/handoff.md.
 */

import { execFileSync } from 'node:child_process';

const mode = process.argv[2] === '--leaving' ? 'leaving' : 'arriving';

function git(...args) {
  try {
    return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch {
    return null;
  }
}

const lines = [];
const say = (text = '') => lines.push(text);

if (mode === 'arriving') {
  say('Fetching origin…');
  if (git('fetch', '--prune', 'origin') === null) {
    say('  Could not fetch. Check the network and `gh auth status`, then run this again.');
  }
}

const branch = git('rev-parse', '--abbrev-ref', 'HEAD') ?? '(unknown)';
const dirty = (git('status', '--porcelain') ?? '').split('\n').filter(Boolean);
const upstream = git('rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}');
const unpushed = upstream === null ? null : (git('log', '--oneline', `${upstream}..HEAD`) ?? '').split('\n').filter(Boolean);
const behind = upstream === null ? null : (git('log', '--oneline', `HEAD..${upstream}`) ?? '').split('\n').filter(Boolean);

say(`On branch ${branch}${upstream === null ? ' (not pushed anywhere yet)' : `, tracking ${upstream}`}.`);

let stranded = false;

if (dirty.length > 0) {
  stranded = true;
  say(`\n${String(dirty.length)} uncommitted change${dirty.length === 1 ? '' : 's'} (exists only here):`);
  for (const line of dirty.slice(0, 15)) say(`  ${line}`);
  if (dirty.length > 15) say(`  … and ${String(dirty.length - 15)} more`);
}

if (upstream === null) {
  const own = (git('log', '--oneline', 'origin/main..HEAD') ?? '').split('\n').filter(Boolean);
  if (branch !== 'main' && own.length > 0) {
    stranded = true;
    say(`\nThis branch has ${String(own.length)} commit${own.length === 1 ? '' : 's'} that exist only here: \`git push -u origin ${branch}\`.`);
  }
} else if (unpushed !== null && unpushed.length > 0) {
  stranded = true;
  say(`\n${String(unpushed.length)} commit${unpushed.length === 1 ? '' : 's'} not pushed (exists only here):`);
  for (const line of unpushed.slice(0, 10)) say(`  ${line}`);
}

if (behind !== null && behind.length > 0) {
  say(`\nThis branch is ${String(behind.length)} commit${behind.length === 1 ? '' : 's'} behind origin. Somebody, probably the other environment, pushed to it.`);
  say('  Pull it before editing: `git pull --ff-only`. Do not start work on top of an old copy.');
}

if (mode === 'arriving') {
  const main = git('rev-list', '--left-right', '--count', 'main...origin/main');
  if (main !== null) {
    const [ahead, behindMain] = main.split(/\s+/).map(Number);
    if (behindMain > 0) say(`\nLocal main is ${String(behindMain)} commit${behindMain === 1 ? '' : 's'} behind origin/main: \`git checkout main && git pull --ff-only\`.`);
    if (ahead > 0) say(`\nLocal main has ${String(ahead)} commit${ahead === 1 ? '' : 's'} origin/main does not. Main should only move by merged pull requests; look before going on.`);
  }

  // Where the last session stopped: remote branches with work not in main, newest first.
  const refs = git('for-each-ref', '--sort=-committerdate', '--format=%(refname:short)|%(committerdate:relative)|%(subject)', 'refs/remotes/origin') ?? '';
  const open = [];
  for (const row of refs.split('\n').filter(Boolean)) {
    const [name, when, subject] = row.split('|');
    if (name === 'origin/main' || name === 'origin/HEAD' || name === 'origin') continue;
    const count = Number(git('rev-list', '--count', `origin/main..${name}`) ?? '0');
    if (count > 0) open.push(`  ${name}  (${String(count)} commit${count === 1 ? '' : 's'} not in main, ${when}) ${subject}`);
  }
  say(open.length === 0 ? '\nNo branch carries work that main does not have.' : '\nBranches with work not yet in main, newest first:');
  for (const row of open.slice(0, 8)) say(row);
  if (open.length > 8) say(`  … and ${String(open.length - 8)} older`);
  say('\nRead docs/handoff.md, "Where the last session stopped", on the newest of those, if any.');
}

if (mode === 'leaving') {
  say(
    stranded
      ? '\nNOT SAFE TO LEAVE. Commit and push the above (a work-in-progress commit is fine), then write where you stopped in docs/handoff.md and push that.'
      : '\nNothing exists only on this machine. If you stopped mid-task, "Where the last session stopped" in docs/handoff.md should say so, and it should be pushed.',
  );
} else if (stranded) {
  say('\nThe above exists only on this machine. If the other environment was the last one used, something was left behind: ask before going on.');
}

console.log(lines.join('\n'));
process.exit(stranded && mode === 'leaving' ? 1 : 0);
