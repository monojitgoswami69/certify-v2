'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { useAuthStore } from '../../store/useAuthStore';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const login = useAuthStore((state) => state.login);
  const router = useRouter();

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      const success = await login(username, password, rememberMe);
      if (success) {
        router.push('/');
      } else {
        setError('Invalid username or password');
      }
    } catch {
      setError('An unexpected error occurred. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="login-page min-h-screen flex items-center justify-center p-4 md:p-8 transition-colors duration-300">
      <div className="login-mountain-bg">
        <Image
          src="/login_background.png"
          alt="Scenic mountain landscape at dawn"
          fill
          priority
          sizes="100vw"
          className="login-scenic-image mix-blend-overlay"
        />
      </div>

      <div className="w-full max-w-5xl login-glass-card rounded-[32px] flex flex-col md:flex-row overflow-hidden min-h-[600px] transition-all duration-300">
        <div className="md:w-[45%] p-3 md:p-4 flex flex-col">
          <div className="relative rounded-[24px] w-full h-full flex flex-col justify-end text-white overflow-hidden shadow-2xl bg-white/10 backdrop-blur-2xl">
            <Image
              src="/login_leftcard.png"
              alt="Login Visual"
              fill
              priority
              sizes="(min-width: 768px) 45vw, 100vw"
              className="object-cover transition-transform duration-700 hover:scale-105 opacity-85"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent"></div>

            <div className="relative z-10 p-8 md:p-12 mb-4">
              <h1 className="text-3xl md:text-5xl font-bold leading-tight tracking-tight drop-shadow-sm">
                Welcome to <span className="text-amber-300 font-black tracking-normal">Certify</span>
              </h1>
              <p className="mt-6 text-white/90 text-lg font-light leading-relaxed">
                Your one-stop destination for generating, exporting, and emailing professional certificates.
              </p>
            </div>
          </div>
        </div>

        <div className="md:w-[55%] p-8 md:p-16 flex flex-col justify-center relative">
          <div className="max-w-md mx-auto w-full">
            <div className="mb-10">
              <h2 className="text-3xl font-bold text-slate-800 tracking-tight mb-2">Welcome back</h2>
              <p className="text-slate-500 text-base">Enter your credentials to access the workspace</p>
            </div>

            {error && (
              <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl text-red-600 text-sm">
                {error}
              </div>
            )}

            <form className="space-y-6" onSubmit={handleSubmit}>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2 ml-1" htmlFor="username">
                  Username
                </label>
                <input
                  className="w-full px-4 py-3.5 rounded-xl login-input-glass text-slate-900 transition-all outline-none placeholder-slate-600"
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
                    className="w-full px-4 py-3.5 rounded-xl login-input-glass text-slate-900 transition-all outline-none placeholder-slate-600 pr-12"
                    id="password"
                    name="password"
                    placeholder="Enter your password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                  <button
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-700 transition-colors"
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    <span className="material-symbols-outlined text-[20px]">
                      {showPassword ? 'visibility_off' : 'visibility'}
                    </span>
                  </button>
                </div>
              </div>

              <div className="flex items-center space-x-2 my-2 ml-1">
                <input
                  type="checkbox"
                  id="remember"
                  name="remember"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="w-4 h-4 rounded border-slate-300 bg-white/20 text-primary-600 border-none focus:ring-0 outline-none transition-colors cursor-pointer"
                />
                <label htmlFor="remember" className="text-sm font-medium text-slate-600 cursor-pointer select-none">
                  Remember me
                </label>
              </div>

              <button
                className="w-full bg-primary-600 hover:bg-primary-700 text-white font-bold py-4 rounded-xl shadow-lg shadow-primary-600/25 transition-all transform hover:-translate-y-0.5 active:translate-y-0 text-lg mt-4 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
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
