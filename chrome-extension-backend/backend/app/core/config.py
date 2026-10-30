"""
Application settings loaded from environment variables, with production safety checks.

Made by Yash Jain with passion.
"""

from functools import lru_cache
from typing import Literal

from pydantic import Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

Environment = Literal["development", "test", "production"]


class Settings(BaseSettings):
    """Every configurable value of the service; secrets are SecretStr so they never print in logs."""

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    env: Environment = "development"
    app_name: str = "Stack3 Core API"
    log_level: str = "INFO"
    docs_enabled: bool = True

    api_base_url: str = "http://localhost:8000"
    web_app_url: str = "http://localhost:3000"
    cors_origins: list[str] = Field(default_factory=lambda: ["http://localhost:3000"])
    chrome_extension_ids: list[str] = Field(default_factory=list)

    database_url: str = "postgresql+asyncpg://localhost:5432/stack3"
    db_schema: str = "chrome"
    # Per worker; keep (pool + overflow) x workers under the database's connection limit (Supabase free: ~15)
    db_pool_size: int = 3
    db_max_overflow: int = 2
    redis_url: str | None = None

    max_body_bytes: int = 256 * 1024

    jwt_issuer: str = "https://api.stack3.xyz"
    jwt_private_key: SecretStr | None = None
    jwt_key_id: str = "stack3-dev-1"
    jwt_previous_public_key: str | None = None
    jwt_previous_key_id: str | None = None
    access_token_ttl_seconds: int = 30 * 60
    refresh_token_idle_ttl_days: int = 30
    session_absolute_ttl_days: int = 90
    refresh_reuse_grace_seconds: int = 10

    refresh_cookie_name: str = "__Secure-s3_rt"
    refresh_cookie_path: str = "/v1/auth"
    cookie_secure: bool = True
    # strict on localhost (site and API are both localhost). none when the site is on another domain, such as Netlify.
    cookie_samesite: Literal["strict", "lax", "none"] = "strict"

    otp_pepper: SecretStr = SecretStr("dev-only-otp-pepper-change-me-0123456789abcdef")
    otp_ttl_seconds: int = 10 * 60
    otp_max_attempts: int = 5
    otp_resend_cooldown_seconds: int = 60
    otp_hourly_limit_per_email: int = 5
    otp_hourly_limit_per_ip: int = 20

    link_ttl_seconds: int = 10 * 60
    link_poll_interval_seconds: int = 5

    team_invite_ttl_days: int = 7

    smtp_host: str | None = None
    smtp_port: int = 587
    smtp_username: str | None = None
    smtp_password: SecretStr | None = None
    smtp_implicit_tls: bool = False
    resend_api_key: SecretStr | None = None
    email_from: str = "Stack3 Security <login@stack3.xyz>"

    dodo_environment: Literal["test", "live"] = "test"
    dodo_api_key: SecretStr | None = None
    dodo_webhook_secret: SecretStr | None = None
    dodo_trial_days: int = 30
    dodo_product_pro_monthly: str | None = None
    dodo_product_pro_yearly: str | None = None
    dodo_product_team_monthly: str | None = None
    dodo_product_team_yearly: str | None = None
    dodo_addon_team_seat_monthly: str | None = None
    dodo_addon_team_seat_yearly: str | None = None

    # TigerGraph Savanna: in-database user for schema/setup (GSQL), secret for REST++ queries and upserts
    tigergraph_host: str | None = None
    tigergraph_graph: str = "stack3"
    tigergraph_username: str | None = None
    tigergraph_password: SecretStr | None = None
    tigergraph_secret: SecretStr | None = None
    # Savanna control-plane key (admin scripts only, never used by the running API)
    tigergraph_api_key: SecretStr | None = None
    graph_sync_interval_seconds: int = 15

    # Chain reads for transaction review and contract scan. The RPC URL is Ethereum mainnet and may embed its own key.
    etherscan_api_key: SecretStr | None = None
    rpc_url_ethereum: SecretStr | None = None
    # Optional. Script check still uses the threat graph when this is empty, and says Socket was not checked.
    socket_api_key: SecretStr | None = None
    # Public phishing lists. Tests turn this off so they never call GitHub.
    rules_remote: bool = True

    internal_service_key: SecretStr = SecretStr("dev-only-internal-key-change-me-0123456789")

    @property
    def is_production(self) -> bool:
        """True only when running the live deployment."""
        return self.env == "production"

    @property
    def smtp_configured(self) -> bool:
        """True when SMTP (e.g. Gmail) credentials are present."""
        return bool(self.smtp_host and self.smtp_username and self.smtp_password)

    @property
    def allowed_origins(self) -> list[str]:
        """Website origins plus every registered Chrome extension origin."""
        return [*self.cors_origins, *(f"chrome-extension://{ext_id}" for ext_id in self.chrome_extension_ids)]

    @property
    def tigergraph_configured(self) -> bool:
        """True when the threat graph can be reached: host plus the runtime secret."""
        return bool(self.tigergraph_host and self.tigergraph_secret)

    @property
    def etherscan_configured(self) -> bool:
        """True when contract source and age can be read from Etherscan."""
        return self.etherscan_api_key is not None

    @property
    def rpc_configured(self) -> bool:
        """True when Ethereum mainnet bytecode and ownership can be read."""
        return self.rpc_url_ethereum is not None

    @property
    def socket_configured(self) -> bool:
        """True when loaded JavaScript can be checked with Socket.dev."""
        return self.socket_api_key is not None

    @property
    def dodo_base_url(self) -> str:
        """Dodo API host for the configured mode."""
        return "https://live.dodopayments.com" if self.dodo_environment == "live" else "https://test.dodopayments.com"

    @field_validator(
        "jwt_private_key",
        "jwt_previous_public_key",
        "jwt_previous_key_id",
        "redis_url",
        "smtp_host",
        "smtp_username",
        "smtp_password",
        "resend_api_key",
        "dodo_api_key",
        "dodo_webhook_secret",
        "dodo_product_pro_monthly",
        "dodo_product_pro_yearly",
        "dodo_product_team_monthly",
        "dodo_product_team_yearly",
        "dodo_addon_team_seat_monthly",
        "dodo_addon_team_seat_yearly",
        "tigergraph_host",
        "tigergraph_username",
        "tigergraph_password",
        "tigergraph_secret",
        "tigergraph_api_key",
        "etherscan_api_key",
        "rpc_url_ethereum",
        "socket_api_key",
        mode="before",
    )
    @classmethod
    def _blank_is_unset(cls, value: object) -> object:
        """Treat `KEY=` lines in .env files as not configured."""
        return None if isinstance(value, str) and not value.strip() else value

    @model_validator(mode="after")
    def _enforce_production_secrets(self) -> "Settings":
        """Refuse to boot in production with missing or default secrets."""
        if self.cookie_samesite == "none" and not self.cookie_secure:
            raise ValueError("COOKIE_SAMESITE=none requires COOKIE_SECURE=true")
        if not self.is_production:
            return self
        problems: list[str] = []
        if self.jwt_private_key is None:
            problems.append("JWT_PRIVATE_KEY is required")
        if self.otp_pepper.get_secret_value().startswith("dev-only") or len(self.otp_pepper.get_secret_value()) < 32:
            problems.append("OTP_PEPPER must be a random value of at least 32 characters")
        service_key = self.internal_service_key.get_secret_value()
        if service_key.startswith("dev-only") or len(service_key) < 32:
            problems.append("INTERNAL_SERVICE_KEY must be a random value of at least 32 characters")
        if not self.smtp_configured and self.resend_api_key is None:
            problems.append("Email delivery is required: set SMTP_HOST/SMTP_USERNAME/SMTP_PASSWORD or RESEND_API_KEY")
        if self.dodo_api_key is None or self.dodo_webhook_secret is None:
            problems.append("DODO_API_KEY and DODO_WEBHOOK_SECRET are required")
        if not self.cookie_secure:
            problems.append("COOKIE_SECURE must be true")
        if problems:
            raise ValueError("Unsafe production configuration: " + "; ".join(problems))
        return self


@lru_cache
def get_settings() -> Settings:
    """Cached settings singleton."""
    return Settings()
