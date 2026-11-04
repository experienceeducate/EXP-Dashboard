# Proves .gitleaks.toml catches a GCP service-account key in every format we
# store config in: JSON, YAML, TOML, .env (raw + base64) and a Kubernetes
# Secret manifest -- and that a clean file stays clean. Windows twin of
# scripts/gitleaks-selftest.sh. ASCII-only.
#
# Security review DATA-888 (plan v1.3 section 4): "custom GCP service-account
# JSON rule, with coverage of JSON, YAML, TOML and .env confirmed".
#
# The throwaway key material is random bytes generated at runtime in a temp
# folder outside the repo and deleted on exit. Nothing secret-shaped is ever
# committed for this test.
#
# Usage (from the repo root):   powershell -ExecutionPolicy Bypass -File scripts\gitleaks-selftest.ps1
# Needs: gitleaks >= 8.19 on PATH (or $env:GITLEAKS = 'C:\path\gitleaks.exe').

$ErrorActionPreference = 'Stop'

$gitleaks = if ($env:GITLEAKS) { $env:GITLEAKS } else { 'gitleaks' }
if (-not (Get-Command $gitleaks -ErrorAction SilentlyContinue)) {
    Write-Host 'gitleaks not found (install it, or set $env:GITLEAKS)'; exit 2
}
& $gitleaks version

$root = Split-Path -Parent $PSScriptRoot
$config = Join-Path $root '.gitleaks.toml'
$work = Join-Path ([System.IO.Path]::GetTempPath()) ('gl-selftest-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $work | Out-Null

function New-RandomHex([int]$bytes) {
    $b = New-Object byte[] $bytes
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
    return -join ($b | ForEach-Object { $_.ToString('x2') })
}

function Write-Ascii([string]$path, [string]$text) {
    $dir = Split-Path -Parent $path
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
    [System.IO.File]::WriteAllText($path, $text, (New-Object System.Text.ASCIIEncoding))
}

try {
    $rnd = New-Object byte[] 1190
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($rnd)
    $body = [Convert]::ToBase64String($rnd)
    $lines = for ($i = 0; $i -lt $body.Length; $i += 64) { $body.Substring($i, [Math]::Min(64, $body.Length - $i)) }
    # PEM armour assembled at runtime so this script itself never looks like a key to gitleaks.
    $dash = '-' * 5
    $pemLines = @($dash + 'BEGIN PRIVATE KEY' + $dash) + $lines + @($dash + 'END PRIVATE KEY' + $dash)
    $pem = ($pemLines -join "`n") + "`n"
    $pemEscaped = ($pemLines -join '\n') + '\n'

    $keyId = New-RandomHex 20
    $project = 'selftest-' + (New-RandomHex 3)
    $email = "selftest@$project.iam.gserviceaccount.com"

    $saJson = @"
{
  "type": "service_account",
  "project_id": "$project",
  "private_key_id": "$keyId",
  "private_key": "$pemEscaped",
  "client_email": "$email",
  "client_id": "100000000000000000000",
  "token_uri": "https://oauth2.googleapis.com/token"
}
"@
    Write-Ascii (Join-Path $work 'json\sa-key.json') ($saJson + "`n")

    $yamlKey = ($pemLines | ForEach-Object { '  ' + $_ }) -join "`n"
    Write-Ascii (Join-Path $work 'yaml\sa-key.yaml') ("type: service_account`nproject_id: $project`nprivate_key_id: $keyId`nprivate_key: |`n$yamlKey`nclient_email: $email`n")

    Write-Ascii (Join-Path $work 'toml\settings.toml') ("[gcp]`ntype = `"service_account`"`nprivate_key_id = `"$keyId`"`nprivate_key = `"$pemEscaped`"`nclient_email = `"$email`"`n")

    Write-Ascii (Join-Path $work 'env\.env') ("GCP_PRIVATE_KEY_ID=$keyId`nGCP_PRIVATE_KEY=`"$pemEscaped`"`n")

    $b64 = [Convert]::ToBase64String([System.Text.Encoding]::ASCII.GetBytes($saJson + "`n"))
    Write-Ascii (Join-Path $work 'envb64\.env') ("GOOGLE_SERVICE_ACCOUNT_JSON_B64=$b64`n")
    Write-Ascii (Join-Path $work 'k8s\secret.yaml') ("apiVersion: v1`nkind: Secret`nmetadata:`n  name: gcp-sa`ntype: Opaque`ndata:`n  key.json: $b64`n")

    Write-Ascii (Join-Path $work 'clean\settings.toml') ("[app]`nname = `"nothing secret here`"`nprivate_key_path = `"/var/secrets/gcp/key.json`"`n")

    $fail = $false
    foreach ($case in @('json', 'yaml', 'toml', 'env', 'envb64', 'k8s', 'clean')) {
        $report = Join-Path $work "$case.report.json"
        & $gitleaks dir (Join-Path $work $case) --config $config --no-banner --redact `
            --report-format json --report-path $report --exit-code 0 *> $null
        $findings = @()
        if (Test-Path $report) {
            $parsed = Get-Content -Raw $report | ConvertFrom-Json
            if ($parsed) { $findings = @($parsed) }
        }
        $rules = ($findings | ForEach-Object { $_.RuleID } | Sort-Object -Unique) -join ' '
        if ($case -eq 'clean') {
            if ($findings.Count -eq 0) { Write-Host 'PASS  clean    no findings' }
            else { Write-Host "FAIL  clean    $($findings.Count) unexpected finding(s): $rules"; $fail = $true }
        } else {
            if ($findings.Count -gt 0) { Write-Host ('PASS  {0,-8} {1}' -f $case, $rules) }
            else { Write-Host ('FAIL  {0,-8} not detected' -f $case); $fail = $true }
        }
    }

    if ($fail) { Write-Host 'gitleaks self-test FAILED'; exit 1 }
    Write-Host 'gitleaks self-test passed'
    exit 0
}
finally {
    Remove-Item -Recurse -Force $work -ErrorAction SilentlyContinue
}
