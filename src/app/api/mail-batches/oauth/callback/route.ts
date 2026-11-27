import { NextRequest, NextResponse } from 'next/server';
import { requireIssuer } from '../../../../../lib/issuer-auth';
import { log, requestIdOf } from '../../../../../lib/logger';
import {
  completeBatchOAuthCallback,
  MailBatchError,
  WORKER_OAUTH_COOKIE,
} from '../../../../../lib/mail-batches';

function clearBindingCookie(response: NextResponse, secure: boolean) {
  response.cookies.set(WORKER_OAUTH_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/api/mail-batches/oauth/callback',
    maxAge: 0,
  });
  return response;
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const secure = url.protocol === 'https:';
  const callbackPage = new URL('/mail-batches/callback', url.origin);

  const oauthError = url.searchParams.get('error');
  if (oauthError) {
    callbackPage.searchParams.set('status', 'error');
    callbackPage.searchParams.set('reason', oauthError === 'access_denied' ? 'cancelled' : 'provider_error');
    return clearBindingCookie(NextResponse.redirect(callbackPage), secure);
  }

  const { user, denial } = await requireIssuer(request);
  if (denial) {
    callbackPage.searchParams.set('status', 'error');
    callbackPage.searchParams.set('reason', 'unauthorized');
    return clearBindingCookie(NextResponse.redirect(callbackPage), secure);
  }

  const state = url.searchParams.get('state') ?? '';
  const code = url.searchParams.get('code') ?? '';
  if (!state || !code || state.length > 512 || code.length > 4096) {
    callbackPage.searchParams.set('status', 'error');
    callbackPage.searchParams.set('reason', 'invalid_callback');
    return clearBindingCookie(NextResponse.redirect(callbackPage), secure);
  }

  const bindingCookie = request.cookies.get(WORKER_OAUTH_COOKIE)?.value;
  try {
    const { batchId, eventId } = await completeBatchOAuthCallback({
      user,
      state,
      code,
      bindingCookie,
    });
    callbackPage.searchParams.set('status', 'authorized');
    callbackPage.searchParams.set('batchId', batchId);
    callbackPage.searchParams.set('eventId', eventId);
    return clearBindingCookie(NextResponse.redirect(callbackPage), secure);
  } catch (error) {
    log.warn('mail-batches', 'Batch OAuth callback rejected', {
      requestId: requestIdOf(request),
      userId: user.userId,
      status: error instanceof MailBatchError ? error.status : 500,
    });
    callbackPage.searchParams.set('status', 'error');
    callbackPage.searchParams.set('reason', error instanceof MailBatchError ? 'rejected' : 'failed');
    return clearBindingCookie(NextResponse.redirect(callbackPage), secure);
  }
}
