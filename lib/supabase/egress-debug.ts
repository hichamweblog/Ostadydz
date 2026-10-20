type EgressBucket = {
  requests: number;
  responseBytes: number;
  requestBytes: number;
  lastStatus?: number;
};

const buckets = new Map<string, EgressBucket>();

function getBucket(url: string): EgressBucket {
  const current = buckets.get(url);
  if (current) return current;
  const created: EgressBucket = { requests: 0, responseBytes: 0, requestBytes: 0 };
  buckets.set(url, created);
  return created;
}

function getRequestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function getRequestBytes(input: RequestInfo | URL, init?: RequestInit): number {
  const body = init?.body ?? (input instanceof Request ? input.body : null);
  if (typeof body === 'string') return new TextEncoder().encode(body).byteLength;
  return 0;
}

export function createEgressDebugFetch(baseFetch: typeof fetch): typeof fetch {
  return async (input, init) => {
    const requestUrl = new URL(getRequestUrl(input), window.location.origin);
    const path = requestUrl.pathname;
    const bucket = getBucket(path);
    bucket.requests += 1;
    bucket.requestBytes += getRequestBytes(input, init);

    const startedAt = performance.now();
    const response = await baseFetch(input, init);

    void response
      .clone()
      .arrayBuffer()
      .then((body) => {
        bucket.responseBytes += body.byteLength;
        bucket.lastStatus = response.status;
        console.debug('[Supabase egress]', {
          path,
          status: response.status,
          responseBytes: body.byteLength,
          durationMs: Math.round(performance.now() - startedAt),
        });
      })
      .catch((error: unknown) => {
        console.warn('[Supabase egress] Could not measure response body', { path, error });
      });

    return response;
  };
}

export function printEgressDebugSummary(): void {
  console.table(
    Array.from(buckets, ([path, values]) => ({
      path,
      requests: values.requests,
      responseKiB: Math.round((values.responseBytes / 1024) * 10) / 10,
      requestKiB: Math.round((values.requestBytes / 1024) * 10) / 10,
      lastStatus: values.lastStatus ?? '',
    })).sort((a, b) => b.responseKiB - a.responseKiB),
  );
}
