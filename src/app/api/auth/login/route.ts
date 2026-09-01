import { NextResponse } from 'next/server';
import { AUTH_USERNAME, AUTH_PASSWORD, createJwtToken } from '../../../../lib/server-auth';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { username, password } = body;

    if (username !== AUTH_USERNAME || password !== AUTH_PASSWORD) {
      return NextResponse.json({ detail: 'Invalid username or password' }, { status: 401 });
    }

    const token = createJwtToken(username);

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
