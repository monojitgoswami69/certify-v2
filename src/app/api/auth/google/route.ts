import { NextResponse } from 'next/server';
import { OAuth2Client } from 'google-auth-library';
import { createJwtToken } from '../../../../lib/server-auth';

const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || '';
const client = new OAuth2Client(GOOGLE_CLIENT_ID);

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { credential, accessToken } = body;

    let email = '';
    let name = '';
    let picture = '';

    if (credential) {
      // Verify Google ID Token (from Google One Tap or Google Login Button)
      const ticket = await client.verifyIdToken({
        idToken: credential,
        audience: GOOGLE_CLIENT_ID || undefined,
      });
      const payload = ticket.getPayload();
      if (!payload || !payload.email) {
        return NextResponse.json({ detail: 'Invalid Google token payload' }, { status: 400 });
      }
      email = payload.email;
      name = payload.name || payload.email.split('@')[0];
      picture = payload.picture || '';
    } else if (accessToken) {
      // Fetch User Info using OAuth2 Access Token
      const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) {
        return NextResponse.json({ detail: 'Failed to verify Google access token' }, { status: 400 });
      }
      const data = await res.json();
      email = data.email;
      name = data.name || data.email.split('@')[0];
      picture = data.picture || '';
    } else {
      return NextResponse.json({ detail: 'Google token or credential required' }, { status: 400 });
    }

    // Create session JWT token for Certify™ app
    const token = createJwtToken(email);

    return NextResponse.json({
      token,
      username: name,
      email,
      picture,
      accessToken: accessToken || null,
      message: 'Google Sign-In successful',
    });
  } catch (error) {
    console.error('[Google OAuth Error]:', error);
    return NextResponse.json(
      { detail: error instanceof Error ? error.message : 'Google authentication failed' },
      { status: 400 }
    );
  }
}
