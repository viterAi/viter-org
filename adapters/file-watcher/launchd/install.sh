#!/bin/bash
# install.sh — install the vita file-watcher as a Mac launchd user-agent.
#
# Idempotent: safe to re-run. Removes any existing service first, then loads.
#
# Usage:
#   ./install.sh           # install + start
#   ./install.sh stop      # stop + unload
#   ./install.sh status    # show current state
#   ./install.sh tail      # tail the live logs

set -euo pipefail

LABEL="ai.viter.vita.file-watcher"
PLIST_SRC="$(cd "$(dirname "$0")" && pwd)/${LABEL}.plist"
PLIST_DST="$HOME/Library/LaunchAgents/${LABEL}.plist"
LOG_OUT="$HOME/Library/Logs/vita-file-watcher.out.log"
LOG_ERR="$HOME/Library/Logs/vita-file-watcher.err.log"

cmd="${1:-install}"

case "$cmd" in
  install)
    [[ -f "$PLIST_SRC" ]] || { echo "missing plist: $PLIST_SRC" >&2; exit 1; }
    [[ -f "/Users/mordechai/viter-workspace/vita/.env.local" ]] || {
      echo "missing /Users/mordechai/viter-workspace/vita/.env.local — fill SUPABASE_SERVICE_ROLE_KEY first" >&2
      exit 1
    }
    mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
    cp "$PLIST_SRC" "$PLIST_DST"
    launchctl unload "$PLIST_DST" 2>/dev/null || true
    launchctl load "$PLIST_DST"
    echo "✓ loaded ${LABEL}"
    echo "  logs: tail -f $LOG_OUT"
    ;;

  stop)
    launchctl unload "$PLIST_DST" 2>/dev/null || true
    echo "✓ unloaded ${LABEL}"
    ;;

  status)
    # Note: avoid `grep -q` with `set -o pipefail` — early-exit closes the pipe and
    # propagates SIGPIPE-induced nonzero from launchctl, falsely tripping the `else`.
    line=$(launchctl list | awk -v lbl="$LABEL" '$3 == lbl { print }')
    if [[ -n "$line" ]]; then
      printf '✓ loaded\n  %s\n' "$line"
      echo "  plist: $PLIST_DST"
      echo "  out:   $LOG_OUT"
      echo "  err:   $LOG_ERR"
    else
      echo "✗ not loaded"
    fi
    ;;

  tail)
    tail -F "$LOG_OUT" "$LOG_ERR"
    ;;

  *)
    echo "usage: $0 [install|stop|status|tail]" >&2
    exit 2
    ;;
esac
