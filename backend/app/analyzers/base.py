"""
Base analyzer interface.

Every analyzer implements this protocol:
  - declare what metrics and log signals it needs
  - implement analyze() which returns a VerdictResult
  - never call the LLM — that happens outside after status change detection
"""

from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from app.models.models import HealthStatus, ConfidenceLevel


class ConfidenceDelta(int, Enum):
    UP = 1
    NONE = 0
    DOWN = -1


@dataclass
class EvidenceItem:
    """A single piece of evidence backing a verdict."""
    text: str
    source_type: str          # "metric" | "log_signal"
    confidence_delta: int = 0 # +1 | 0 | -1
    log_signal_id: str | None = None


@dataclass
class VerdictResult:
    """
    Structured output of one analyzer run.
    The analyzer fills this — the LLM never touches it.
    """
    analyzer_name: str
    status: HealthStatus
    observed: str              # What was observed (factual)
    baseline_summary: str      # What normal looks like for this cluster
    root_cause: str            # Deterministic root cause explanation
    recommendation: str        # What to do about it
    confidence: ConfidenceLevel
    evidence: list[EvidenceItem] = field(default_factory=list)
    metric_ts: datetime | None = None  # Timestamp of most recent metric used


class BaseAnalyzer:
    """
    Abstract base for all analyzers.
    Subclasses implement analyze() and declare their requirements.
    """

    # Override in subclass
    ANALYZER_NAME: str = ""
    REQUIRED_METRICS: list[str] = []
    OPTIONAL_LOG_SIGNALS: list[str] = []

    def can_run(self, available_metrics: set[str]) -> bool:
        """Returns True only if all required metrics are present."""
        return all(m in available_metrics for m in self.REQUIRED_METRICS)

    def analyze(
        self,
        metrics: dict[str, float],
        baselines: dict,           # canonical_name -> BaselineProfile
        log_signals: dict[str, int],  # signal_type -> count in window
        metric_ts: datetime,
    ) -> VerdictResult:
        raise NotImplementedError
