FROM python:3.14-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

# Non-root (security review DATA-894). UID 10001 matches the Deployment's
# securityContext.runAsUser (k8s/backend/deployment.yaml).
RUN useradd --create-home --uid 10001 appuser && chown -R appuser:appuser /app
USER 10001

# Single process / single replica — see docs/CONTEXT.md (in-memory cache).
# Do NOT add --workers without moving the cache to a shared store.
#
# --proxy-headers/--forwarded-allow-ips: the nginx ingress (k8s/backend/ingress.yaml)
# terminates TLS and forwards plain HTTP to this pod. Without these flags uvicorn
# reports scheme=http (what it actually sees), so request.url_for() in
# app/auth.py's google_login built an http:// redirect_uri — mismatching the
# https:// URI registered with Google and failing OAuth with
# "Error 400: redirect_uri_mismatch".
#
# Security review DATA-894: the forwarded headers are now trusted ONLY from
# private (RFC 1918) addresses — the ingress-nginx pods — instead of "*". The
# client IP feeds the per-IP sign-in rate limits (app/core/access_runtime.py),
# and with "*" anything that reached the pod could choose its own IP.
# (k8s/backend/networkpolicy.yaml makes "only via the ingress" enforced, not assumed.)
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips=10.0.0.0/8,172.16.0.0/12,192.168.0.0/16"]
