const message = 'WeCertify is under maintenance. Certificate verification will be available again soon.';
const headers = { 'Cache-Control': 'no-store', 'Retry-After': '300' };

export function verificationMaintenanceResponse() {
  return Response.json({ status: 'error', detail: message }, { status: 503, headers });
}

export function verificationMaintenancePage(nonce?: string) {
  const styleAttr = nonce ? ` nonce="${nonce}"` : '';
  const styleSrc = nonce ? `'nonce-${nonce}'` : "'unsafe-inline'";
  return new Response(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <title>Certificate verification under maintenance | WeCertify</title>
  <style${styleAttr}>
    body { margin: 0; background: #fbfaf5; color: #0f172a; font: 1rem/1.6 system-ui, sans-serif; }
    main { max-width: 36rem; margin: 15vh auto 0; padding: 1.5rem; }
    h1 { font-size: clamp(1.4rem, 5vw, 2rem); line-height: 1.2; letter-spacing: -.02em; }
    p { color: #44403c; }
  </style>
</head>
<body>
  <main>
    <h1>Certificate verification under maintenance</h1>
    <p>${message} Please try opening the same link again later.</p>
  </main>
</body>
</html>`, {
    status: 503,
    headers: {
      ...headers,
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': `default-src 'none'; style-src ${styleSrc}; base-uri 'none'; frame-ancestors 'none'`,
    },
  });
}
