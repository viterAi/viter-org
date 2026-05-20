# @viter-org/adapter-file-watcher

Live ingestion adapter for Claude Code session JSONLs.

## What it does

Watches `~/.claude/projects/-Users-mordechai-*/*.jsonl`. On every write:

1. Debounce 5s (Claude Code rewrites mid-turn; wait for the file to settle)
2. Hash the file (sha256)
3. Call `Runner.ingestFile` — dedupes by sha256, so unchanged files are no-ops
4. Extracts `turn_text` + `tool_calls` facets, inserts into `l1_events`, flips active pointer

## Run locally

```bash
# from monorepo root
SUPABASE_URL=https://dkccadwohifcqcdzhhnu.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=<service-role-key> \
pnpm --filter @viter-org/adapter-file-watcher watch
```

Service-role key from <https://supabase.com/dashboard/project/dkccadwohifcqcdzhhnu/settings/api>.

## Run as a launchd daemon (Mac)

Save as `~/Library/LaunchAgents/ai.viter.viter-org.file-watcher.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>ai.viter.viter-org.file-watcher</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/env</string>
    <string>bash</string>
    <string>-c</string>
    <string>cd /Users/mordechai/viter-workspace/viter-org && pnpm --filter @viter-org/adapter-file-watcher watch</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>SUPABASE_URL</key>
    <string>https://dkccadwohifcqcdzhhnu.supabase.co</string>
    <key>SUPABASE_SERVICE_ROLE_KEY</key>
    <string>FILL-ME-IN</string>
    <key>VITA_USER_CANONICAL_ID</key>
    <string>mordechai-potash</string>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/bin:/bin</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>/tmp/viter-org-file-watcher.out.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/viter-org-file-watcher.err.log</string>
</dict>
</plist>
```

Then load:

```bash
launchctl load ~/Library/LaunchAgents/ai.viter.viter-org.file-watcher.plist
launchctl list | grep ai.viter.viter-org
tail -f /tmp/viter-org-file-watcher.out.log
```

## Per-laptop install

For Shaul's Mac, the same .plist works — change `VITA_USER_CANONICAL_ID` to `shaul-levine` (and ensure that principal exists in the substrate).

## Behaviour notes

- **Sha-deduped**: re-running on unchanged files is a no-op. Safe to restart anytime.
- **Active session growth**: as the JSONL grows, sha changes → new artifact per snapshot. Multiple artifacts per session is expected; query by `metadata.session_id` to get the latest.
- **Failed turns don't crash the daemon**: errors get logged + swallowed; next file event proceeds.
- **`ignoreInitial: false`**: on startup the watcher walks all existing files. They dedupe by sha256, so this is the "catch up" phase.
