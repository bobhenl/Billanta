/**
 * The visitor's IP as seen by our own reverse proxy. Caddy appends the real
 * client address as the LAST `X-Forwarded-For` entry; anything before it was
 * sent by the client and can be forged, so it is never used for rate limits.
 */
export function clientIp(request: { headers: Pick<Headers, 'get'> }): string {
  const forwarded = request.headers.get('x-forwarded-for');
  const last = forwarded?.split(',').map((part) => part.trim()).filter(Boolean).pop();
  return last ?? request.headers.get('x-real-ip') ?? '';
}
