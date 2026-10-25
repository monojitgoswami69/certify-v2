import { eq } from 'drizzle-orm';
import { db } from './db';
import { users, type UserRow } from '../db/schema';
import { getSessionFromRequest, isAdminEmail } from './server-auth';
import { env } from './env';

export interface PublicUser {
  userId: string;
  email: string;
  name: string;
  issuedByName: string;
  picture: string | null;
  role: 'user' | 'admin';
}

export function toPublicUser(row: UserRow): PublicUser {
  return {
    userId: row.id,
    email: row.email,
    name: row.name,
    issuedByName: row.issuedByName?.trim() || row.name,
    picture: row.picture,
    role: isAdminEmail(row.email) ? 'admin' : 'user',
  };
}

/** Profile photos are rendered in the app, so only https URLs are stored. */
export function safePictureUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return null;
    return url.toString().slice(0, 2000);
  } catch {
    return null;
  }
}

function displayNameFromEmail(email: string): string {
  const local = email.split('@')[0]?.replace(/[._-]+/g, ' ').trim();
  return (local || 'Certify User').slice(0, 120);
}

/** Admin status follows ADMIN_EMAIL, so changing the env var takes effect without a re-login. */
async function syncRole(row: UserRow): Promise<UserRow> {
  const role = isAdminEmail(row.email) ? 'admin' : 'user';
  if (row.role === role) return row;
  const [updated] = await db
    .update(users)
    .set({ role, updatedAt: new Date() })
    .where(eq(users.id, row.id))
    .returning();
  return updated ?? { ...row, role };
}

export async function getUserById(userId: string): Promise<UserRow | null> {
  const [row] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  return row ? syncRole(row) : null;
}

/**
 * Loads the signed-in account from the database. Returns null for a missing,
 * forged, or stale token (for example after the account was deleted, or after
 * a logout that bumped `sessions_valid_after` past the token's issue time).
 */
export async function getAuthenticatedUser(request: Request): Promise<PublicUser | null> {
  const session = getSessionFromRequest(request);
  if (!session || !env.DATABASE_URL) return null;
  const row = await getUserById(session.userId);
  if (!row) return null;
  if (row.sessionsValidAfter && session.issuedAt !== null) {
    const cutoffMs = row.sessionsValidAfter.getTime();
    // iat has second granularity: allow 1s of clock skew on the boundary.
    if (session.issuedAt * 1000 < cutoffMs - 1000) return null;
  }
  return toPublicUser(row);
}

/**
 * Invalidates every session token issued before now for the account
 * ("log out everywhere"). Returns false when the caller was not signed in.
 */
export async function revokeAllSessions(request: Request): Promise<boolean> {
  const session = getSessionFromRequest(request);
  if (!session || !env.DATABASE_URL) return false;
  // The revoking token itself is also invalidated; the client drops it right after.
  await db
    .update(users)
    .set({ sessionsValidAfter: new Date(), updatedAt: new Date() })
    .where(eq(users.id, session.userId));
  return true;
}

/** Finds or creates the admin account used by email/password sign-in. */
export async function ensureAdminUser(): Promise<UserRow> {
  const email = env.ADMIN_EMAIL ?? null;
  if (!email) throw new Error('ADMIN_EMAIL is not configured');

  const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (existing) return syncRole(existing);

  const name = displayNameFromEmail(email);
  // Two simultaneous first logins both miss the SELECT; the unique email index
  // makes exactly one INSERT win, so re-select instead of erroring.
  await db
    .insert(users)
    .values({ email, name, issuedByName: name, role: 'admin' })
    .onConflictDoNothing({ target: users.email });
  const [row] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (row) return syncRole(row);
  throw new Error('Failed to create admin account');
}

/**
 * Creates the account on first Google sign-in. Later sign-ins refresh the
 * photo and admin role, and keep a name or issuer the person has edited.
 */
export async function upsertGoogleUser(identity: {
  email: string;
  name: string;
  picture?: string;
}): Promise<UserRow> {
  const email = identity.email.trim().toLowerCase();
  const name = (identity.name || displayNameFromEmail(email)).trim().slice(0, 120);
  const picture = safePictureUrl(identity.picture);
  const role = isAdminEmail(email) ? 'admin' : 'user';

  const [row] = await db
    .insert(users)
    .values({ email, name, issuedByName: name, picture, role })
    .onConflictDoUpdate({
      target: users.email,
      set: {
        picture,
        role,
        updatedAt: new Date(),
      },
    })
    .returning();
  return row;
}

export async function updateUserProfile(
  userId: string,
  patch: { name?: string; issuedByName?: string }
): Promise<UserRow | null> {
  const values: { name?: string; issuedByName?: string | null; updatedAt: Date } = {
    updatedAt: new Date(),
  };

  if (patch.name !== undefined) {
    const name = patch.name.trim().slice(0, 120);
    if (!name) {
      throw new Error('Name cannot be empty');
    }
    values.name = name;
  }

  if (patch.issuedByName !== undefined) {
    const issuedByName = patch.issuedByName.trim().slice(0, 120);
    values.issuedByName = issuedByName || null;
  }

  const [row] = await db.update(users).set(values).where(eq(users.id, userId)).returning();
  return row ? syncRole(row) : null;
}
