#!/usr/bin/env bash
# Proves .gitleaks.toml catches a GCP service-account key in every format we
# store config in: JSON, YAML, TOML, .env (raw + base64) and a Kubernetes
# Secret manifest — and that a clean file stays clean.
#
# Security review DATA-888 (plan v1.3 §4): "custom GCP service-account JSON
# rule, with coverage of JSON, YAML, TOML and .env confirmed".
#
# The keys are generated at runtime in a temp dir outside the repo and are
# deleted on exit. Nothing secret-shaped is ever committed for this test.
#
# Usage (from the repo root):   bash scripts/gitleaks-selftest.sh
# To ALSO keep the dummy files (for the plan's "commit one of each type to a
# test branch" check — docs/security/SECRETS_RUNBOOK.md §3):
#     SELFTEST_OUT=gitleaks-coverage bash scripts/gitleaks-selftest.sh
# Needs: gitleaks >= 8.19 on PATH (or GITLEAKS=/path/to/gitleaks), openssl, base64.
set -euo pipefail

GITLEAKS="${GITLEAKS:-gitleaks}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CONFIG="$ROOT/.gitleaks.toml"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

command -v "$GITLEAKS" >/dev/null || { echo "gitleaks not found (set GITLEAKS=...)"; exit 2; }
"$GITLEAKS" version

KEY_ID="$(openssl rand -hex 20)"
PEM="$(openssl genrsa 2048 2>/dev/null | openssl pkcs8 -topk8 -nocrypt 2>/dev/null)"
PEM_ESCAPED="$(printf '%s\n' "$PEM" | awk '{printf "%s\\n", $0}')"
PROJECT="selftest-$(openssl rand -hex 3)"
EMAIL="selftest@${PROJECT}.iam.gserviceaccount.com"

mkdir -p "$WORK/json" "$WORK/yaml" "$WORK/toml" "$WORK/env" "$WORK/envb64" "$WORK/k8s" "$WORK/clean"

SA_JSON=$(cat <<JSON
{
  "type": "service_account",
  "project_id": "$PROJECT",
  "private_key_id": "$KEY_ID",
  "private_key": "$PEM_ESCAPED",
  "client_email": "$EMAIL",
  "client_id": "100000000000000000000",
  "token_uri": "https://oauth2.googleapis.com/token"
}
JSON
)
printf '%s\n' "$SA_JSON" > "$WORK/json/sa-key.json"

{
  echo "type: service_account"
  echo "project_id: $PROJECT"
  echo "private_key_id: $KEY_ID"
  echo "private_key: |"
  printf '%s\n' "$PEM" | sed 's/^/  /'
  echo "client_email: $EMAIL"
} > "$WORK/yaml/sa-key.yaml"

{
  echo "[gcp]"
  echo "type = \"service_account\""
  echo "private_key_id = \"$KEY_ID\""
  echo "private_key = \"$PEM_ESCAPED\""
  echo "client_email = \"$EMAIL\""
} > "$WORK/toml/settings.toml"

{
  echo "GCP_PRIVATE_KEY_ID=$KEY_ID"
  echo "GCP_PRIVATE_KEY=\"$PEM_ESCAPED\""
} > "$WORK/env/.env"

B64="$(printf '%s\n' "$SA_JSON" | base64 | tr -d '\n')"
echo "GOOGLE_SERVICE_ACCOUNT_JSON_B64=$B64" > "$WORK/envb64/.env"

cat > "$WORK/k8s/secret.yaml" <<YAML
apiVersion: v1
kind: Secret
metadata:
  name: gcp-sa
type: Opaque
data:
  key.json: $B64
YAML

cat > "$WORK/clean/settings.toml" <<'TOML'
[app]
name = "nothing secret here"
private_key_path = "/var/secrets/gcp/key.json"
TOML

fail=0
for case in json yaml toml env envb64 k8s clean; do
  report="$WORK/$case.report.json"
  "$GITLEAKS" dir "$WORK/$case" --config "$CONFIG" --no-banner --redact \
    --report-format json --report-path "$report" --exit-code 0 >/dev/null 2>&1
  [ -f "$report" ] || echo "[]" > "$report"
  n=$(grep -o '"RuleID"' "$report" | wc -l | tr -d ' ' || true)
  rules=$(grep -o '"RuleID": *"[^"]*"' "$report" | sed 's/.*: *"//; s/"//' | sort -u | tr '\n' ' ' || true)
  if [ "$case" = "clean" ]; then
    if [ "$n" -eq 0 ]; then echo "PASS  clean    no findings"; else echo "FAIL  clean    $n unexpected finding(s): $rules"; fail=1; fi
  else
    if [ "$n" -gt 0 ]; then printf 'PASS  %-8s %s\n' "$case" "$rules"; else printf 'FAIL  %-8s not detected\n' "$case"; fail=1; fi
  fi
done

if [ -n "${SELFTEST_OUT:-}" ]; then
  mkdir -p "$SELFTEST_OUT"
  cp "$WORK/json/sa-key.json"      "$SELFTEST_OUT/dummy-sa-key.json"
  cp "$WORK/yaml/sa-key.yaml"      "$SELFTEST_OUT/dummy-sa-key.yaml"
  cp "$WORK/toml/settings.toml"    "$SELFTEST_OUT/dummy-settings.toml"
  cp "$WORK/env/.env"              "$SELFTEST_OUT/dummy.env"
  cp "$WORK/envb64/.env"           "$SELFTEST_OUT/dummy-b64.env"
  cp "$WORK/k8s/secret.yaml"       "$SELFTEST_OUT/dummy-secret.yaml"
  echo "Dummy (random, unusable) key files written to $SELFTEST_OUT/ — TEST BRANCH ONLY, delete after."
fi

[ "$fail" -eq 0 ] && echo "gitleaks self-test passed" || { echo "gitleaks self-test FAILED"; exit 1; }
