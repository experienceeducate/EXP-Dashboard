"""Application settings.

Pydantic ``Settings`` loaded once at import time. We **fail fast**: if a
required secret is missing the process raises ``RuntimeError`` during import so
the pod crash-loops with a clear message instead of booting into a silently
insecure state.
"""
from __future__ import annotations

from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # ── Product identity ──────────────────────────────────────────────────
    PRODUCT_NAME: str = "EXP"

    # Custom client-header guard (mirrors the reference X-Mshauri-Client).
    # Every /api/* request must carry: X-Exp-Client: <CLIENT_HEADER_TOKEN>
    CLIENT_HEADER_NAME: str = "X-Exp-Client"
    CLIENT_HEADER_TOKEN: str = "dashboard-v1"

    # ── BigQuery ──────────────────────────────────────────────────────────
    GOOGLE_SERVICE_ACCOUNT_KEY: str = Field(
        ..., description="Filesystem path to the GCP service-account JSON key."
    )
    BQ_PROJECT_ID: str = "educate-data-warehouse-test"
    BQ_DATASET: str = "gold_exp"
    BQ_TABLE: str = "exp_ai_dashboard_model"

    # ── Auth / JWT ────────────────────────────────────────────────────────
    JWT_SECRET: str = Field(..., description="HS256 signing secret. REQUIRED.")
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRY_HOURS: int = 8

    # Shared password for the email+password (non-SSO) login path.
    DASHBOARD_PASSWORD: str = Field(..., description="Shared login password. REQUIRED.")

    # Google OAuth (optional locally — email+password login works without it).
    GOOGLE_CLIENT_ID: str = ""
    GOOGLE_CLIENT_SECRET: str = ""
    OAUTH_ALLOWED_DOMAIN: str = "experienceeducate.org"

    # ── Access control ────────────────────────────────────────────────────
    # Path to a JSON file with the ACCESS_CONFIG (national/regional/cu → emails).
    # If unset/missing, the hardcoded fallback in core/access.py is used.
    ACCESS_CONFIG_PATH: str = ""

    # ── URLs / CORS ───────────────────────────────────────────────────────
    FRONTEND_URL: str = "http://localhost:3000"
    # Comma-separated additional CORS origins.
    EXTRA_CORS_ORIGINS: str = ""

    # ── Cache ─────────────────────────────────────────────────────────────
    CACHE_MAXSIZE: int = 512
    CACHE_TTL_SECONDS: int = 300

    # ── App-owned BigQuery storage / shared LLM config ──────────────────────
    # Dataset (separate from the read-only gold model) for tables this app
    # writes to itself — digest snapshots, E!nsight audit log, etc. Features
    # using it should degrade gracefully if data engineering hasn't created
    # their table yet (see database.insert_rows / query_rows_ignore_missing_table).
    DASHBOARD_APP_DATASET: str = "dashboard_app"
    # OpenRouter (OpenAI-compatible API) so features can target Claude models
    # via the `openai` SDK's base_url override. Optional — each caller no-ops
    # without a key.
    OPENROUTER_API_KEY: str = ""
    OPENROUTER_MODEL: str = "anthropic/claude-sonnet-5"

    @property
    def table_ref(self) -> str:
        """Fully-qualified, backtick-quoted table reference for SQL."""
        return f"`{self.BQ_PROJECT_ID}.{self.BQ_DATASET}.{self.BQ_TABLE}`"

    @property
    def dashboard_events_table(self) -> str:
        return f"{self.BQ_PROJECT_ID}.{self.DASHBOARD_APP_DATASET}.raw_dashboard_events"

    @property
    def dashboard_tasks_table(self) -> str:
        return f"{self.BQ_PROJECT_ID}.{self.DASHBOARD_APP_DATASET}.raw_exp_dashboard_tasks"

    @property
    def cors_origins(self) -> list[str]:
        origins = [self.FRONTEND_URL, "http://localhost:3000", "http://localhost:5173"]
        if self.EXTRA_CORS_ORIGINS:
            origins.extend(o.strip() for o in self.EXTRA_CORS_ORIGINS.split(",") if o.strip())
        # De-dupe, preserve order.
        seen: set[str] = set()
        return [o for o in origins if not (o in seen or seen.add(o))]


@lru_cache
def get_settings() -> Settings:
    try:
        return Settings()  # type: ignore[call-arg]
    except Exception as exc:  # pydantic ValidationError on missing required env
        raise RuntimeError(
            "Configuration error — a required setting is missing. "
            "Ensure JWT_SECRET, DASHBOARD_PASSWORD and GOOGLE_SERVICE_ACCOUNT_KEY "
            f"are set (see .env.example). Original error: {exc}"
        ) from exc


settings = get_settings()
