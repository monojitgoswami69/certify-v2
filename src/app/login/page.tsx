'use client';

import { useState, useEffect, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { Eye, EyeOff } from 'lucide-react';
import { useAuthStore } from '../../store/useAuthStore';

const BG_BLUR_DATA_URL =
  'data:image/webp;base64,UklGRj4AAABXRUJQVlA4IDIAAADwAQCdASoQAAsABUB8JbACdAEO9INz+4AA/s3kXT65daMwbGYN3GJCKr7kdeX1xqgAAA==';
const CARD_BLUR_DATA_URL =
  'data:image/webp;base64,UklGRkIAAABXRUJQVlA4IDYAAADQAQCdASoQAAsABUB8JbACdAEDeeJYKADNRM3GmCvQP429cdBr4/jIbwj4aZv9Y0CG4g54AAA=';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isCheckingSession, setIsCheckingSession] = useState(true);

  const { isAuthenticated, isLoading: authLoading, initialize, login } = useAuthStore();
  const router = useRouter();

  // On mount: restore remembered username and initialize session
  useEffect(() => {
    try {
      const savedUser = localStorage.getItem('credify_remembered_username');
      if (savedUser) {
        setUsername(savedUser);
        setRememberMe(true);
      }
      const hasStoredToken = !!(
        localStorage.getItem('credify_auth_token') ||
        sessionStorage.getItem('credify_session_token') ||
        localStorage.getItem('certify_auth_token') ||
        sessionStorage.getItem('certify_session_token')
      );
      if (!hasStoredToken) {
        setIsCheckingSession(false);
      }
    } catch {
      setIsCheckingSession(false);
    }
    initialize();
  }, [initialize]);

  // If already authenticated with a valid session, redirect to dashboard
  useEffect(() => {
    if (!authLoading) {
      if (isAuthenticated) {
        router.replace('/dashboard');
      } else {
        setIsCheckingSession(false);
      }
    }
  }, [authLoading, isAuthenticated, router]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      const success = await login(username, password, rememberMe);
      if (success) {
        if (rememberMe) {
          localStorage.setItem('credify_remembered_username', username);
        } else {
          localStorage.removeItem('credify_remembered_username');
        }
        router.push('/dashboard');
      } else {
        setError('Invalid username or password');
      }
    } catch {
      setError('An unexpected error occurred. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  if (isCheckingSession && (authLoading || isAuthenticated)) {
    return (
      <div className="login-page relative isolate min-h-screen flex items-center justify-center p-4 md:p-8 transition-colors duration-300">
        <div className="login-mountain-bg">
          <Image
            src="/login_background.webp"
            alt="Scenic mountain landscape at dawn"
            fill
            priority
            sizes="100vw"
            quality={75}
            placeholder="blur"
            blurDataURL={BG_BLUR_DATA_URL}
            className="login-scenic-image mix-blend-overlay"
          />
        </div>
        <div className="login-glass-card relative z-10 rounded-[24px] px-8 py-6 flex items-center gap-3 shadow-xl">
          <Image
            src="/credify-logo.png"
            alt="Credify Logo"
            width={24}
            height={24}
            className="w-6 h-6 object-contain"
          />
          <div className="w-4 h-4 border-2 border-primary-600 border-t-transparent rounded-full animate-spin"></div>
          <span className="text-slate-700 text-sm font-semibold">Checking session...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="login-page relative isolate min-h-screen flex items-center justify-center p-4 md:p-8 transition-colors duration-300">
      <div className="login-mountain-bg">
        <Image
          src="/login_background.webp"
          alt="Scenic mountain landscape at dawn"
          fill
          priority
          sizes="100vw"
          quality={75}
          placeholder="blur"
          blurDataURL={BG_BLUR_DATA_URL}
          className="login-scenic-image mix-blend-overlay"
        />
      </div>

      <div className="w-full max-w-5xl login-glass-card relative z-10 rounded-[32px] flex flex-col md:flex-row overflow-hidden min-h-[600px] transition-all duration-300">
        <div className="md:w-[45%] p-3 md:p-4 flex flex-col">
          <div className="relative rounded-[24px] w-full h-full flex flex-col justify-end text-white overflow-hidden shadow-xl bg-slate-900">
            <Image
              src="/login_leftcard.webp"
              alt="Login Visual"
              fill
              priority
              sizes="(min-width: 768px) 45vw, 100vw"
              quality={75}
              placeholder="blur"
              blurDataURL={CARD_BLUR_DATA_URL}
              className="object-cover transition-transform duration-700 hover:scale-105 opacity-90"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent"></div>

            <div className="relative z-10 p-8 md:p-12 mb-4">
              <h1 className="text-3xl md:text-5xl font-bold leading-tight tracking-tight drop-shadow-sm">
                Welcome to <span className="text-amber-300 font-black tracking-normal">Credify</span>
              </h1>
              <p className="mt-6 text-white/95 text-lg font-normal leading-relaxed">
                Your one-stop destination for generating, exporting, and emailing professional certificates.
              </p>
            </div>
          </div>
        </div>

        <div className="md:w-[55%] p-8 md:p-16 flex flex-col justify-center relative">
          <div className="max-w-md mx-auto w-full">
            <div className="mb-8">
              <h2 className="text-3xl font-bold text-slate-800 tracking-tight mb-2">Welcome back</h2>
              <p className="text-slate-500 text-base">Enter your credentials to access the workspace</p>
            </div>

            {error && (
              <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl text-red-600 text-sm font-medium">
                {error}
              </div>
            )}

            <form className="space-y-6" onSubmit={handleSubmit}>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2 ml-1" htmlFor="username">
                  Username
                </label>
                <input
                  className="w-full px-4 py-3.5 rounded-xl login-input-glass text-slate-900 transition-all outline-none placeholder:text-slate-500 shadow-xs"
                  id="username"
                  name="username"
                  placeholder="Enter your username"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2 ml-1" htmlFor="password">
                  Password
                </label>
                <div className="relative">
                  <input
                    className="w-full px-4 py-3.5 rounded-xl login-input-glass text-slate-900 transition-all outline-none placeholder:text-slate-500 shadow-xs pr-12"
                    id="password"
                    name="password"
                    placeholder="Enter your password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                  <button
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 transition-colors p-1 rounded-md"
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
              </div>

              <div className="flex items-center space-x-2.5 my-2 ml-1">
                <input
                  type="checkbox"
                  id="remember"
                  name="remember"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="w-4 h-4 rounded border-slate-300 text-primary-600 focus:ring-0 focus:outline-none transition-colors cursor-pointer accent-primary-600"
                />
                <label htmlFor="remember" className="text-sm font-medium text-slate-600 cursor-pointer select-none">
                  Remember me
                </label>
              </div>

              <button
                className="w-full bg-primary-600 hover:bg-primary-700 text-white font-bold py-4 rounded-xl shadow-lg shadow-primary-600/25 transition-all transform hover:-translate-y-0.5 active:translate-y-0 text-lg mt-4 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none cursor-pointer"
                type="submit"
                disabled={isLoading}
              >
                {isLoading ? 'Signing in...' : 'Sign In'}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
