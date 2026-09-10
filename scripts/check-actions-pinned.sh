#!/usr/bin/env bash
#
# Family Finance Buddy — every GitHub Action pinned to a commit.
#
# A tag is mutable. `actions/checkout@v5` is whatever the owner of that
# repository points v5 at today, and one of the five this workflow used was not
# even a tag — `supabase/setup-cli@v1` is a BRANCH, which moves whenever
# somebody pushes to it.
#
# Two things follow, and the second is the one that bites quietly. A compromised
# or simply changed action runs with whatever the job can reach, which for the
# deploy job includes the Pages token. And a build cannot be reproduced: the
# same commit, built twice a month apart, can pull different action code and
# produce a different bundle — which makes a release tag a claim nobody can
# check.
#
# So: a commit SHA, with the human-readable version in a trailing comment. The
# comment is for the reader; the SHA is what runs.

set -euo pipefail

fail=0

while IFS= read -r line; do
  file="${line%%:*}"
  rest="${line#*:}"
  lineno="${rest%%:*}"
  ref="$(printf '%s' "$rest" | sed -n 's/.*uses:[[:space:]]*//p' | sed 's/[[:space:]]*#.*//')"

  # A local action (./path) has no upstream to pin.
  case "$ref" in
    ./*) continue ;;
  esac

  sha="${ref##*@}"
  if ! printf '%s' "$sha" | grep -Eq '^[0-9a-f]{40}$'; then
    printf '  ✗ %s:%s uses %s — pin it to a 40-character commit SHA.\n' "$file" "$lineno" "$ref"
    fail=1
  fi
done < <(grep -rn "uses:" .github/workflows/ || true)

if [ "$fail" -ne 0 ]; then
  printf '\n  A tag or branch is mutable: the action that runs tomorrow need not be\n'
  printf '  the one reviewed today, and a build at a release tag cannot be\n'
  printf '  reproduced. Resolve the ref with:\n\n'
  printf '    gh api repos/OWNER/REPO/git/ref/tags/TAG --jq .object.sha\n\n'
  exit 1
fi

count="$(grep -rc "uses:" .github/workflows/ | awk -F: '{ n += $2 } END { print n }')"
printf '  ✓ All %s GitHub Actions are pinned to a commit.\n' "$count"
