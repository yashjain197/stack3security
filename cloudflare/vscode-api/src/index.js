import { Container } from "@cloudflare/containers";

export class ScanContainer extends Container {
  defaultPort = 8080;
  sleepAfter = "15m";

  constructor(ctx, env) {
    super(ctx, env);
    const vars = {
      PORT: "8080",
      NODE_ENV: "production",
      SERVICE_KEY: env.SERVICE_KEY,
      STACK3_API_URL: env.STACK3_API_URL,
    };
    if (typeof env.SOCKET_API_KEY === "string" && env.SOCKET_API_KEY !== "") {
      vars.SOCKET_API_KEY = env.SOCKET_API_KEY;
    }
    if (typeof env.SOCKET_ORG_SLUG === "string" && env.SOCKET_ORG_SLUG !== "") {
      vars.SOCKET_ORG_SLUG = env.SOCKET_ORG_SLUG;
    }
    for (const key of ["MAX_CONCURRENT_SCANS", "MAX_QUEUED_SCANS", "SCAN_TIMEOUT_MS", "CACHE_TTL_MS"]) {
      if (typeof env[key] === "string" && env[key] !== "") vars[key] = env[key];
    }
    this.envVars = vars;
  }
}

export default {
  async fetch(request, env) {
    return env.SCAN.getByName("stack3-scan").fetch(request);
  },
};
