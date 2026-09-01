import { NextResponse } from 'next/server';
import { OAuth2Client } from 'google-auth-library';
import { getAuthUserFromRequest, unauthorizedResponse } from '../../../../../lib/server-auth';
import { storeGoogleCredentials } from '../../../../../lib/google-token-store';

const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const REDIRECT_URI = 'postmessage';

export async function POST(request: Request) {
  const username = getAuthUserFromRequest(request);
  if (!username) {
    return unauthorizedResponse('Invalid or expired token');
  }

  let code: string;
  try {
    const body = await request.json();
    code = body?.code;
  } catch {
    return NextResponse.json({ detail: 'Invalid request body' }, { status: 400 });
  }

  if (!code) {
    return NextResponse.json({ detail: 'Authorization code is required' }, { status: 400 });
  }

  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    return NextResponse.json(
      { detail: 'Google OAuth client ID/secret not configured on the server' },
      { status: 500 }
    );
  }

  try {
    const oauth = new OAuth2Client({
      clientId: GOOGLE_CLIENT_ID,
      clientSecret: GOOGLE_CLIENT_SECRET,
      redirectUri: REDIRECT_URI,
    });

    const { tokens } = await oauth.getToken(code);
    if (!tokens.access_token && !tokens.refresh_token) {
      return NextResponse.json({ detail: 'Google did not return any usable tokens' }, { status: 400 });
    }

    oauth.setCredentials(tokens);

    // Resolve connected account info from Google via the userinfo endpoint
    // (avoids a googleapis typing conflict between the two OAuth2Client types).
    let email = username;
    let name = username;
    let picture = '';
    try {
      const userRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      if (userRes.ok) {
        const info = await userRes.json();
        if (info.email) email = info.email;
        if (info.name) name = info.name;
        if (info.picture) picture = info.picture;
      }
    } catch (err) {
      console.warn('[Google tokens] userinfo lookup failed:', err);
    }

    storeGoogleCredentials(username, {
      access_token: tokens.access_token ?? null,
      refresh_token: tokens.refresh_token ?? null,
      expiry_date: tokens.expiry_date ?? null,
      scope: tokens.scope ?? null,
      token_type: tokens.token_type ?? null,
      email,
    });

    return NextResponse.json({
      email,
      name,
      picture,
      accessToken: tokens.access_token ?? null,
      hasRefreshToken: Boolean(tokens.refresh_token),
      message: 'Google account connected',
    });
  } catch (error) {
    console.error('[Google token exchange error]:', error);
    return NextResponse.json(
      { detail: error instanceof Error ? error.message : 'Failed to exchange Google authorization code' },
      { status: 400 }
    );
  }
}
