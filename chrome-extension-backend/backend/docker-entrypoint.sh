#!/bin/sh
# Container entrypoint: apply database migrations, then start the API behind the trusted reverse proxy.
# Made by Yash Jain with passion.
set -eu

alembic upgrade head

# Load (or, in development, create) the signing key once so every worker shares the same key.
python -c "from app.core.jwt import get_key_manager; print('jwt key ready:', get_key_manager().active_kid)"

exec uvicorn app.main:app \
    --host 0.0.0.0 \
    --port "${PORT}" \
    --workers "${WEB_CONCURRENCY:-2}" \
    --proxy-headers \
    --forwarded-allow-ips "${FORWARDED_ALLOW_IPS}" \
    --no-server-header
