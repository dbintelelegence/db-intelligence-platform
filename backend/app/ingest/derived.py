"""
Derived metric computation for push ingest.

Push senders ship raw samples (used_bytes, max_bytes).
Analyzers need computed ratios (heap_used_percent).

The pull adapter computes these via PromQL arithmetic.
Push ingest computes them in Python — same canonical output either way.

Usage:
    enriched = apply_derived_rules(canonical_metrics, DbType.elasticsearch)
    # enriched now contains jvm.heap.used.percent if the raw bytes were present
"""

import logging
from dataclasses import dataclass
from typing import Callable

from app.models.models import DbType

logger = logging.getLogger(__name__)


@dataclass
class DerivedRule:
    output_canonical: str               # canonical name to write into the dict
    inputs: list[str]                   # canonical names required as inputs
    compute: Callable[[dict[str, float]], float]  # given input values, return output
    db_types: list[DbType]              # which DB types this rule applies to


DERIVED_RULES: list[DerivedRule] = [
    DerivedRule(
        output_canonical="jvm.heap.used.percent",
        inputs=["jvm.heap.used.bytes", "jvm.heap.max.bytes"],
        compute=lambda v: (v["jvm.heap.used.bytes"] / v["jvm.heap.max.bytes"]) * 100,
        db_types=[DbType.elasticsearch],
    ),
    DerivedRule(
        output_canonical="mysql.buffer.pool.pressure.pct",
        inputs=["mysql.buffer.pool.bytes", "mysql.memory.total.bytes"],
        compute=lambda v: (v["mysql.buffer.pool.bytes"] / v["mysql.memory.total.bytes"]) * 100,
        db_types=[DbType.mysql],
    ),
    DerivedRule(
        output_canonical="mysql.connection.pct",
        inputs=["mysql.connections.current", "mysql.connections.max"],
        compute=lambda v: (v["mysql.connections.current"] / v["mysql.connections.max"]) * 100,
        db_types=[DbType.mysql],
    ),
    # Approximate per-second rate from 5-minute cumulative counter.
    # The pull adapter computes this via irate() in PromQL.
    # Push senders ship the 5-min cumulative total; divide by 300 to get /s.
    # Skipped when mysql.slow.query.rate is already present (direct push).
    DerivedRule(
        output_canonical="mysql.slow.query.rate",
        inputs=["mysql.slow.queries.total"],
        compute=lambda v: v["mysql.slow.queries.total"] / 300.0,
        db_types=[DbType.mysql],
    ),
    DerivedRule(
        output_canonical="mysql.query.rate",
        inputs=["mysql.queries.total"],
        compute=lambda v: v["mysql.queries.total"] / 300.0,
        db_types=[DbType.mysql],
    ),
    DerivedRule(
        output_canonical="fs.used.percent",
        inputs=["fs.total.total.bytes", "fs.total.available.bytes"],
        compute=lambda v: (
            (v["fs.total.total.bytes"] - v["fs.total.available.bytes"])
            / v["fs.total.total.bytes"]
        ) * 100,
        db_types=[DbType.elasticsearch, DbType.mysql],
    ),
]


def apply_derived_rules(
    canonical_metrics: dict[str, float],
    db_type: DbType,
) -> dict[str, float]:
    """
    Given a canonical metric dict, compute and add any derivable metrics.
    Runs after normalisation. Returns the augmented dict (modified in place and returned).
    Rules are skipped when any required input is missing or denominator is zero.
    """
    for rule in DERIVED_RULES:
        if db_type not in rule.db_types:
            continue
        if rule.output_canonical in canonical_metrics:
            # Already present (sent directly by the push agent) — don't overwrite
            continue
        if not all(inp in canonical_metrics for inp in rule.inputs):
            # Missing required inputs — skip silently
            continue
        try:
            value = rule.compute(canonical_metrics)
            canonical_metrics[rule.output_canonical] = value
            logger.debug(f"Derived {rule.output_canonical} = {value:.2f}")
        except ZeroDivisionError:
            logger.debug(f"Skipped derived rule '{rule.output_canonical}' — division by zero")
        except Exception as e:
            logger.warning(f"Derived rule '{rule.output_canonical}' failed: {e}")

    return canonical_metrics
