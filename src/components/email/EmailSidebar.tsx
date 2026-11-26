'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Mail, FileText, Paperclip, CheckCircle2 } from 'lucide-react';
import { GoogleOAuthProvider, useGoogleLogin, useGoogleOAuth } from '@react-oauth/google';
import { useAppStore } from '../../store/useAppStore';
import { useAuthStore } from '../../store/useAuthStore';
import { disconnectGoogleAccount, exchangeGoogleCode, getGoogleConnection } from '../../lib/api-client';
import { EmailSendButton } from './EmailSendButton';
import { CustomSelect } from '../ui/CustomSelect';
import { ResizeHandle } from '../ui/ResizeHandle';

const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || '';

function GoogleConnectButton({
  onSuccess,
  onError,
  email,
}: {
  onSuccess: (account: { email: string; name?: string; picture?: string }) => void;
  onError: (msg: string) => void;
  email: string;
}) {
  const [connecting, setConnecting] = useState(false);
  const { scriptLoadedSuccessfully } = useGoogleOAuth();

  // Use the auth-code flow so the server can exchange the code for a
  // long-lived refresh token (auto-refresh on expiry -> no silent 401s).
  const login = useGoogleLogin({
    flow: 'auth-code',
    onSuccess: async (response) => {
      const code = response.code;
      if (!code) {
        onError('No authorization code returned');
        setConnecting(false);
        return;
      }
      try {
        const account = await exchangeGoogleCode(code);
        onSuccess(account);
      } catch (err) {
        onError(err instanceof Error ? err.message : 'Error exchanging Google authorization code');
      } finally {
        setConnecting(false);
      }
    },
    onError: () => {
      onError('Google connection was cancelled or failed');
      setConnecting(false);
    },
    onNonOAuthError: () => {
      onError('Google authorization window closed or could not open');
      setConnecting(false);
    },
    scope: 'openid email https://www.googleapis.com/auth/gmail.send',
    overrideScope: true,
    ...{ login_hint: email },
    include_granted_scopes: false,
  });

  return (
    <button
      type="button"
      onClick={() => {
        setConnecting(true);
        login();
      }}
      disabled={connecting || !scriptLoadedSuccessfully}
      className="w-full flex items-center justify-center gap-2.5 bg-white hover:bg-slate-50 text-slate-700 font-semibold px-3.5 py-2.5 rounded-lg border border-slate-300 shadow-sm transition-all text-sm transform hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-50 disabled:cursor-not-allowed"
    >
      <svg className="w-4.5 h-4.5" viewBox="0 0 24 24">
        <path
          fill="#4285F4"
          d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
        />
        <path
          fill="#34A853"
          d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        />
        <path
          fill="#FBBC05"
          d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
        />
        <path
          fill="#EA4335"
          d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
        />
      </svg>
      <span>{connecting ? 'Authorizing Gmail…' : 'Authorize Gmail sending'}</span>
    </button>
  );
}

