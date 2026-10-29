# Node 26 (current release line): tracks the 2026-10 security releases
# automatically (Node2Shell CVE-2026-111497 brotli RCE fix + compromised
# eMudhra/emSign intermediates dropped from the bundled root store).
FROM node:26-alpine AS frontend-builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# 2026-10 eMudhra CA compromise: 3.13.18 rejects the compromised emSign
# intermediates at the interpreter level and ships a current ca-certificates.
FROM python:3.13.18-slim
WORKDIR /app

RUN addgroup --system --gid 1000 appgroup && \
    adduser --system --uid 1000 --gid 1000 appuser && \
    mkdir -p /data && chown appuser:appgroup /data

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/ backend/

COPY --from=frontend-builder /app/dist/ /app/static/

RUN chown -R appuser:appgroup /app

USER appuser

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/api/health')" || exit 1

CMD ["uvicorn", "backend.app:app", "--host", "0.0.0.0", "--port", "8000"]
