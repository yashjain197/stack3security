import { Container } from "@cloudflare/containers";

export class WebContainer extends Container {
  defaultPort = 3000;
  sleepAfter = "15m";

  constructor(ctx, env) {
    super(ctx, env);
    this.envVars = {
      PORT: "3000",
      HOST: "0.0.0.0",
      NODE_ENV: "production",
      API_BASE_URL: env.API_BASE_URL,
    };
  }
}

export default {
  async fetch(request, env) {
    return env.WEB.getByName("stack3-web").fetch(request);
  },
};
