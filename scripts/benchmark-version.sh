#!/usr/bin/env bash
# Benchmark one published pkc-js version and write its report into reports/.
#
# usage: scripts/benchmark-version.sh <version> <gitHead> [start.ts args...]
#
#   MERGE=1          merge into reports/<gitHead>.json, replacing only the cells this run measured
#                    (scripts/merge-report.ts); otherwise the run's report becomes the whole file
#   RUN_TIMEOUT=330m wall-time cap for the whole run (each cell also has its own cap in start.ts)
#
# Afterwards: reports/<gitHead>.json and .txt are updated, CPU profiles are copied to
# cpu-profiles/v<version>/ (scripts/collect-profiles.ts, which also points the report entries at
# them; scripts/commit-reports.sh commits both), and reports/all.json is rebuilt. Exits non-zero when the run produced no report at all,
# or one start.ts never finished (see below).
set -uo pipefail
VER="$1"
SHA="$2"
shift 2

rm -rf profiles report.json
npm install --no-save --no-audit --no-fund "@pkcprotocol/pkc-js@$VER" || exit 1

# start.ts removes report.json on startup, so its presence after the run means the run produced
# something (each failed cell is an entry with an `error`)
timeout "${RUN_TIMEOUT:-330m}" npm start -- "$@"
STATUS=$?
[ -f report.json ] || exit 1
# start.ts stamps every entry when it finishes, and also when it is interrupted (the timeout above
# sends SIGTERM), after giving each cell it did not finish an `interrupted` error entry. Unstamped
# entries mean it died before either (a crash, SIGKILL): a partial report, not the version's report.
if ! jq -e 'all(.[]; has("measuredAt"))' report.json > /dev/null; then
  echo "npm start exited with status $STATUS without finishing report.json; not filing it"
  exit 1
fi
[ "$STATUS" -eq 0 ] || echo "npm start exited with status $STATUS: the run was cut short, its unfinished cells are interrupted error entries"

if [ "${MERGE:-0}" = "1" ]; then
  # a cell this run never finished must not replace what the version's report already has for it
  node scripts/merge-report.ts "$SHA" <(jq 'map(select(.interrupted != true))' report.json)
else
  jq --arg sha "$SHA" 'map(. + {pkcJsCommitHash: $sha})' report.json > "reports/$SHA.json"
fi
[ -d profiles ] && node scripts/collect-profiles.ts "$VER" "$SHA" profiles
node lib/print-report.ts "reports/$SHA.json" > "reports/$SHA.txt" || true

rm -f reports/all.json
jq -s -c 'sort_by(.[0].timestamp) | reverse' reports/*.json > reports/all.json
