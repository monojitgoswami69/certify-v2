import { NextResponse } from 'next/server';
import { requireIssuer } from '../../../../../lib/issuer-auth';
import { env } from '../../../../../lib/env';
import { checkRateLimit } from '../../../../../lib/rate-limit';
import { forbiddenCsrfResponse, mutationAllowed } from '../../../../../lib/server-auth';
import { isPublicOrigin } from '../../../../../lib/verification-links';
import { log, requestIdOf } from '../../../../../lib/logger';
import {
  MailBatchError,
  startBatchOAuthAuthorization,
  WORKER_OAUTH_COOKIE,
} from '../../../../../lib/mail-batches';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ batchId: string }> }
) {
  if (!mutationAllowed(request)) return forbiddenCsrfResponse();
  const { user, denial } = await requireIssuer(request);
  if (denial) return denial;

  const rate = checkRateLimit(`mail-batch:auth:${user.userId}`, 15, 60_000);
  if (!rate.allowed) {
    return NextResponse.json(
      { detail: 'Too many authorization attempts. Try again shortly.' },
      { status: 429, headers: { 'Retry-After': String(rate.retryAfterSec) } }
    );
  }

  const configuredOrigin = new URL(env.NEXT_PUBLIC_APP_URL).origin;
  const origin = request.headers.get('origin') ?? configuredOrigin;
  const knownPublic = isPublicOrigin(configuredOrigin) && isPublicOrigin(origin);
  const localDev = env.NODE_ENV !== 'production' && origin === new URL(request.url).origin;
  if (origin !== configuredOrigin && !knownPublic && !localDev) {
    return NextResponse.json({ detail: 'Authorization must start from the WeCertify origin' }, { status: 403 });
  }

  const { batchId } = await params;
  try {
    const { authUrl, bindingCookie } = await startBatchOAuthAuthorization({
      user,
      batchId,
      origin,
    });
    const response = NextResponse.json({ authUrl }, { headers: { 'Cache-Control': 'no-store' } });
    response.cookies.set(WORKER_OAUTH_COOKIE, bindingCookie, {
      httpOnly: true,
      sameSite: 'lax',
      secure: origin.startsWith('https://'),
      path: '/api/mail-batches/oauth/callback',
      maxAge: 600,
    });
    return response;
  } catch (error) {
    if (error instanceof MailBatchError) {
      return NextResponse.json({ detail: error.message }, { status: error.status });
    }
    log.error('mail-batches', 'Failed to start batch OAuth', { requestId: requestIdOf(request), userId: user.userId, batchId }, error);
    return NextResponse.json({ detail: 'Could not initialize Gmail authorization.' }, { status: 500 });
  }
}
