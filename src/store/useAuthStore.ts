/**
 * Authentication Store for Certify™ Next.js
 * Supports both Google OAuth SSO and Classic Credentials.
 */

import { create } from 'zustand';
import { useAppStore } from './useAppStore';
import { useHistoryStore } from './useHistoryStore';
import { getAuthToken } from '../lib/api-client';

const API_BASE = '/api';
const TOKEN_KEY = 'certify_auth_token';
const SESSION_TOKEN_KEY = 'certify_session_token';
const USER_INFO_KEY = 'certify_user_info';
const REMEMBERED_USER_KEY = 'certify_remembered_username';

let inFlightVerifyPromise: Promise<boolean> | null = null;

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
    if (useAppStore.getState().connectedGoogleAccount) {
      fetch(`${API_BASE}/auth/google/tokens`, { method: 'DELETE', credentials: 'same-origin', headers }).catch(
        () => undefined
      );
    }
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
    set({ isAuthenticated: false, token: null, user: null, isLoading: false });
  },

  checkAuth: async (): Promise<boolean> => {
    // The session rides an HttpOnly cookie (with a legacy bearer fallback),
    // so there is nothing to inspect client-side: just ask the server.
    if (inFlightVerifyPromise) {
      return inFlightVerifyPromise;
    }

    inFlightVerifyPromise = (async () => {
      try {
        const headers: Record<string, string> = {};
        const legacyToken = typeof window !== 'undefined' ? getAuthToken() : null;
        if (legacyToken) headers.Authorization = `Bearer ${legacyToken}`;
        const response = await fetch(`${API_BASE}/auth/verify`, {
          method: 'GET',
          credentials: 'same-origin',
          headers,
        });

        if (response.ok) {
          const data = await response.json().catch(() => ({}));
          if (isUserProfile(data.user)) {
            persistUser(data.user);
            set({ isAuthenticated: true, isLoading: false, user: data.user });
          } else {
            set({ isAuthenticated: true, isLoading: false });
          }
          return true;
        } else {
          get().logout();
          return false;
        }
      } catch {
        // Network failure is not proof the session is invalid; every API call still enforces auth
        set({ isAuthenticated: true, isLoading: false });
        return true;
      } finally {
        inFlightVerifyPromise = null;
      }
    })();

    return inFlightVerifyPromise;
  },

  initialize: async () => {
    if (typeof window === 'undefined') return;

    // Legacy sessions (pre-cookie) kept a bearer token in storage; use it as
    // the Authorization fallback. Cookie sessions need nothing client-side.
    const storedToken = getAuthToken();
    const userStr =
      localStorage.getItem(USER_INFO_KEY) || sessionStorage.getItem(USER_INFO_KEY);

    let user: UserProfile | null = null;
    if (userStr) {
      try {
        const parsed = JSON.parse(userStr);
        user = isUserProfile(parsed)
          ? { ...parsed, issuedByName: parsed.issuedByName || parsed.name, picture: parsed.picture ?? null, role: parsed.role === 'admin' ? 'admin' : 'user' }
          : null;
      } catch {
        user = null;
      }
    }

    // If already verified and authenticated, don't refetch
    if (get().isAuthenticated && !get().isLoading) {
      return;
    }

    // Reuse existing in-flight verification if already running
    if (inFlightVerifyPromise) {
      await inFlightVerifyPromise;
      return;
    }

    set({ token: storedToken, user, isLoading: true });

    inFlightVerifyPromise = (async () => {
      try {
        const headers: Record<string, string> = {};
        if (storedToken) headers.Authorization = `Bearer ${storedToken}`;
        const response = await fetch(`${API_BASE}/auth/verify`, {
          method: 'GET',
          credentials: 'same-origin',
          headers,
        });

        if (response.ok) {
          const data = await response.json().catch(() => ({}));
          if (isUserProfile(data.user)) {
            persistUser(data.user);
            set({ isAuthenticated: true, isLoading: false, user: data.user });
          } else {
            set({ isAuthenticated: true, isLoading: false });
          }
          return true;
        } else {
          get().logout();
          return false;
        }
      } catch {
        // Network failure is not proof the session is invalid; every API call still enforces auth
        set({ isAuthenticated: true, isLoading: false });
        return true;
      } finally {
        inFlightVerifyPromise = null;
      }
    })();

    await inFlightVerifyPromise;
  },
}));
