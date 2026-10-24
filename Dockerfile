FROM node:24-bookworm-slim AS web
WORKDIR /build/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN --mount=type=secret,id=build_ca \
    if [ -s /run/secrets/build_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/build_ca; fi; \
    npm ci
COPY frontend/ ./
ENV VITE_ENABLE_DEMO=false
RUN npm run build

FROM python:3.12-slim-bookworm
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    CIVPROJ_DB=/var/data/civproj.sqlite3 \
    CIVPROJ_STATIC_DIR=/app/frontend/dist \
    CIVPROJ_SECURE_COOKIE=1
WORKDIR /app
RUN groupadd --gid 10001 civproj \
    && useradd --uid 10001 --gid civproj --no-create-home civproj \
    && mkdir -p /var/data
COPY backend/requirements.lock ./requirements.lock
RUN --mount=type=secret,id=build_ca \
    if [ -s /run/secrets/build_ca ]; then export PIP_CERT=/run/secrets/build_ca; fi; \
    pip install --no-cache-dir -r requirements.lock
COPY --chown=10001:10001 backend/app/ ./backend/app/
COPY --from=web --chown=10001:10001 /build/frontend/dist/ ./frontend/dist/
COPY scripts/cloud_start.py ./scripts/cloud_start.py
EXPOSE 10000
ENTRYPOINT ["python", "/app/scripts/cloud_start.py"]
