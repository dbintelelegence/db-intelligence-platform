from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    # Database
    database_url: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/db_intelligence"

    # API
    api_host: str = "0.0.0.0"
    api_port: int = 8000
    debug: bool = False

    # Anthropic (LLM — explain verdicts only, never diagnose)
    anthropic_api_key: str = ""
    anthropic_model: str = "claude-sonnet-4-6"

    # Analyzer settings
    # How many std deviations above baseline triggers degraded
    degraded_sigma_threshold: float = 2.0
    # How many std deviations above baseline triggers critical
    critical_sigma_threshold: float = 3.5
    # Minimum samples in baseline before analyzer runs
    baseline_min_samples: int = 100
    # Hours of silence before a cluster is flagged as gap state
    metric_gap_threshold_hours: int = 1

    # Baseline engine
    # How many days of history to use when computing baselines
    baseline_lookback_days: int = 30

    # Grafana Cloud — GCP Prod stack
    grafana_gcp_prod_url: str = ""
    grafana_gcp_prod_instance_id: str = ""
    grafana_gcp_prod_api_key: str = ""

    # Adapter runner — 60s default gives ~1440 data points/day per analyzer (vs 288 at 300s)
    # Override via ANALYZER_RUN_INTERVAL_SECONDS env var
    analyzer_run_interval_seconds: int = 60
    normalisation_cache_ttl_seconds: int = 300

    # Push ingest workers — number of coroutines draining the analysis queue
    push_worker_count: int = 3

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


@lru_cache()
def get_settings() -> Settings:
    return Settings()
