#!/usr/bin/env bash
#
# Family Finance Buddy — the key check.
#
# Two keys exist and only one of them ships. The publishable key is in the
# bundle by design and grants nothing the row policies do not already allow.
# The secret key bypasses every policy, and this repository is public.
#
# So: search the build output for anything shaped like one, and fail the deploy
# if it is there. The tracked source is searched too, because a key that never
# reaches the bundle is still burned the moment it is pushed.
#
# What is matched is a key *value*, never the word. Writing "never commit an
# sb_secret key" in a comment is exactly the discipline this repository wants,
# and a check that punished it would be trained away within a week.
#
# Usage: scripts/check-no-secret-key.sh [build-directory]

set -euo pipefail

BUILD_DIR="${1:-dist}"

# 1. The current form: sb_secret_ followed by the key body.
# 2. The legacy form: a JWT whose payload carries "role":"service_role". Base64
#    has three alignments depending on where the claim starts, so all three
#    encodings of that fragment are listed.
PATTERNS='sb_secret_[A-Za-z0-9_-]{8,}|InJvbGUiOiJzZXJ2aWNlX3Jv|yb2xlIjoic2VydmljZV9yb2xl|cm9sZSI6InNlcnZpY2Vfcm9s'

fail=0

echo "Checking the build output in ${BUILD_DIR}/ …"
if [ ! -d "${BUILD_DIR}" ]; then
  echo "  ✗ ${BUILD_DIR}/ does not exist. Build before checking."
  exit 1
fi

if grep -rIEl "${PATTERNS}" "${BUILD_DIR}" 2>/dev/null; then
  echo "  ✗ A privileged key appears in the build output, in the files listed above."
  fail=1
else
  echo "  ✓ No privileged key in the build output."
fi

echo "Checking tracked source …"
# git grep only sees tracked files, which is the right scope: .env is ignored,
# and a local one is nobody else's problem. This script is excluded so its own
# patterns do not match themselves.
if git grep -IEl "${PATTERNS}" -- . ':(exclude)scripts/check-no-secret-key.sh' 2>/dev/null; then
  echo "  ✗ A privileged key appears in tracked source, in the files listed above."
  fail=1
else
  echo "  ✓ No privileged key in tracked source."
fi

if [ "${fail}" -ne 0 ]; then
  cat <<'MESSAGE'

  Stop. Rotate that key in the Supabase dashboard now — assume it is burned.
  The secret key belongs only in the backend's own function environment: never
  in this repository, the bundle, a build log, or an Actions secret used at
  build time.
MESSAGE
  exit 1
fi

echo "Both clean."
