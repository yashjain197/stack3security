import { Container } from "@cloudflare/containers";

// Names copied from the Chrome API settings. Values come from Worker secrets, never from this file.
const PASSTHROUGH = [
  "ENV",
  "LOG_LEVEL",
  "DOCS_ENABLED",
  "API_BASE_URL",
  "WEB_APP_URL",
  "CORS_ORIGINS",
  "CHROME_EXTENSION_IDS",
  "DATABASE_URL",
  "DB_POOL_SIZE",
  "DB_MAX_OVERFLOW",
  "DB_SCHEMA",
  "JWT_ISSUER",
  "JWT_PRIVATE_KEY",
  "JWT_KEY_ID",
  "ACCESS_TOKEN_TTL_SECONDS",
  "COOKIE_SECURE",
  "COOKIE_SAMESITE",
  "OTP_PEPPER",
  "INTERNAL_SERVICE_KEY",
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_USERNAME",
  "SMTP_PASSWORD",
  "EMAIL_FROM",
  "TIGERGRAPH_HOST",
  "TIGERGRAPH_GRAPH",
  "TIGERGRAPH_USERNAME",
  "TIGERGRAPH_PASSWORD",
  "TIGERGRAPH_SECRET",
  "DODO_ENVIRONMENT",
  "DODO_API_KEY",
  "DODO_WEBHOOK_SECRET",
  "DODO_TRIAL_DAYS",
  "DODO_PRODUCT_PRO_MONTHLY",
  "DODO_PRODUCT_PRO_YEARLY",
  "DODO_PRODUCT_TEAM_MONTHLY",
  "DODO_PRODUCT_TEAM_YEARLY",
  "DODO_ADDON_TEAM_SEAT_MONTHLY",
  "DODO_ADDON_TEAM_SEAT_YEARLY",
  "ETHERSCAN_API_KEY",
  "RPC_URL_ETHEREUM",
  "SOCKET_API_KEY",
  "RDAP_REMOTE",
];

export class ApiContainer extends Container {
  defaultPort = 8000;
  sleepAfter = "15m";

  constructor(ctx, env) {
    super(ctx, env);
    const vars = {
      PORT: "8000",
      WEB_CONCURRENCY: "1",
      FORWARDED_ALLOW_IPS: "*",
      DB_SCHEMA: "chrome",
    };
    for (const key of PASSTHROUGH) {
      if (typeof env[key] === "string" && env[key] !== "") vars[key] = env[key];
    }
    this.envVars = vars;
  }
}

export default {
  async fetch(request, env) {
    return env.API.getByName("stack3-api").fetch(request);
  },
};
