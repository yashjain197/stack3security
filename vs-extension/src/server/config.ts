export class ConfigError extends Error {}

export interface ServerConfig {
  /** Shared secret for the internal routes (X-Service-Key), in both directions. */
  serviceKey: string;
  /** Base URL of the Stack3 API (Yash's), where reports are sent. */
  apiUrl: string;
  port: number;
  maxConcurrent: number;
  maxQueue: number;
  scanTimeoutMs: number;
  cacheTtlMs: number;
}

function integer(env: Record<string, string | undefined>, name: string, fallback: number, min: number, max: number): number {
  const raw = env[name];
  if (raw === undefined) return fallback;
  if (!/^\d+$/.test(raw) || Number(raw) < min || Number(raw) > max) throw new ConfigError(`${name} must be a whole number from ${min} to ${max}.`);
  return Number(raw);
}

/**
 * Settings come from the environment. The service refuses to start without a service key rather than run open, and no
 * error message ever echoes a value.
 */
export function loadConfig(env: Record<string, string | undefined>): ServerConfig {
  const key = env.SERVICE_KEY;
  if (!key) throw new ConfigError('SERVICE_KEY is required.');
  if (key.length < 16) throw new ConfigError('SERVICE_KEY must be at least 16 characters.');

  let apiUrl = 'http://localhost:8000';
  if (env.STACK3_API_URL !== undefined) {
    let url: URL;
    try {
      url = new URL(env.STACK3_API_URL);
    } catch {
      throw new ConfigError('STACK3_API_URL must be an http or https URL.');
    }
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) throw new ConfigError('STACK3_API_URL must be an http or https URL without credentials.');
    apiUrl = `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
  }

  return {
    serviceKey: key,
    apiUrl,
    port: integer(env, 'PORT', 8080, 1, 65535),
    maxConcurrent: integer(env, 'MAX_CONCURRENT_SCANS', 2, 1, 8),
    maxQueue: integer(env, 'MAX_QUEUED_SCANS', 8, 0, 100),
    scanTimeoutMs: integer(env, 'SCAN_TIMEOUT_MS', 90_000, 1000, 600_000),
    cacheTtlMs: integer(env, 'CACHE_TTL_MS', 300_000, 0, 3_600_000),
  };
}
