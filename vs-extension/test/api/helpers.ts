export interface Call {
  url: string;
  init: RequestInit;
  body: unknown;
}

export const reply = (body: unknown, init: ResponseInit = {}): Response =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' }, ...init });

type Step = Response | Error | (() => Response | Promise<Response>);

/** A fake fetch that records every call and plays back `steps` in order. */
export function recorder(...steps: Step[]): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fakeFetch = (async (url: string | URL | Request, init: RequestInit = {}) => {
    calls.push({ url: String(url), init, body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined });
    const step = steps[Math.min(calls.length - 1, steps.length - 1)];
    if (step === undefined) throw new Error('no response scripted');
    if (step instanceof Error) throw step;
    return typeof step === 'function' ? step() : step.clone();
  }) as typeof fetch;
  return { fetch: fakeFetch, calls };
}

/** Never answers; rejects when the request is aborted, like a real fetch. */
export const hang: typeof fetch = (_url, init) =>
  new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));

/** A response whose body streams `chunk` `times` times, then ends. */
export function streamOf(chunk: Uint8Array, times: number, headers: Record<string, string> = {}): { response: Response; cancelled: () => boolean } {
  let sent = 0;
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent++ < times) controller.enqueue(chunk);
      else controller.close();
    },
    cancel() {
      cancelled = true;
    },
  });
  return { response: new Response(body, { status: 200, headers }), cancelled: () => cancelled };
}
