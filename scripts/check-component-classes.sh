#!/usr/bin/env bash
#
# Family Finance Buddy — the tone-class check.
#
# Tailwind decides what to keep by scanning the source for literal class names,
# and it applies that to rules written in `@layer components` as well as to its
# own utilities. So a class assembled at runtime — `pill-${tone}` — is a class
# Tailwind never sees, and it drops the rule from the stylesheet it builds.
#
# That is exactly what happened. Every pill shipped with its base style and no
# colour at all, and nothing could catch it: the CSS was right, the component
# was right, the types were right, the unit tests passed, and the class simply
# was not in the built file. It is invisible until somebody looks at the app in
# the theme where it matters.
#
# Hence this check. It is not a style rule — it is the only place in the
# pipeline where "the CSS I wrote is in the CSS I shipped" is actually true or
# false. Every class listed below is one that a person can see; if a rule is
# added to base.css under a name built from a variable, add it here too.
#
# Usage: scripts/check-component-classes.sh [build-directory]

set -euo pipefail

BUILD_DIR="${1:-dist}"

# Classes chosen by a value at runtime, so never written out in a template.
# The components map the union to a literal string precisely so Tailwind can
# read it; this proves the mapping is still doing its job.
REQUIRED=(
  pill-own pill-ok pill-warn pill-due pill-neutral
  notice notice-gap notice-due notice-names notice-toggle
  setgrp setrow grouphead
  avatar menu mhead mitem mitem-quiet iconbtn app-title hide-narrow
  bottom-nav bottom-nav-glyph pb-nav hide-wide hide-narrow-flex
  stat track delta delta-up delta-down delta-flat figure
  tbl tbl-wrap num-col
  alloc-row alloc-dot alloc-name alloc-share alloc-figures alloc-value
)

if [ ! -d "${BUILD_DIR}" ]; then
  echo "  ✗ ${BUILD_DIR}/ does not exist. Build before checking."
  exit 1
fi

CSS=$(find "${BUILD_DIR}" -name '*.css' -print0 | xargs -0 cat 2>/dev/null || true)

if [ -z "${CSS}" ]; then
  echo "  ✗ No stylesheet in ${BUILD_DIR}/. Nothing was built, or it moved."
  exit 1
fi

missing=()
for class in "${REQUIRED[@]}"; do
  if ! printf '%s' "${CSS}" | grep -qF ".${class}"; then
    missing+=("${class}")
  fi
done

if [ "${#missing[@]}" -ne 0 ]; then
  echo "  ✗ These rules are in the source but not in the built stylesheet:"
  printf '      .%s\n' "${missing[@]}"
  cat <<'MESSAGE'

  Tailwind removed them because it could not find the name as a literal string
  in ./src. A class built as `thing-${variant}` is invisible to it.

  Fix it where the class is chosen, not in the config: map the union to written
  out names, the way PILL_CLASS and NOTICE_CLASS in src/ui/primitives.tsx do.
  Then the compiler makes you add the class when you add a variant, and the
  scanner can see it.
MESSAGE
  exit 1
fi

echo "  ✓ All ${#REQUIRED[@]} runtime-chosen component classes survived the build."
