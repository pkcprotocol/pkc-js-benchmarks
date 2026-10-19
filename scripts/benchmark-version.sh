#!/usr/bin/env bash
# Benchmark one published pkc-js version and write its report into reports/.
#
# usage: scripts/benchmark-version.sh <version> <gitHead> [start.ts args...]
#
#   MERGE=1          merge into reports/<gitHead>.json, replacing only the cells this run measured
#                    (scripts/merge-report.ts); otherwise the run's report becomes the whole file
#   RUN_TIMEOUT=330m wall-time cap for the whole run (each cell also has its own cap in start.ts)
#
# Afterwards: reports/<gitHead>.json and .txt are updated, CPU profiles are moved to
# profiles-by-version/v<version>-<gitHead>/ (CI uploads that as an artifact; profiles never go into
# reports/), and reports/all.json is rebuilt. Exits non-zero when the run produced no report at all.
set -uo pipefail
VER="$1"
SHA="$2"
shift 2

rm -rf profiles report.json
npm install --no-save --no-audit --no-fund "@pkcprotocol/pkc-js@$VER" || exit 1

# start.ts removes report.json on startup, so its presence after the run means the run produced
# something (each failed cell is an entry with an `error`)
timeout "${RUN_TIMEOUT:-330m}" npm start -- "$@"
[ -f report.json ] || exit 1

if [ "${MERGE:-0}" = "1" ]; then
  node scripts/merge-report.ts "$SHA" report.json
else
  jq --arg sha "$SHA" 'map(. + {pkcJsCommitHash: $sha})' report.json > "reports/$SHA.json"
fi
node lib/print-report.ts "reports/$SHA.json" > "reports/$SHA.txt" || true

if [ -d profiles ]; then
  mkdir -p "profiles-by-version/v$VER-$SHA"
  cp -r profiles/. "profiles-by-version/v$VER-$SHA/"
fi

rm -f reports/all.json
jq -s -c 'sort_by(.[0].timestamp) | reverse' reports/*.json > reports/all.json
