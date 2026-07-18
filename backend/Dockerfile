FROM python:3.14-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

# Single process / single replica — see docs/CONTEXT.md (in-memory cache).
# Do NOT add --workers without moving the cache to a shared store.
#
# --proxy-headers/--forwarded-allow-ips: the nginx ingress (k8s/backend/ingress.yaml)
# terminates TLS and forwards plain HTTP to this pod. Without these flags uvicorn
# reports scheme=http (what it actually sees), so request.url_for() in
# app/auth.py's google_login built an http:// redirect_uri — mismatching the
# https:// URI registered with Google and failing OAuth with
# "Error 400: redirect_uri_mismatch". allow-ips='*' trusts the ingress's
# X-Forwarded-Proto since the pod isn't reachable except through it.
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips=*"]
