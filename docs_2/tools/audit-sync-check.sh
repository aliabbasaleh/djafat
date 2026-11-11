#!/usr/bin/env bash
# audit-sync-check.sh — reports commits that the docs_2/ audit has not reviewed yet.
#
# Read-only: it never fetches, pulls, writes or changes anything. It prints NOTHING when the
# documentation is up to date, so it is cheap to run on every prompt.
#
# Usage
#   docs_2/tools/audit-sync-check.sh                human-readable report
#   docs_2/tools/audit-sync-check.sh --hook EVENT   JSON for a Claude Code hook, EVENT being
#                                                   UserPromptSubmit or PostToolUse
#
# How "reviewed" is decided
#   docs_2/history/LAST_REVIEWED_COMMIT lists "<commit> <ref>" lines. Every commit reachable from
#   ANY of those commits counts as reviewed. HEAD and every remote-tracking branch are checked;
#   a ref is reported when it holds commits outside that set. So a fast-forward onto a commit
#   that was already reviewed on another branch is not reported, but a merge commit is.
#
# What to do when something is reported: docs_2/README.md §3 (the incremental audit sync).
# Wired into Claude Code by the shared .claude/settings.json (see docs_2/README.md §4).
#
# Written for macOS's bash 3.2: no associative arrays, no mapfile. No dependency beyond git,
# sed, awk, sort and tr, so the hook keeps working even if jq or python are not on PATH.

set -u

mode=text
event=""
if [ "${1:-}" = "--hook" ]; then
  mode=hook
  event="${2:-UserPromptSubmit}"
  input=$(cat 2>/dev/null || true)
  if [ "$event" = "PostToolUse" ]; then
    # After a tool call, react only to git commands that bring in or switch to other
    # commits (not to our own `git commit`: the next prompt reports those). False
    # positives are harmless: the check below stays silent unless something is unreviewed.
    # Look at the command only (tool_input.command), not at the command's output.
    cmd=$(printf '%s' "$input" | grep -oE '"command"[[:space:]]*:[[:space:]]*"([^"\\]|\\.)*"' | head -n 1)
    [ -n "$cmd" ] || cmd=$input
    printf '%s' "$cmd" | grep -Eq '(^|[^[:alnum:]_-])git([^[:alnum:]_-]|$)' || exit 0
    printf '%s' "$cmd" |
      grep -Eq '(^|[^[:alnum:]_-])(pull|fetch|merge|rebase|checkout|switch|reset|am|cherry-pick)([^[:alnum:]_-]|$)' ||
      exit 0
  fi
fi

# Locate the repository: the hook passes CLAUDE_PROJECT_DIR; otherwise use this script's place.
root="${CLAUDE_PROJECT_DIR:-}"
if [ -z "$root" ]; then
  root=$(cd "$(dirname "$0")/../.." 2>/dev/null && pwd) || exit 0
fi
cd "$root" 2>/dev/null || exit 0
git rev-parse --git-dir >/dev/null 2>&1 || exit 0

marker="docs_2/history/LAST_REVIEWED_COMMIT"
[ -f "$marker" ] || exit 0

# --- read the marker ---------------------------------------------------------------------
recorded=""        # existing recorded commits, space separated (used unquoted on purpose)
listed_refs=" "    # refs named in the marker, space delimited
problems=""        # lines about recorded commits or refs that no longer resolve
nl='
'
while read -r sha ref _rest; do
  case "$sha" in '' | '#'*) continue ;; esac
  listed_refs="$listed_refs$ref "
  if git cat-file -e "$sha^{commit}" 2>/dev/null; then
    recorded="$recorded $sha"
  else
    problems="$problems- recorded commit ${sha:0:7} for $ref is no longer in this repository (history rewritten?): review the whole branch.$nl"
  fi
  if [ "$ref" != "HEAD" ] && ! git rev-parse -q --verify "refs/remotes/$ref" >/dev/null 2>&1; then
    problems="$problems- $ref no longer exists (merged or deleted?): update UNMERGED_BRANCHES.md and LAST_REVIEWED_COMMIT.$nl"
  fi
done <"$marker"
[ -n "$recorded" ] || exit 0

short_recorded=""
for s in $recorded; do
  case "$short_recorded " in *" ${s:0:7} "*) ;; *) short_recorded="$short_recorded ${s:0:7}" ;; esac
done

# --- look at HEAD and every remote-tracking branch --------------------------------------
report=""
summary=""
seen=" "           # current commits already reported (dedupes HEAD == origin/main)
total=0

