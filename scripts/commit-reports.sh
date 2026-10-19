#!/usr/bin/env bash
# Commit whatever changed under reports/ and push it to master, on top of whatever another
# benchmark job pushed in the meantime.
#
# usage: scripts/commit-reports.sh "<commit message>"
#
# The release, backfill and soak workflows run on separate runners and can finish a version at
# the same time. They write different reports/<gitHead>.json files, but all share the generated
# reports/all.json, so on a rebase conflict all.json is simply rebuilt from the merged reports.
set -u
MSG="$1"
for attempt in 1 2 3 4 5; do
  git add -A reports/
  git commit -q -m "$MSG" || true # nothing new on a retry: the commit is already there
  git fetch -q origin master
  # benchmark-version.sh's `npm install` rewrites package-lock.json; carry it across the rebase
  if ! git rebase -q --autostash origin/master; then
    if git diff --name-only --diff-filter=U | grep -qv '^reports/all.json$'; then
      echo "rebase conflict outside reports/all.json, giving up on this push"
      git rebase --abort
      exit 1
    fi
    git checkout -q --theirs reports/all.json && git add reports/all.json
    GIT_EDITOR=true git rebase --continue || { git rebase --abort; continue; }
  fi
  rm -f reports/all.json
  jq -s -c 'sort_by(.[0].timestamp) | reverse' reports/*.json > reports/all.json
  git add reports/all.json
  git commit -q --amend --no-edit
  if git push -q origin HEAD:master; then
    echo "pushed: $MSG"
    exit 0
  fi
  echo "push rejected (attempt $attempt), retrying"
done
echo "could not push after 5 attempts"
exit 1
