// Scan bounds. In their own file so the server, which has no VS Code, can use them.

export interface ScanLimits {
  maxFiles: number;
  maxFileBytes: number;
  maxTotalBytes: number;
  maxDepth: number;
  timeoutMs: number;
}

export const DEFAULT_LIMITS: Readonly<ScanLimits> = Object.freeze({
  maxFiles: 20000,
  maxFileBytes: 1048576,
  maxTotalBytes: 52428800,
  maxDepth: 32,
  timeoutMs: 30000,
});
