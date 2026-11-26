import { NextResponse } from 'next/server';
import { mutationAllowed, forbiddenCsrfResponse } from '../../../../lib/server-auth';
import { requireIssuer } from '../../../../lib/issuer-auth';
import { env } from '../../../../lib/env';
import { checkRateLimit } from '../../../../lib/rate-limit';
import { legacyVerificationOrigin, selectVerificationOrigin } from '../../../../lib/verification-links';
import { log, requestIdOf } from '../../../../lib/logger';
import {
  registerCertificates,
  RegistrationError,
  type RegisterBatchCommand,
} from '../../../../lib/registration-service';

/** Per-account cap: one user must not be able to monopolize Neon throughput. */
const REGISTER_RATE_LIMIT = 20; // batches per minute

export async function POST(request: Request) {
  if (!mutationAllowed(request)) return forbiddenCsrfResponse();
  const { user, denial } = await requireIssuer(request);
  if (denial) return denial;

  const rate = checkRateLimit(`register:user:${user.userId}`, REGISTER_RATE_LIMIT, 60_000);
  if (!rate.allowed) {
    return NextResponse.json(
      { detail: 'Too many registration batches. Please wait a moment.' },
      { status: 429, headers: { 'Retry-After': String(rate.retryAfterSec) } }
    );
  }

  if (!env.DATABASE_URL) {
    return NextResponse.json(
      { detail: 'Certificate verification is not configured (DATABASE_URL missing)' },
      { status: 503 }
    );
  }

  let body: RegisterBatchCommand;
  try {
    body = (await request.json()) as RegisterBatchCommand;
  } catch {
    return NextResponse.json({ detail: 'Invalid request body' }, { status: 400 });
  }

  try {
    const result = await registerCertificates(user, body, selectVerificationOrigin(request));
    return NextResponse.json({
      ...result, verificationOrigin: result.verificationOrigin ?? legacyVerificationOrigin(request),
    });
  } catch (error) {
    if (error instanceof RegistrationError) {
      return NextResponse.json({ detail: error.message }, { status: error.status });
    }
    log.error('registration', 'Failed to register certificates', { requestId: requestIdOf(request), userId: user.userId }, error);
    return NextResponse.json(
      { detail: 'Failed to register certificates' },
      { status: 500 }
    );
  }
}
