/**
 * Authentication Store for Certify™ Next.js
 * Supports both Google OAuth SSO and Classic Credentials.
 */

import { create } from 'zustand';
import { useAppStore } from './useAppStore';
import { useHistoryStore } from './useHistoryStore';
import { getAuthToken } from '../lib/api-client';
import type { PlatformRole } from '../lib/access-role';

const API_BASE = '/api';
const TOKEN_KEY = 'certify_auth_token';
const SESSION_TOKEN_KEY = 'certify_session_token';
const USER_INFO_KEY = 'certify_user_info';
const REMEMBERED_USER_KEY = 'certify_remembered_username';

let inFlightVerifyPromise: Promise<boolean> | null = null;
let authRevision = 0;

function isUserProfile(value: unknown): value is UserProfile {
  if (!value || typeof value !== 'object') return false;
  const user = value as Partial<UserProfile>;
  return typeof user.userId === 'string' && typeof user.email === 'string' && typeof user.name === 'string';
}

function persistUser(user: UserProfile) {
  const serialized = JSON.stringify(user);
  // The session token lives in an HttpOnly cookie; only the non-sensitive
  // profile cache is kept for fast UI restore on the next load.
  if (localStorage.getItem(USER_INFO_KEY)) localStorage.setItem(USER_INFO_KEY, serialized);
  else sessionStorage.setItem(USER_INFO_KEY, serialized);
}

function storeSession(_token: string, user: UserProfile, rememberMe: boolean, rememberedEmail: string) {
  const serialized = JSON.stringify(user);
  localStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(SESSION_TOKEN_KEY);
  if (rememberMe) {
    localStorage.setItem(USER_INFO_KEY, serialized);
    localStorage.setItem(REMEMBERED_USER_KEY, rememberedEmail);
    sessionStorage.removeItem(USER_INFO_KEY);
  } else {
    sessionStorage.setItem(USER_INFO_KEY, serialized);
    localStorage.removeItem(USER_INFO_KEY);
    localStorage.removeItem(REMEMBERED_USER_KEY);
  }
}

function clearLocalSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_INFO_KEY);
  localStorage.removeItem('credify_auth_token');
  localStorage.removeItem('credify_user_info');
  sessionStorage.removeItem(SESSION_TOKEN_KEY);
  sessionStorage.removeItem(USER_INFO_KEY);
  sessionStorage.removeItem('credify_session_token');
  sessionStorage.removeItem('credify_user_info');
  // Note: REMEMBERED_USER_KEY is kept so returning users have their username prefilled
  // Drop the previous user's workspace and Gmail connection so they never leak to the next session
  useAppStore.getState().reset();
  useAppStore.getState().setConnectedGoogleAccount(null);
  useHistoryStore.getState().clearHistory();
}

async function readError(response: Response, fallback: string): Promise<string> {
  const data = await response.json().catch(() => ({}));
  return typeof data.detail === 'string' ? data.detail : fallback;
}

export interface UserProfile {
  userId: string;
  email: string;
  name: string;
  issuedByName: string;
  picture: string | null;
  role: 'user' | 'admin';
  platformRole?: PlatformRole;
  canIssueCertificates?: boolean;
}

interface AuthState {
  isAuthenticated: boolean;
  isLoading: boolean;
  token: string | null;
  user: UserProfile | null;

  login: (email: string, password: string, rememberMe: boolean) => Promise<boolean>;
  loginWithGoogle: (credential?: string, accessToken?: string, rememberMe?: boolean) => Promise<boolean>;
  updateProfile: (patch: { name?: string; issuedByName?: string }) => Promise<void>;
  logout: () => void;
  checkAuth: () => Promise<boolean>;
  initialize: () => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  isAuthenticated: false,
  isLoading: true,
  token: null,
  user: null,

