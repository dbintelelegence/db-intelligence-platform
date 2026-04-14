"""
LLM Explainer — Step 6

Generates a plain-English explanation when a verdict status changes.
Called by the analyzer runner ONLY on status change — never on every run.

Design constraints (from CLAUDE.md):
  - LLM explains the truth. It never diagnoses.
  - The verdict (status, root_cause, evidence) is the ground truth.
  - The LLM's job: turn structured fields into one clear paragraph.
  - Called only when new_status != prev_status.
  - Result stored in llm_explanations table permanently (postmortem reads history).
"""

import logging
from datetime import datetime, timezone

import anthropic

from app.analyzers.base import VerdictResult
from app.core.config import get_settings
from app.models.models import HealthStatus, LlmExplanation

logger = logging.getLogger(__name__)
settings = get_settings()


# ── Prompt construction ───────────────────────────────────────────────────────

def _build_prompt(
    result: VerdictResult,
    prev_status: HealthStatus | None,
    cluster_display_name: str,
) -> str:
    """
    Build a concise system + user prompt.
    The LLM receives only the structured verdict fields — it never sees raw metrics.
    """
    prev_label = prev_status.value if prev_status else "unknown"
    change_desc = f"{prev_label} → {result.status.value}"

    evidence_lines = "\n".join(f"  - {e.text}" for e in result.evidence)

    return f"""You are a database reliability assistant. A deterministic analyzer has produced a verdict about a database cluster. Your job is to write one clear paragraph (3–5 sentences) explaining what changed and why, in plain English for a database engineer.

Rules:
- Do not diagnose. The analyzer already determined the root cause — just explain it.
- Do not hedge or use phrases like "it appears" or "may be". State facts.
- Do not recommend specific commands or config values — the recommendation field covers that.
- Write for a database engineer, not a manager. Use technical terms freely.
- Keep it to one paragraph, no headers, no bullet points.

Cluster: {cluster_display_name}
Analyzer: {result.analyzer_name}
Status change: {change_desc}
Confidence: {result.confidence.value}

What the analyzer observed:
{result.observed}

Baseline context:
{result.baseline_summary}

Root cause (determined by analyzer):
{result.root_cause}

Evidence:
{evidence_lines}

Recommendation summary:
{result.recommendation}

Write the explanation paragraph now:"""


# ── Main entry point ──────────────────────────────────────────────────────────

async def generate_explanation(
    db,
    verdict_id,
    result: VerdictResult,
    prev_status: HealthStatus | None,
    cluster_display_name: str,
    trigger_reason: str,
) -> LlmExplanation | None:
    """
    Call the LLM and persist the explanation.
    Returns None if API key is not configured or call fails (non-fatal).

    Args:
        db:                   AsyncSession — for persisting the explanation
        verdict_id:           UUID of the verdict this explains
        result:               VerdictResult from the analyzer
        prev_status:          Previous verdict status (None if first run)
        cluster_display_name: Human-readable cluster name for the prompt
        trigger_reason:       Short description of why LLM was triggered
    """
    if not settings.anthropic_api_key:
        logger.warning("ANTHROPIC_API_KEY not set — skipping LLM explanation")
        return None

    prompt = _build_prompt(result, prev_status, cluster_display_name)

    try:
        client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
        message = client.messages.create(
            model=settings.anthropic_model,
            max_tokens=300,
            messages=[{"role": "user", "content": prompt}],
        )

        explanation_text = message.content[0].text.strip()
        input_tokens = message.usage.input_tokens
        output_tokens = message.usage.output_tokens

        logger.info(
            f"LLM explanation generated — "
            f"{input_tokens} in / {output_tokens} out tokens"
        )
        logger.info(f"  {explanation_text[:120]}...")

        record = LlmExplanation(
            verdict_id=verdict_id,
            explanation_text=explanation_text,
            model_version=settings.anthropic_model,
            trigger_reason=trigger_reason,
            generated_at=datetime.now(timezone.utc),
            input_tokens=input_tokens,
            output_tokens=output_tokens,
        )
        db.add(record)
        return record

    except anthropic.AuthenticationError:
        logger.error("Anthropic API key rejected — check ANTHROPIC_API_KEY")
        return None
    except anthropic.RateLimitError:
        logger.warning("Anthropic rate limited — explanation skipped this run")
        return None
    except Exception as e:
        logger.error(f"LLM explanation failed: {e}")
        return None
