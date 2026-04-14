"""
Adapter exceptions.

All adapters raise these — never raw httpx or asyncpg exceptions.
The caller handles these to produce customer-facing error messages.
"""


class AdapterError(Exception):
    """Base class for all adapter errors."""


class AdapterAuthError(AdapterError):
    """HTTP 401 — credentials rejected."""


class AdapterPermissionError(AdapterError):
    """HTTP 403 — credentials valid but insufficient scope."""


class AdapterNotFoundError(AdapterError):
    """HTTP 404 — endpoint not found."""


class AdapterTimeoutError(AdapterError):
    """Request timed out."""


class AdapterNoDataError(AdapterError):
    """Connection succeeded but no metrics found for the given query."""


class AdapterRateLimitError(AdapterError):
    """HTTP 429 — rate limited. Caller should retry with backoff."""


class AdapterServerError(AdapterError):
    """HTTP 5xx — source system error."""
