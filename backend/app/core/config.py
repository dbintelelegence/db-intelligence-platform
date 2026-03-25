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

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


@lru_cache()
def get_settings() -> Settings:
    return Settings()
