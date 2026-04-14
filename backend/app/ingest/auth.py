"""
Push ingest authentication.

Validates bearer tokens issued to push-stack customers.
Token hash (SHA-256) is stored in ingest_tokens table — raw token never stored.

Usage:
    token_record = await validate_bearer_token(db, raw_token)
    # token_record.tenant_id, token_record.stack_id
    # Raises 401 HTTPException if token is missing, invalid, or inactive.
"""

import hashlib
import logging
from datetime import datetime, timezone

from fastapi import HTTPException, Security
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import IngestToken

logger = logging.getLogger(__name__)

_bearer_scheme = HTTPBearer(auto_error=False)


def _hash_token(raw_token: str) -> str:
    return hashlib.sha256(raw_token.encode()).hexdigest()


async def validate_bearer_token(
    db: AsyncSession,
    credentials: HTTPAuthorizationCredentials | None,
) -> IngestToken:
    """
    Look up the bearer token in ingest_tokens.
    Updates last_used_at on success.
    Raises HTTP 401 on any failure (missing, invalid, inactive).
    """
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(status_code=401, detail="Missing bearer token")

    token_hash = _hash_token(credentials.credentials)
    stmt = select(IngestToken).where(
        IngestToken.token_hash == token_hash,
        IngestToken.is_active.is_(True),
    )
    result = await db.execute(stmt)
    record = result.scalar_one_or_none()

    if record is None:
        raise HTTPException(status_code=401, detail="Invalid or inactive ingest token")

    # Update last_used_at (fire-and-forget — don't block the response on this)
    record.last_used_at = datetime.now(timezone.utc)
    # No explicit flush — the session will commit this as part of the request

    logger.debug(f"Token auth OK — tenant={record.tenant_id} stack={record.stack_id}")
    return record


def get_bearer_credentials(
    credentials: HTTPAuthorizationCredentials | None = Security(_bearer_scheme),
) -> HTTPAuthorizationCredentials | None:
    """FastAPI dependency that extracts the bearer credentials without validation."""
    return credentials
