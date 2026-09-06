/**
 * Authentication Store for Credify™ Next.js
 * Supports both Google OAuth SSO and Classic Credentials.
 */

import { create } from 'zustand';

const API_BASE = '/api';
const TOKEN_KEY = 'credify_auth_token';
const SESSION_TOKEN_KEY = 'credify_session_token';
const USER_INFO_KEY = 'credify_user_info';
const REMEMBERED_USER_KEY = 'credify_remembered_username';

export interface UserProfile {
  username: string;
  email: string;
  picture?: string;
  googleAccessToken?: string;
}

interface AuthState {
  isAuthenticated: boolean;
  isLoading: boolean;
  token: string | null;
  user: UserProfile | null;

  login: (username: string, password: string, rememberMe: boolean) => Promise<boolean>;
  loginWithGoogle: (credential?: string, accessToken?: string, rememberMe?: boolean) => Promise<boolean>;
  logout: () => void;
  checkAuth: () => Promise<boolean>;
  initialize: () => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  isAuthenticated: false,
  isLoading: true,
  token: null,
  user: null,

  login: async (username: string, password: string, rememberMe: boolean): Promise<boolean> => {
    try {
      const response = await fetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, rememberMe }),
      });

      if (!response.ok) return false;

      const data = await response.json();
      const token = data.token;
      const user: UserProfile = {
        username: data.username,
        email: data.username.includes('@') ? data.username : `${data.username}@credify.local`,
      };

      if (rememberMe) {
        localStorage.setItem(TOKEN_KEY, token);
        localStorage.setItem(USER_INFO_KEY, JSON.stringify(user));
        localStorage.setItem(REMEMBERED_USER_KEY, data.username);
        sessionStorage.removeItem(SESSION_TOKEN_KEY);
        sessionStorage.removeItem(USER_INFO_KEY);
      } else {
        sessionStorage.setItem(SESSION_TOKEN_KEY, token);
        sessionStorage.setItem(USER_INFO_KEY, JSON.stringify(user));
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(USER_INFO_KEY);
        localStorage.removeItem(REMEMBERED_USER_KEY);
      }

      set({ isAuthenticated: true, token, user, isLoading: false });
      return true;
    } catch {
      return false;
    }
  },

  loginWithGoogle: async (credential?: string, accessToken?: string, rememberMe = true): Promise<boolean> => {
    try {
      const response = await fetch(`${API_BASE}/auth/google`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential, accessToken }),
      });

      if (!response.ok) return false;

      const data = await response.json();
      const token = data.token;
      const user: UserProfile = {
        username: data.username,
        email: data.email,
        picture: data.picture,
        googleAccessToken: data.accessToken || accessToken,
      };

      if (rememberMe) {
        localStorage.setItem(TOKEN_KEY, token);
        localStorage.setItem(USER_INFO_KEY, JSON.stringify(user));
        sessionStorage.removeItem(SESSION_TOKEN_KEY);
        sessionStorage.removeItem(USER_INFO_KEY);
      } else {
        sessionStorage.setItem(SESSION_TOKEN_KEY, token);
        sessionStorage.setItem(USER_INFO_KEY, JSON.stringify(user));
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(USER_INFO_KEY);
      }

      set({ isAuthenticated: true, token, user, isLoading: false });
      return true;
    } catch {
      return false;
    }
  },

  logout: () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_INFO_KEY);
    localStorage.removeItem('certify_auth_token');
    localStorage.removeItem('certify_user_info');
    sessionStorage.removeItem(SESSION_TOKEN_KEY);
    sessionStorage.removeItem(USER_INFO_KEY);
    sessionStorage.removeItem('certify_session_token');
    sessionStorage.removeItem('certify_user_info');
    // Note: REMEMBERED_USER_KEY is kept so returning users have their username prefilled
    set({ isAuthenticated: false, token: null, user: null, isLoading: false });
  },

  checkAuth: async (): Promise<boolean> => {
    const { token } = get();
    if (!token) {
      set({ isAuthenticated: false, isLoading: false });
      return false;
    }

    try {
      const response = await fetch(`${API_BASE}/auth/verify`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
      });

      if (response.ok) {
        set({ isAuthenticated: true, isLoading: false });
        return true;
      } else {
        get().logout();
        return false;
      }
    } catch {
      set({ isAuthenticated: false, isLoading: false });
      return false;
    }
  },

  initialize: async () => {
    if (typeof window === 'undefined') return;

    const storedToken =
      localStorage.getItem(TOKEN_KEY) ||
      sessionStorage.getItem(SESSION_TOKEN_KEY) ||
      localStorage.getItem('certify_auth_token') ||
      sessionStorage.getItem('certify_session_token');
    const userStr =
      localStorage.getItem(USER_INFO_KEY) ||
      sessionStorage.getItem(USER_INFO_KEY) ||
      localStorage.getItem('certify_user_info') ||
      sessionStorage.getItem('certify_user_info');

    let user: UserProfile | null = null;
    if (userStr) {
      try {
        user = JSON.parse(userStr);
      } catch {
        user = null;
      }
    }

    if (storedToken) {
      set({ token: storedToken, user, isLoading: true });
      try {
        const response = await fetch(`${API_BASE}/auth/verify`, {
          method: 'GET',
          headers: { Authorization: `Bearer ${storedToken}` },
        });

        if (response.ok) {
          set({ isAuthenticated: true, isLoading: false });
        } else {
          get().logout();
        }
      } catch {
        get().logout();
      }
    } else {
      set({ isAuthenticated: false, isLoading: false });
    }
  },
}));