function EmailSidebarContent() {
  const {
    csvHeaders,
    issuanceStarted,
    csvData,
    emailColumn,
    emailSettings,
    emailProgress,
    connectedGoogleAccount,
    sidebarWidth,
    setEmailColumn,
    setEmailSettings,
    setConnectedGoogleAccount,
    resetToDownload,
    setError,
  } = useAppStore();

  const loginEmail = useAuthStore((state) => state.user?.email);
  const [checkingConnection, setCheckingConnection] = useState(true);
  const [disconnecting, setDisconnecting] = useState(false);

  useEffect(() => {
    if (!loginEmail) return;
    const controller = new AbortController();
    setCheckingConnection(true);
    getGoogleConnection(controller.signal)
      .then((account) => {
        if (!controller.signal.aborted) setConnectedGoogleAccount(account);
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(error.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setCheckingConnection(false);
      });
    return () => controller.abort();
  }, [loginEmail, setConnectedGoogleAccount, setError]);

  const disconnect = async () => {
    setDisconnecting(true);
    try {
      await disconnectGoogleAccount();
      setConnectedGoogleAccount(null);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not disconnect Gmail');
    } finally {
      setDisconnecting(false);
    }
  };

  const subjectRef = useRef<HTMLInputElement>(null);
  const bodyPlainRef = useRef<HTMLTextAreaElement>(null);
  const bodyHtmlRef = useRef<HTMLTextAreaElement>(null);

  const lastFocusedFieldRef = useRef<'subject' | 'bodyPlain' | 'bodyHtml'>('subject');
  const selectionRangeRef = useRef<{ start: number; end: number }>({ start: 0, end: 0 });

  const recordSelection = (
    field: 'subject' | 'bodyPlain' | 'bodyHtml',
    target: HTMLInputElement | HTMLTextAreaElement
  ) => {
    lastFocusedFieldRef.current = field;
    selectionRangeRef.current = {
      start: target.selectionStart ?? target.value.length,
      end: target.selectionEnd ?? target.value.length,
    };
  };

  const emailColumns = csvHeaders.filter((h) =>
    h.toLowerCase().includes('email') || h.toLowerCase().includes('mail')
  );

  const isSending = emailProgress.status === 'sending' || emailProgress.status === 'paused';

  const insertVariable = (variable: string) => {
    const insertion = `{{${variable}}}`;
    const field = lastFocusedFieldRef.current;

    if (field === 'subject' && subjectRef.current) {
      const input = subjectRef.current;
      const start = selectionRangeRef.current.start ?? input.value.length;
      const end = selectionRangeRef.current.end ?? input.value.length;
      const current = emailSettings.subject;
      const newValue = current.slice(0, start) + insertion + current.slice(end);
      setEmailSettings({ subject: newValue });
      const nextPos = start + insertion.length;
      selectionRangeRef.current = { start: nextPos, end: nextPos };
      setTimeout(() => {
        input.focus();
        input.setSelectionRange(nextPos, nextPos);
      }, 0);
    } else if (field === 'bodyHtml' && bodyHtmlRef.current) {
      const textarea = bodyHtmlRef.current;
      const start = selectionRangeRef.current.start ?? textarea.value.length;
      const end = selectionRangeRef.current.end ?? textarea.value.length;
      const current = emailSettings.bodyHtml;
      const newValue = current.slice(0, start) + insertion + current.slice(end);
      setEmailSettings({ bodyHtml: newValue });
      const nextPos = start + insertion.length;
      selectionRangeRef.current = { start: nextPos, end: nextPos };
      setTimeout(() => {
        textarea.focus();
        textarea.setSelectionRange(nextPos, nextPos);
      }, 0);
    } else {
      const textarea = bodyPlainRef.current;
      const start = selectionRangeRef.current.start ?? (textarea ? textarea.value.length : emailSettings.bodyPlain.length);
      const end = selectionRangeRef.current.end ?? (textarea ? textarea.value.length : emailSettings.bodyPlain.length);
      const current = emailSettings.bodyPlain;
      const newValue = current.slice(0, start) + insertion + current.slice(end);
      setEmailSettings({ bodyPlain: newValue });
      const nextPos = start + insertion.length;
      selectionRangeRef.current = { start: nextPos, end: nextPos };
      if (textarea) {
        setTimeout(() => {
          textarea.focus();
          textarea.setSelectionRange(nextPos, nextPos);
        }, 0);
      }
    }
  };

  return (
    <aside
      style={{ width: `min(${sidebarWidth}px, 100vw)` }}
      className="relative bg-white border-r border-slate-500/80 flex-shrink-0 flex flex-col h-full w-full md:w-auto max-w-full md:max-w-[75vw]"
    >
      <ResizeHandle />
      <div className="p-4 border-b border-slate-200 bg-slate-100 flex-shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={resetToDownload}
            className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
            title="Back to Editor"
          >
            <ArrowLeft className="w-5 h-5 text-primary-600" />
          </button>
          <div>
            <h2 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
              <Mail className="w-5 h-5 text-primary-600" />
              Email Mode
            </h2>
            <p className="text-sm text-slate-500">
              Send certificates directly to recipients
            </p>
          </div>
        </div>
      </div>

      <div className="flex-1 p-4 space-y-5 overflow-y-auto">
        <section className="space-y-2 border-b border-stone-200/60 pb-4" aria-label="Gmail sender">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-xs font-semibold text-stone-500">Sending from</p>
              <p className="truncate text-sm font-semibold text-slate-800">{loginEmail}</p>
            </div>
            {connectedGoogleAccount?.email === loginEmail && !checkingConnection && (
              <button type="button" onClick={() => void disconnect()} disabled={isSending || disconnecting}
                className="text-xs font-semibold text-stone-600 hover:text-red-700 disabled:opacity-50">
                {disconnecting ? 'Disconnecting…' : 'Disconnect Gmail'}
              </button>
            )}
          </div>
          {checkingConnection ? (
            <p className="text-xs text-stone-500">Checking Gmail authorization…</p>
          ) : connectedGoogleAccount?.email === loginEmail ? (
            <p className="flex items-center gap-1.5 text-xs text-emerald-700">
              <CheckCircle2 className="h-3.5 w-3.5" /> Gmail authorized
            </p>
          ) : loginEmail && (
            <GoogleConnectButton
              key={loginEmail}
              email={loginEmail}
              onSuccess={setConnectedGoogleAccount}
              onError={setError}
            />
          )}
          <p className="text-xs leading-relaxed text-stone-700">
            Gmail access lets WeCertify send the certificate emails you initiate.{' '}
            <a href="/privacy" target="_blank" rel="noopener noreferrer" className="font-medium text-primary-800 underline underline-offset-2">
              Privacy Policy
            </a>
          </p>
        </section>
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1.5">
            <Mail className="inline w-3.5 h-3.5 mr-1" />
            Email Column in CSV
          </label>
          {issuanceStarted ? (
            <p className="text-sm text-slate-700">{emailColumn || 'No email column in the issued roster'}</p>
          ) : <CustomSelect
            value={emailColumn}
            onChange={setEmailColumn}
            options={[
              { value: '', label: 'Select email column...' },
              ...(emailColumns.length > 0 ? emailColumns : csvHeaders).map((h) => ({
                value: h,
                label: h,
              })),
            ]}
            placeholder="Select email column..."
            searchable
          />}
        </div>

        <div className="p-3 bg-primary-50 border border-primary-200 rounded-lg">
          <p className="text-xs font-medium text-primary-800 mb-2">Template Variables</p>
          <p className="text-xs text-primary-600 mb-3">
            Click to insert <code className="bg-white px-1 rounded border border-primary-200">{'{{column}}'}</code> at cursor
          </p>
          <div className="flex flex-wrap gap-1.5">
            {csvHeaders.map((header) => (
              <button
                key={header}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => insertVariable(header)}
                className="px-2.5 py-1 text-xs bg-white text-slate-700 border border-slate-300 rounded-md hover:bg-slate-50 hover:border-slate-400 transition-colors cursor-pointer active:scale-95"
              >
                {header}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1.5">
            <FileText className="inline w-3.5 h-3.5 mr-1" />
            Email Subject
          </label>
          <input
            ref={subjectRef}
            type="text"
            value={emailSettings.subject}
            onChange={(e) => {
              setEmailSettings({ subject: e.target.value });
              recordSelection('subject', e.target);
            }}
            onFocus={(e) => recordSelection('subject', e.currentTarget)}
            onClick={(e) => recordSelection('subject', e.currentTarget)}
            onKeyUp={(e) => recordSelection('subject', e.currentTarget)}
            onSelect={(e) => recordSelection('subject', e.currentTarget)}
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-0 focus:border-slate-400"
            placeholder="Your Certificate is Ready!"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1.5">
            Email Body (Plain Text)
          </label>
          <textarea
            ref={bodyPlainRef}
            value={emailSettings.bodyPlain}
            onChange={(e) => {
              setEmailSettings({ bodyPlain: e.target.value });
              recordSelection('bodyPlain', e.target);
            }}
            onFocus={(e) => recordSelection('bodyPlain', e.currentTarget)}
            onClick={(e) => recordSelection('bodyPlain', e.currentTarget)}
            onKeyUp={(e) => recordSelection('bodyPlain', e.currentTarget)}
            onSelect={(e) => recordSelection('bodyPlain', e.currentTarget)}
            rows={10}
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-0 focus:border-slate-400 font-mono resize-y"
            placeholder="Hi {{name}},&#10;&#10;Congratulations!..."
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1.5">
            Email Body (HTML) - Optional
          </label>
          <textarea
            ref={bodyHtmlRef}
            value={emailSettings.bodyHtml}
            onChange={(e) => {
              setEmailSettings({ bodyHtml: e.target.value });
              recordSelection('bodyHtml', e.target);
            }}
            onFocus={(e) => recordSelection('bodyHtml', e.currentTarget)}
            onClick={(e) => recordSelection('bodyHtml', e.currentTarget)}
            onKeyUp={(e) => recordSelection('bodyHtml', e.currentTarget)}
            onSelect={(e) => recordSelection('bodyHtml', e.currentTarget)}
            rows={8}
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-0 focus:border-slate-400 font-mono text-xs resize-y"
            placeholder="<div>Hi {{name}},</div>..."
          />
          <p className="text-xs text-slate-400 mt-1">Leave empty to use plain text only</p>
        </div>

        <div className="space-y-2.5">
          <label className="block text-xs font-medium text-slate-500">
            <Paperclip className="inline w-3.5 h-3.5 mr-1" />
            Attachments
          </label>
          <div className="flex items-center gap-6">
            {/* PDF Toggle Switch */}
            <button
              type="button"
              role="switch"
              aria-checked={emailSettings.attachPdf}
              onClick={() => setEmailSettings({ attachPdf: !emailSettings.attachPdf })}
              className="flex items-center gap-2.5 group cursor-pointer focus:outline-none"
            >
              <div
                className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-200 ease-in-out ${
                  emailSettings.attachPdf ? 'bg-primary-600' : 'bg-slate-300'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-md transition-transform duration-200 ease-in-out ${
                    emailSettings.attachPdf ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </div>
              <span className="text-sm font-semibold text-slate-700 group-hover:text-slate-900 transition-colors">
                PDF
              </span>
            </button>

            {/* JPG Toggle Switch */}
            <button
              type="button"
              role="switch"
              aria-checked={Boolean(emailSettings.attachJpg)}
              onClick={() => {
                const current = Boolean(emailSettings.attachJpg);
                setEmailSettings({ attachJpg: !current });
              }}
              className="flex items-center gap-2.5 group cursor-pointer focus:outline-none"
            >
              <div
                className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-200 ease-in-out ${
                  emailSettings.attachJpg ? 'bg-primary-600' : 'bg-slate-300'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-md transition-transform duration-200 ease-in-out ${
                    emailSettings.attachJpg ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </div>
              <span className="text-sm font-semibold text-slate-700 group-hover:text-slate-900 transition-colors">
                JPG
              </span>
            </button>
          </div>
          {!emailSettings.attachPdf && !emailSettings.attachJpg && (
            <p className="text-xs text-amber-600">Select at least one attachment type</p>
          )}
        </div>

      </div>

      <div className="p-4 border-t border-slate-200 bg-white">
        <EmailSendButton />
      </div>
    </aside>
  );
}

export function EmailSidebar() {
  if (!GOOGLE_CLIENT_ID) {
    return (
      <EmailSidebarContent />
    );
  }
  return (
    <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
      <EmailSidebarContent />
    </GoogleOAuthProvider>
  );
}
