#!/usr/bin/env bash
# Election night loop, run by .github/workflows/live.yml: every INTERVAL seconds read the official results files,
# pick up the latest race calls from main, rerun the conditioned forecast and push live.json to the BRANCH branch.
# Env: BRANCH (live | live-test), MINUTES (how long to run), INTERVAL (seconds), TEST (1 = replay 2024), STOP_UTC
# (stop at this UTC time even if MINUTES remain; empty = no stop time).
set -u
BRANCH=${BRANCH:-live}; MINUTES=${MINUTES:-345}; INTERVAL=${INTERVAL:-120}; TEST=${TEST:-0}; STOP_UTC=${STOP_UTC:-}
WT=../livebr
git config user.name "midterm-map-bot"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
if git ls-remote --exit-code --heads origin "$BRANCH" >/dev/null 2>&1; then
  git fetch -q origin "$BRANCH"
  git worktree add -q -B "$BRANCH" "$WT" "origin/$BRANCH"
else
  git worktree add -q --detach "$WT"
  (cd "$WT" && git checkout -q --orphan "$BRANCH" && git rm -rfq . && printf 'Election-night data for the 2026 midterm map (written by .github/workflows/live.yml).\n' > README.md && git add README.md && git commit -qm "Start the $BRANCH branch" && git push -q origin "$BRANCH")
fi
# a test run starts its replay from scratch
if [ "$TEST" = "1" ]; then rm -f "$WT/live.json" "$WT/data_snapshot.json"; fi
# the whole night runs on the forecast as it stood when the first shift started (later shifts reuse that snapshot)
if [ ! -f "$WT/data_snapshot.json" ]; then
  cp site/data.json "$WT/data_snapshot.json"
  (cd "$WT" && git add data_snapshot.json && git commit -qm "Forecast snapshot for the night" && git push -q origin "$BRANCH") || echo "snapshot push failed"
fi
DATA="$WT/data_snapshot.json"
end=$((SECONDS + MINUTES * 60))
i=0
while [ $SECONDS -lt $end ]; do
  if [ -n "$STOP_UTC" ] && [ "$(date -u +%s)" -ge "$(date -u -d "$STOP_UTC" +%s)" ]; then echo "stop time $STOP_UTC reached"; break; fi
  i=$((i + 1))
  t0=$SECONDS
  if [ "$TEST" = "1" ]; then
    # the test replays 2024 and fills in over the run: 10% of counties finished at the start, 100% at the end
    prog=$(python3 -c "print(round(min(1.0, 0.1 + 0.9 * $SECONDS / max(1, $MINUTES * 60)), 3))")
    python3 pipeline/live.py fetch --out live_feeds.json --test --progress "$prog" || echo "feeds failed"
  else
    python3 pipeline/live.py fetch --out live_feeds.json || echo "feeds failed"
  fi
  git fetch -q origin main && git show origin/main:pipeline/content/calls.json > calls.json 2>/dev/null || echo '{}' > calls.json
  if [ "$TEST" = "1" ] && [ -f pipeline/scratch/live_test_calls.json ]; then cp pipeline/scratch/live_test_calls.json calls.json; fi
  cp "$WT/live.json" live.json 2>/dev/null || true
  if node pipeline/live_sim.js "$DATA" calls.json live_feeds.json live.json; then
    cp live.json "$WT/live.json"
    (cd "$WT" && git add live.json && git commit -qm "Live $(date -u +'%H:%M:%S UTC')" && (git push -q origin "$BRANCH" || (git pull -q --rebase origin "$BRANCH" && git push -q origin "$BRANCH"))) || echo "push failed"
  else
    echo "simulation failed"
  fi
  wait_s=$((INTERVAL - (SECONDS - t0)))
  [ $wait_s -gt 0 ] && sleep $wait_s
done
echo "loop done after $i passes"