check_ref() { # $1 = label, $2 = current commit
  local label=$1 cur=$2 n authors files subjects more
  case "$seen" in *" $cur "*)
    report="$(printf '%s' "$report" | sed "s|@@${cur}@@|, $label@@${cur}@@|")$nl"
    return 0
    ;;
  esac
  # shellcheck disable=SC2086  # $recorded is a deliberate word list
  n=$(git rev-list --count "$cur" --not $recorded 2>/dev/null) || return 0
  [ "${n:-0}" -gt 0 ] || return 0
  seen="$seen$cur "
  total=$((total + n))
  # shellcheck disable=SC2086
  authors=$(git log --format='%an' "$cur" --not $recorded 2>/dev/null | sort | uniq -c | sort -rn |
    awk '{c=$1; $1=""; sub(/^ /,""); printf "%s%s (%s)", (NR>1?", ":""), $0, c}')
  # shellcheck disable=SC2086
  # -m --first-parent: a merge commit counts the files it changes on the receiving branch.
  files=$(git log --format= --name-only -m --first-parent "$cur" --not $recorded 2>/dev/null | sed '/^$/d' | sort -u | wc -l | tr -d ' ')
  # shellcheck disable=SC2086
  subjects=$(git log --format='    %h %ad %s' --date=short -n 6 "$cur" --not $recorded 2>/dev/null |
    LC_ALL=C tr -d '\000-\010\013\014\016-\037' | cut -c1-150)
  more=""
  [ "$n" -gt 6 ] && more="$nl    … and $((n - 6)) more"
  report="$report- $label@@${cur}@@: $n unreviewed commit(s) by $authors, $files file(s) touched$nl$subjects$more$nl    list them: git log --reverse --format='%h %ad %an | %s' --date=short ${cur:0:7} --not$short_recorded$nl"
  summary="$summary${summary:+, }$label"
}

head_sha=$(git rev-parse -q --verify HEAD 2>/dev/null) || exit 0
head_name=$(git symbolic-ref --short -q HEAD 2>/dev/null || echo "detached")
check_ref "HEAD ($head_name)" "$head_sha"

refs=$(git for-each-ref --format='%(refname:short) %(objectname) %(symref)' refs/remotes 2>/dev/null)
while read -r rname rsha rsym; do
  [ -n "${rname:-}" ] || continue
  [ -z "${rsym:-}" ] || continue # skip origin/HEAD and other symbolic refs
  label="$rname"
  case "$listed_refs" in *" $rname "*) ;; *) label="$rname (new branch, not yet followed)" ;; esac
  check_ref "$label" "$rsha"
done <<EOF
$refs
EOF

[ "$total" -gt 0 ] || [ -n "$problems" ] || exit 0

report=$(printf '%s' "$report" | sed 's|@@[0-9a-f]*@@||g')
[ -z "$report" ] || report="$report$nl"
msg="DJAFAT audit sync pending — the repository holds commits that docs_2/ has not reviewed yet.$nl$report$problems"
msg="${msg}Before starting other work (unless the user asks otherwise), run the incremental audit sync described in docs_2/README.md §3: read every commit's diff; sort what changed into Added / Removed / Fixed / Changed; set each affected finding's status with its evidence level (\"fix present, unverified\" until its Verify step is re-run); add dated notes \"(updated YYYY-MM-DD, sync S-nnn)\" in the documents you change; log the sync at the top of docs_2/history/SYNC_LOG.md and in docs_2/history/CHANGELOG.md; then, last, move the lines in docs_2/history/LAST_REVIEWED_COMMIT. Tell the user what was added, removed and fixed, and what could not be verified. If the new commits are the user's own work and the documents already describe it, a short sync entry is enough."
sys="DJAFAT audit: $total unreviewed commit(s) on ${summary:-tracked refs} — sync pending (docs_2/README.md §3)."
[ "$total" -gt 0 ] || sys="DJAFAT audit: tracked refs changed — sync pending (docs_2/README.md §3)."

if [ "$mode" = text ]; then
  printf '%s\n' "$msg"
  exit 0
fi

json_escape() { # stdin -> JSON string body (no surrounding quotes)
  sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' -e "s/$(printf '\t')/\\\\t/g" |
    awk 'BEGIN { ORS = "" } { if (NR > 1) printf "\\n"; printf "%s", $0 }'
}
printf '{"systemMessage":"%s","hookSpecificOutput":{"hookEventName":"%s","additionalContext":"%s"}}\n' \
  "$(printf '%s' "$sys" | json_escape)" \
  "$(printf '%s' "$event" | json_escape)" \
  "$(printf '%s' "$msg" | json_escape)"
exit 0
