#!/bin/bash
set -euo pipefail
[[ "$(uname -s)" == Darwin ]] || exit 0
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$ROOT/build/bin"
TEMP="$(mktemp "$ROOT/build/bin/.preserve-creation-time.XXXXXX")"
trap 'rm -f "$TEMP"' EXIT
/usr/bin/clang -std=c11 -Wall -Wextra -Werror -O2 -mmacosx-version-min=13.5 \
  "$ROOT/macos/preserve-creation-time.c" -o "$TEMP"
mv "$TEMP" "$ROOT/build/bin/preserve-creation-time"
