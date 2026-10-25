'use client';

/**
 * Last-resort boundary for errors raised in the root layout itself. Must
 * render its own <html>/<body> (Next replaces the root layout when this
 * fires), so it deliberately uses inline styles and no app CSS dependencies.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: 'system-ui, sans-serif', background: '#f8fafc' }}>
        <div
          style={{
            minHeight: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '24px',
          }}
        >
          <div
            style={{
              maxWidth: '420px',
              width: '100%',
              background: '#fff',
              borderRadius: '16px',
              border: '1px solid #e2e8f0',
              boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)',
              padding: '32px',
              textAlign: 'center',
            }}
          >
            <div
              style={{
                width: '64px',
                height: '64px',
                margin: '0 auto 16px',
                borderRadius: '9999px',
                background: '#fee2e2',
                color: '#dc2626',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '28px',
              }}
            >
              ⚠
            </div>
            <h2 style={{ fontSize: '20px', fontWeight: 700, color: '#1e293b', margin: '0 0 8px' }}>
              Application error
            </h2>
            <p style={{ fontSize: '14px', color: '#64748b', lineHeight: 1.6, margin: '0 0 24px' }}>
              The application hit an unexpected error and could not render. Reloading usually fixes
              it; if it persists, contact your administrator.
            </p>
            {error?.digest && (
              <p style={{ fontSize: '11px', color: '#94a3b8', fontFamily: 'monospace', margin: '0 0 24px' }}>
                ref: {error.digest}
              </p>
            )}
            <button
              onClick={reset}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                padding: '10px 20px',
                background: '#4f46e5',
                color: '#fff',
                border: 'none',
                borderRadius: '12px',
                fontSize: '14px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Reload
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
