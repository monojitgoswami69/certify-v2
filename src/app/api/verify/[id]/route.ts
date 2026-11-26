import { NextResponse } from 'next/server';
import { checkRateLimit, getClientIp } from '../../../../lib/rate-limit';
import { getSessionFromRequest } from '../../../../lib/server-auth';
import { env, isDevelopment } from '../../../../lib/env';
import { requestIdOf } from '../../../../lib/logger';
import { verificationMaintenanceResponse } from '../../../../lib/verification-maintenance';
import { resolveCertificateVerification } from '../../../../lib/verify-service';

/**
 * Public certificate verification endpoint backing `/verify/[id]` API calls.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (env.VERIFY_MAINTENANCE) return verificationMaintenanceResponse();
  const { id } = await params;

  const rateLimitMax = isDevelopment() ? 300 : 60;
  const rate = checkRateLimit(`verify:${getClientIp(request)}`, rateLimitMax, 60_000);
  if (!rate.allowed) {
    return NextResponse.json(
      { status: 'rate_limited', detail: 'Too many verification requests. Try again shortly.' },
      { status: 429, headers: { 'Retry-After': String(rate.retryAfterSec) } }
    );
  }

  const result = await resolveCertificateVerification({
    rawId: id,
    session: getSessionFromRequest(request),
    requestId: requestIdOf(request),
  });

  return NextResponse.json(
    result.payload,
    {
      status: result.httpStatus,
      ...(result.headers ? { headers: result.headers } : {}),
    }
  );
}
