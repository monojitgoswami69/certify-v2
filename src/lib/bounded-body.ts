export class BodyTooLarge extends Error {}

/** Enforce the limit even if the sender omits or understates Content-Length. */
export function boundedBody(source: Request | Response, maxBytes: number): Response {
  if (Number(source.headers.get('content-length')) > maxBytes) {
    void source.body?.cancel().catch(() => {});
    throw new BodyTooLarge();
  }
  let bytes = 0;
  const stream = source.body?.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      bytes += chunk.byteLength;
      if (bytes > maxBytes) throw new BodyTooLarge();
      controller.enqueue(chunk);
    },
  }));
  return new Response(stream, { headers: source.headers });
}