  login: async (email: string, password: string, rememberMe: boolean): Promise<boolean> => {
    const response = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Certify-Request': '1' },
      body: JSON.stringify({ email, password, rememberMe }),
    });

    if (!response.ok) throw new Error(await readError(response, 'Invalid email or password'));

    const data = await response.json();
    if (!isUserProfile(data.user) || typeof data.token !== 'string') {
      throw new Error('Sign-in response was incomplete');
    }
    authRevision++;
    inFlightVerifyPromise = null;
    storeSession(data.token, data.user, rememberMe, email);
    set({ isAuthenticated: true, token: data.token, user: data.user, isLoading: false });
    return true;
  },

  loginWithGoogle: async (credential?: string, accessToken?: string, rememberMe = true): Promise<boolean> => {
    const response = await fetch(`${API_BASE}/auth/google`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Certify-Request': '1' },
      body: JSON.stringify({ credential, accessToken, rememberMe }),
    });

    if (!response.ok) throw new Error(await readError(response, 'Google sign-in failed'));

    const data = await response.json();
    if (!isUserProfile(data.user) || typeof data.token !== 'string') {
      throw new Error('Google sign-in response was incomplete');
    }
    authRevision++;
    inFlightVerifyPromise = null;
    storeSession(data.token, data.user, rememberMe, data.user.email);
    set({ isAuthenticated: true, token: data.token, user: data.user, isLoading: false });
    return true;
  },

  updateProfile: async (patch) => {
    if (!get().isAuthenticated) throw new Error('You are not signed in');
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Certify-Request': '1',
    };
    const legacyToken = typeof window !== 'undefined' ? getAuthToken() : null;
    if (legacyToken) headers.Authorization = `Bearer ${legacyToken}`;
    const response = await fetch(`${API_BASE}/user/profile`, {
      method: 'PATCH',
      credentials: 'same-origin',
      headers,
      body: JSON.stringify(patch),
    });
    if (!response.ok) throw new Error(await readError(response, 'Failed to update profile'));
    const data = await response.json();
    if (!isUserProfile(data.user)) throw new Error('Profile response was incomplete');
    persistUser(data.user);
    set({ user: data.user });
  },

  logout: () => {
    // Invalidate every session issued before now (server-side) and clear the
    // HttpOnly cookie, best-effort — the local reset below proceeds regardless.
    const headers: Record<string, string> = { 'X-Certify-Request': '1' };
    const legacyToken = typeof window !== 'undefined' ? getAuthToken() : null;
    if (legacyToken) headers.Authorization = `Bearer ${legacyToken}`;
    fetch(`${API_BASE}/auth/logout`, { method: 'POST', credentials: 'same-origin', headers }).catch(
      () => undefined
    );
    authRevision++;
    inFlightVerifyPromise = null;
    clearLocalSession();
    set({ isAuthenticated: false, token: null, user: null, isLoading: false });
  },

  checkAuth: async (): Promise<boolean> => {
    if (inFlightVerifyPromise) return inFlightVerifyPromise;

    const revision = authRevision;
    inFlightVerifyPromise = (async () => {
      try {
        const token = getAuthToken();
        const response = await fetch(`${API_BASE}/auth/verify`, {
          credentials: 'same-origin',
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (revision !== authRevision) return get().isAuthenticated;
        if (response.status === 401 || response.status === 403) {
          clearLocalSession();
          set({ isAuthenticated: false, token: null, user: null, isLoading: false });
          return false;
        }
        if (response.ok) {
          const data = await response.json();
          if (revision !== authRevision) return get().isAuthenticated;
          if (isUserProfile(data.user)) {
            persistUser(data.user);
            set({ isAuthenticated: true, isLoading: false, user: data.user });
            return true;
          }
        }
      } catch {
        // A transient failure should leave a previously verified session intact.
      } finally {
        if (revision === authRevision) {
          inFlightVerifyPromise = null;
          set({ isLoading: false });
        }
      }
      return get().isAuthenticated;
    })();
    return inFlightVerifyPromise;
  },

  initialize: async () => {
    if (typeof window === 'undefined' || get().isAuthenticated) return;
    set({ isLoading: true });
    await get().checkAuth();
  },
}));
