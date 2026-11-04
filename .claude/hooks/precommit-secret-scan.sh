#!/usr/bin/env bash
# macOS/Linux twin of precommit-secret-scan.ps1 — see that file for the full
# rationale (security review DATA-888, plan v1.3 §4). Claude Code PreToolUse(Bash)
# hook: scans staged changes with `gitleaks git --pre-commit --staged` and the
# repo's .gitleaks.toml whenever Claude runs a git commit. Exit 2 blocks.
# Never prints a matched value. Fails open on internal errors (CI is the gate).
set -u

payload=""
if [ ! -t 0 ]; then payload="$(cat 2>/dev/null || true)"; fi
if [ -n "$payload" ]; then
  if command -v python3 >/dev/null 2>&1; then
    cmd="$(printf '%s' "$payload" | python3 -c 'import json,sys; print((json.load(sys.stdin).get("tool_input") or {}).get("command") or "")' 2>/dev/null || true)"
  else
    cmd="$payload"
  fi
  printf '%s' "$cmd" | grep -Eq '(^|[^[:alnum:]_])git([^[:alnum:]_].*)?[^[:alnum:]_]commit([^[:alnum:]_]|$)' || exit 0
fi

dir="${CLAUDE_PROJECT_DIR:-$(pwd)}"
cfg="$dir/.gitleaks.toml"

if command -v gitleaks >/dev/null 2>&1; then
  args=(git --pre-commit --staged --redact --no-banner)
  [ -f "$cfg" ] && args+=(--config "$cfg")
  gitleaks "${args[@]}" "$dir" >/dev/null 2>&1
  rc=$?
  if [ "$rc" -eq 1 ]; then
    echo "BLOCKED: gitleaks found a secret in the staged changes. Run 'gitleaks git --pre-commit --staged --redact --verbose' to see where (values are redacted). Unstage it, ROTATE the credential, and never allowlist a real secret." >&2
    exit 2
  fi
  exit 0
fi

# Fallback without gitleaks: high-signal patterns on added lines; file names only.
flagged="$(git -C "$dir" diff --cached -U0 --no-color 2>/dev/null | awk '
  /^diff --git a\// { f=$3; sub(/^a\//,"",f); next }
  /^\+\+\+/ { next }
  /^\+/ {
    if (f ~ /(^|\/)\.env\.example$/ || f ~ /(^|\/)\.gitleaks\.toml$/ || f ~ /^\.claude\/hooks\// || f ~ /^scripts\/gitleaks-selftest/) next
    if ($0 ~ /-----BEGIN [A-Z ]*PRIVATE KEY-----/ || $0 ~ /"type"[ \t]*:[ \t]*"service_account"/ ||
        $0 ~ /[Pp][Rr][Ii][Vv][Aa][Tt][Ee][_-]?[Kk][Ee][Yy][_-]?[Ii][Dd]["'"'"']?[ \t]*[:=][ \t]*["'"'"']?[a-f0-9]{40}/ ||
        $0 ~ /ewogICJ0eXBlIjogInNlcnZpY2VfYWNjb3Vu|eyJ0eXBlIjoic2VydmljZV9hY2NvdW50/ ||
        $0 ~ /AIza[0-9A-Za-z_-]{35}/ || $0 ~ /AKIA[0-9A-Z]{16}/ || $0 ~ /gh[pousr]_[0-9A-Za-z]{36,}/)
      print f
  }' | sort -u | tr '\n' ' ')"
if [ -n "$flagged" ]; then
  echo "BLOCKED: staged changes look like they contain a secret in: $flagged" >&2
  echo "Unstage it and ROTATE the credential. Install gitleaks for accurate scanning: https://github.com/gitleaks/gitleaks" >&2
  exit 2
fi
exit 0
