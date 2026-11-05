# Local secret scan for staged changes. ASCII-only by requirement.
#
# Modelled on Mshauri's .claude/hooks/precommit-secret-scan.ps1, updated for
# the security review (DATA-888, plan v1.3 section 4):
#   * uses the current gitleaks command  `gitleaks git --pre-commit --staged`
#     (v8.19+; the old `gitleaks protect` is deprecated), with the repo's
#     .gitleaks.toml -- the SAME config as CI and .pre-commit-config.yaml;
#   * never prints a matched line or value (the old fallback echoed the
#     suspect lines, i.e. the secret itself, into the terminal/Claude);
#   * no private allowlist of its own -- .gitleaks.toml is the single source.
#
# This is fast local feedback only. The authoritative gates are the git
# pre-commit hook (.pre-commit-config.yaml, `pre-commit install`) and the
# "Secret scan" GitHub Actions workflow (.github/workflows/secret-scan.yml).
#
# Works two ways:
#   1. Claude Code PreToolUse(Bash) hook: reads the tool-call JSON on stdin and
#      only scans when the command creates a git commit. Wire it per machine in
#      .claude/settings.local.json (gitignored) -- see .claude/settings.local.example.json.
#   2. Plain script / git hook (no stdin): always scans the staged changes.
# Exit 2 blocks (stderr is shown to Claude); exit 0 allows. Internal errors
# fail open so normal tool use never wedges -- CI is the hard gate.

$ErrorActionPreference = 'Stop'

try {
    $raw = ''
    try { if ([Console]::IsInputRedirected) { $raw = [Console]::In.ReadToEnd() } } catch { $raw = '' }
    if ($raw -and $raw.Trim().Length -gt 0) {
        $cmd = ''
        try { $cmd = (ConvertFrom-Json $raw).tool_input.command } catch { $cmd = '' }
        if (-not $cmd) { exit 0 }
        if ($cmd -notmatch '\bgit\b[\s\S]*\bcommit\b') { exit 0 }
    }

    $projectDir = $env:CLAUDE_PROJECT_DIR
    if (-not $projectDir) { $projectDir = (Get-Location).Path }
    $config = Join-Path $projectDir '.gitleaks.toml'

    # Preferred path: gitleaks on the staged changes, repo config.
    $gitleaks = Get-Command gitleaks -ErrorAction SilentlyContinue
    if ($gitleaks) {
        $glArgs = @('git', '--pre-commit', '--staged', '--redact', '--no-banner')
        if (Test-Path $config) { $glArgs += @('--config', $config) }
        $glArgs += $projectDir
        & $gitleaks.Source @glArgs 1>$null 2>$null
        if ($LASTEXITCODE -eq 1) {
            [Console]::Error.WriteLine("BLOCKED: gitleaks found a secret in the staged changes. Run 'gitleaks git --pre-commit --staged --redact --verbose' to see where (values are redacted). Unstage it, ROTATE the credential, and never allowlist a real secret.")
            exit 2
        }
        exit 0
    }

    # Fallback when gitleaks is not installed: high-signal patterns over the
    # ADDED lines of the staged diff. Reports file names only, never content.
    $diff = ''
    try { $diff = (git -C $projectDir diff --cached -U0 --no-color 2>$null | Out-String) } catch { exit 0 }
    if (-not $diff) { exit 0 }

    $patterns = @(
        '-----BEGIN [A-Z ]*PRIVATE KEY-----',                     # PEM private keys
        '"type"\s*:\s*"service_account"',                         # GCP service-account JSON
        '(?i)private[_-]?key[_-]?id["'']?\s*[:=]\s*["'']?[a-f0-9]{40}', # GCP private_key_id
        'ewogICJ0eXBlIjogInNlcnZpY2VfYWNjb3Vu|eyJ0eXBlIjoic2VydmljZV9hY2NvdW50', # base64 SA JSON
        'AIza[0-9A-Za-z_\-]{35}',                                 # Google API key
        'AKIA[0-9A-Z]{16}',                                       # AWS access key id
        'gh[pousr]_[0-9A-Za-z]{36,}',                             # GitHub token
        'xox[baprs]-[0-9A-Za-z-]{10,}',                           # Slack token
        '(?i)(secret|password|passwd|token|api[_-]?key)\s*[:=]\s*["''][^"''\s]{16,}["'']' # assigned secret
    )

    $file = ''
    $flagged = @{}
    foreach ($line in ($diff -split "`n")) {
        if ($line -match '^diff --git a/(.+) b/') { $file = $Matches[1]; continue }
        if ($line -notmatch '^\+' -or $line -match '^\+\+\+') { continue }
        # Files that legitimately contain these patterns as detection rules.
        if ($file -match '(^|/)\.env\.example$|(^|/)\.gitleaks\.toml$|^\.claude/hooks/|^scripts/gitleaks-selftest') { continue }
        foreach ($p in $patterns) {
            if ($line -match $p) { $flagged[$file] = $true; break }
        }
    }

    if ($flagged.Count -gt 0) {
        [Console]::Error.WriteLine('BLOCKED: staged changes look like they contain a secret in: ' + (($flagged.Keys | Sort-Object) -join ', '))
        [Console]::Error.WriteLine('Unstage it and ROTATE the credential. gitleaks is not installed -- install it for accurate scanning: https://github.com/gitleaks/gitleaks')
        exit 2
    }
    exit 0
}
catch {
    # Fail open: never block a commit because the hook itself errored.
    exit 0
}
