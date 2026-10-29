/**
 * Part of every scan id (scanId = sha256(url + sha + ENGINE_VERSION)). Bump it whenever a rule, a parser or the
 * aggregation changes what a scan can report, so an older verdict is never reused for the same commit.
 */
export const ENGINE_VERSION = '1';
