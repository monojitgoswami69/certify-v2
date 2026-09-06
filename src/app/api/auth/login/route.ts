import { NextResponse } from 'next/server';
import { createHash, timingSafeEqual } from 'crypto';
import { AUTH_USERNAME, AUTH_PASSWORD, createJwtToken } from '../../../../lib/server-auth';

function safeCompare(a: string, b: string): boolean {
  const hashA = createHash('sha256').update(a).digest();
  const hashB = createHash('sha256').update(b).digest();
  return timingSafeEqual(hashA, hashB);
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { username, password, rememberMe = true } = body;

    const userMatch = typeof username === 'string' && safeCompare(username, AUTH_USERNAME);
    const passMatch = typeof password === 'string' && safeCompare(password, AUTH_PASSWORD);

    if (!userMatch || !passMatch) {
      return NextResponse.json({ detail: 'Invalid username or password' }, { status: 401 });
    }

    const token = createJwtToken(username, Boolean(rememberMe));

    return NextResponse.json({
      token,
      username,
      message: 'Login successful',
    });
  } catch (error) {
    return NextResponse.json(
      { detail: error instanceof Error ? error.message : 'Invalid request' },
      { status: 400 }
    );
  }
}
