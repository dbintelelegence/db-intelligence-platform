"""
Issue a push ingest bearer token for a customer stack.

The raw token is shown once and never stored. Only SHA-256(raw_token) is persisted.

Usage:
    cd backend
    python -m scripts.issue_ingest_token --tenant-name "Acme Corp" --db-type elasticsearch --label "prod-prometheus"
    python -m scripts.issue_ingest_token --tenant-id <uuid> --stack-id <uuid> --label "staging-otel"

Options:
    --tenant-id     UUID of the tenant (required if --tenant-name not given)
    --tenant-name   Name of the tenant to look up (creates if not found)
    --stack-id      UUID of the stack to associate the token with
    --db-type       DB type for stack lookup: elasticsearch | mysql | postgres | cassandra
    --label         Human label for the token, e.g. "prod-prometheus"
    --list          List all tokens for a tenant (no new token issued)
    --revoke        Revoke (deactivate) a token by its token prefix
"""

import argparse
import asyncio
import hashlib
import secrets
import sys
import uuid
from datetime import datetime, timezone

# Add backend root to path
sys.path.insert(0, __file__.rsplit("/scripts", 1)[0])

from sqlalchemy import select

from app.db.session import AsyncSessionLocal
from app.models.models import IngestToken, Stack, Tenant


def _hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


def _generate_token() -> str:
    """Generate a secure 32-byte random token with 'dbi_' prefix."""
    random_part = secrets.token_urlsafe(24)
    return f"dbi_{random_part}"


async def _get_or_create_tenant(db, tenant_id: str | None, tenant_name: str | None) -> Tenant:
    if tenant_id:
        tenant = await db.get(Tenant, uuid.UUID(tenant_id))
        if tenant is None:
            print(f"Error: tenant {tenant_id} not found")
            sys.exit(1)
        return tenant
    if tenant_name:
        stmt = select(Tenant).where(Tenant.name == tenant_name)
        tenant = (await db.execute(stmt)).scalar_one_or_none()
        if tenant is None:
            print(f"Tenant '{tenant_name}' not found — creating...")
            tenant = Tenant(name=tenant_name)
            db.add(tenant)
            await db.flush()
        return tenant
    print("Error: provide --tenant-id or --tenant-name")
    sys.exit(1)


async def _get_stack(db, stack_id: str | None, tenant: Tenant, db_type: str | None) -> Stack:
    if stack_id:
        stack = await db.get(Stack, uuid.UUID(stack_id))
        if stack is None:
            print(f"Error: stack {stack_id} not found")
            sys.exit(1)
        return stack

    # Look for a push stack for this tenant + db_type
    from app.models.models import DbType, SourceType
    stmt = select(Stack).where(
        Stack.tenant_id == tenant.id,
        Stack.source_type == SourceType.push,
    )
    if db_type:
        stmt = stmt.where(Stack.db_type == DbType(db_type))
    stacks = (await db.execute(stmt)).scalars().all()

    if len(stacks) == 1:
        return stacks[0]
    if len(stacks) > 1:
        print("Multiple push stacks found for this tenant. Specify --stack-id:")
        for s in stacks:
            print(f"  {s.id}  {s.db_type.value}  {s.display_name}")
        sys.exit(1)

    # Create a push stack
    from app.models.models import DbType, SourceType
    db_type_enum = DbType(db_type) if db_type else DbType.elasticsearch
    stack = Stack(
        tenant_id=tenant.id,
        db_type=db_type_enum,
        source_type=SourceType.push,
        display_name=f"{tenant.name} — {db_type_enum.value} (push)",
        api_endpoint="push",
        api_key_ref="ingest_token",
    )
    db.add(stack)
    await db.flush()
    print(f"Created push stack {stack.id} for tenant '{tenant.name}'")
    return stack


async def issue_token(args) -> None:
    async with AsyncSessionLocal() as db:
        tenant = await _get_or_create_tenant(db, args.tenant_id, args.tenant_name)
        stack = await _get_stack(db, args.stack_id, tenant, args.db_type)

        raw_token = _generate_token()
        token_hash = _hash_token(raw_token)

        record = IngestToken(
            tenant_id=tenant.id,
            stack_id=stack.id,
            token_hash=token_hash,
            label=args.label,
            is_active=True,
        )
        db.add(record)
        await db.commit()

        print()
        print("=" * 60)
        print("  Ingest token created.")
        print("  Token (shown ONCE — save this now):")
        print()
        print(f"    {raw_token}")
        print()
        print(f"  Token ID:  {record.id}")
        print(f"  Stack:     {stack.display_name} ({stack.db_type.value})")
        print(f"  Tenant:    {tenant.name}")
        print(f"  Label:     {args.label or '(none)'}")
        print("=" * 60)
        print()
        print("  Add to prometheus.yml:")
        print()
        print("  remote_write:")
        print("    - url: https://api.dbintelligence.io/ingest/metrics")
        print("      authorization:")
        print(f"        credentials: {raw_token}")
        print("      write_relabel_configs:")
        print("        - source_labels: [__name__]")
        print("          regex: \"elasticsearch_.*|mysql_.*|node_.*\"")
        print("          action: keep")
        print()


async def list_tokens(args) -> None:
    async with AsyncSessionLocal() as db:
        tenant = await _get_or_create_tenant(db, args.tenant_id, args.tenant_name)
        stmt = select(IngestToken).where(IngestToken.tenant_id == tenant.id).order_by(IngestToken.created_at)
        tokens = (await db.execute(stmt)).scalars().all()

        if not tokens:
            print(f"No tokens for tenant '{tenant.name}'")
            return

        print(f"\nTokens for tenant '{tenant.name}':")
        for t in tokens:
            status = "active" if t.is_active else "REVOKED"
            last_used = t.last_used_at.strftime("%Y-%m-%d %H:%M") if t.last_used_at else "never"
            print(f"  {t.id}  [{status}]  label={t.label or '(none)'}  last_used={last_used}")
        print()


async def revoke_token(args) -> None:
    async with AsyncSessionLocal() as db:
        stmt = select(IngestToken).where(IngestToken.id == uuid.UUID(args.revoke))
        token = (await db.execute(stmt)).scalar_one_or_none()
        if token is None:
            print(f"Error: token {args.revoke} not found")
            sys.exit(1)
        token.is_active = False
        await db.commit()
        print(f"Token {args.revoke} revoked.")


def main():
    parser = argparse.ArgumentParser(description="Issue or manage push ingest tokens")
    parser.add_argument("--tenant-id", help="Tenant UUID")
    parser.add_argument("--tenant-name", help="Tenant name (looks up or creates)")
    parser.add_argument("--stack-id", help="Stack UUID (optional — auto-selects or creates)")
    parser.add_argument("--db-type", default="elasticsearch", help="DB type for stack")
    parser.add_argument("--label", help="Human label for the token")
    parser.add_argument("--list", action="store_true", help="List tokens for tenant")
    parser.add_argument("--revoke", metavar="TOKEN_ID", help="Revoke token by UUID")
    args = parser.parse_args()

    if args.list:
        asyncio.run(list_tokens(args))
    elif args.revoke:
        asyncio.run(revoke_token(args))
    else:
        asyncio.run(issue_token(args))


if __name__ == "__main__":
    main()
