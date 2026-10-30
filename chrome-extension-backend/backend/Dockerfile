# Stack3 core API image (service name `chrome-api` in the root docker-compose).
# Made by Yash Jain with passion.

FROM python:3.12-slim AS builder
ENV PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1
WORKDIR /build
COPY pyproject.toml ./
COPY app ./app
RUN python -m venv /opt/venv && /opt/venv/bin/pip install .

FROM python:3.12-slim
ENV PATH="/opt/venv/bin:$PATH" \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8000 \
    FORWARDED_ALLOW_IPS=127.0.0.1
RUN groupadd --system app && useradd --system --gid app --home /srv app
WORKDIR /srv
COPY --from=builder /opt/venv /opt/venv
COPY --chown=app:app app ./app
COPY --chown=app:app graph ./graph
COPY --chown=app:app migrations ./migrations
COPY --chown=app:app alembic.ini docker-entrypoint.sh ./
RUN sed -i 's/\r$//' docker-entrypoint.sh && chmod 0555 docker-entrypoint.sh && mkdir -p /srv/.dev-keys && chown app:app /srv/.dev-keys && chmod 0700 /srv/.dev-keys
USER app
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
    CMD python -c "import urllib.request,os; urllib.request.urlopen(f'http://127.0.0.1:{os.environ[\"PORT\"]}/health', timeout=2)"
ENTRYPOINT ["./docker-entrypoint.sh"]
