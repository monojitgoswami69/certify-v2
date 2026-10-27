/**
 * End-to-end smoke test for the hardened registration endpoint.
 * Creates a throwaway user, exercises idempotency + rename isolation +
 * ambiguous-name rejection + logout revocation, then cleans up.
 * Run: node scripts/e2e-smoke.mjs [port]
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
try {
  const env = readFileSync(join(root, '.env'), 'utf8');
  for (const line of env.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch {}

const PORT = process.argv[2] || '3005';
const BASE = `http://localhost:${PORT}`;

const { neon } = await import('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);
const jwt = (await import('jsonwebtoken')).default;

const TEST_EMAIL = `audit-smoke-${Date.now()}@example.com`;
const EVENT = 'ZZ Audit Smoke Test';

let failures = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '  PASS' : '  FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
  if (!cond) failures++;
};

// --- setup: throwaway user + token -------------------------------------------
await sql`INSERT INTO users (email, name, role) VALUES (${TEST_EMAIL}, 'Audit Smoke', 'user')
          ON CONFLICT (email) DO NOTHING`;
const [user] = await sql`SELECT id FROM users WHERE email = ${TEST_EMAIL}`;
const token = jwt.sign({ userId: user.id, email: TEST_EMAIL, role: 'user', name: 'Audit Smoke' },
  process.env.JWT_SECRET, { expiresIn: '1h', algorithm: 'HS256' });
const auth = {
  Authorization: `Bearer ${token}`,
  'Content-Type': 'application/json',
  'X-Certify-Request': '1',
};
// Cookie-only credential (no Authorization header) — the new default browser path.
const cookieAuth = {
  Cookie: `certify_session=${token}`,
  'Content-Type': 'application/json',
  'X-Certify-Request': '1',
};

async function register(body, headers = auth) {
  const res = await fetch(`${BASE}/api/certificates/register`, {
    method: 'POST', headers, body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

try {
  // 0. CSRF guard: mutations without the anti-CSRF marker are rejected,
  //    even with a valid session credential attached.
  const loginNoCsrf = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
  });
  check('login without CSRF header rejected (403)', loginNoCsrf.status === 403, `status=${loginNoCsrf.status}`);
  const cookieNoCsrf = await fetch(`${BASE}/api/certificates/register`, {
    method: 'POST',
    headers: { Cookie: `certify_session=${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ certificates: [{ recipientName: 'X' }] }),
  });
  check('cookie session without CSRF header rejected (403)', cookieNoCsrf.status === 403,
    `status=${cookieNoCsrf.status}`);

  // 1. First registration
  const batch1 = {
    eventName: EVENT,
    certificates: [
      { recipientName: 'Alice Smith', recipientEmail: 'alice@example.com', rowData: { Name: 'Alice Smith' } },
      { recipientName: 'Bob Jones', recipientEmail: 'bob@example.com', rowData: { Name: 'Bob Jones' } },
      { recipientName: 'Carol NoEmail', rowData: { Name: 'Carol NoEmail' } },
    ],
  };
  const r1 = await register(batch1);
  check('initial batch registers (200)', r1.status === 200, `status=${r1.status} ${r1.data.detail ?? ''}`);
  check('3 ids returned', Array.isArray(r1.data.ids) && r1.data.ids.length === 3);
  check('3 newly registered', r1.data.newlyRegisteredCount === 3, `got ${r1.data.newlyRegisteredCount}`);

  // 2. Exact same batch again → identical ids (idempotent, no duplicates)
  const r2 = await register(batch1);
  check('re-register is idempotent (200)', r2.status === 200, `status=${r2.status}`);
  check('same ids returned', JSON.stringify(r1.data.ids) === JSON.stringify(r2.data.ids));
  check('all reused, none new', r2.data.newlyRegisteredCount === 0 && r2.data.reusedCount === 3,
    `new=${r2.data.newlyRegisteredCount} reused=${r2.data.reusedCount}`);

  // 3. CONCURRENT duplicate batch → still no duplicates (the C1 race)
  const [c1, c2] = await Promise.all([register(batch1), register(batch1)]);
  const concurrentIds = [...(c1.data.ids ?? []), ...(c2.data.ids ?? [])];
  check('concurrent batches both succeed', c1.status === 200 && c2.status === 200,
    `${c1.status}/${c2.status}`);
  check('concurrent batches share one id-set (no duplicates)',
    new Set(concurrentIds).size === 3, `unique=${new Set(concurrentIds).size} of ${concurrentIds.length}`);

  // 4. Rename under the same email must NOT hijack the existing certificate
  const r4 = await register({
    eventName: EVENT,
    certificates: [
      { recipientName: 'Alice Smith', recipientEmail: 'alice@example.com' },
      { recipientName: 'Alicia Smith', recipientEmail: 'alice@example.com' },
    ],
  });
  check('renamed person gets their own certificate (200)', r4.status === 200, `status=${r4.status}`);
  check('rename does not hijack the original id', r4.data.ids?.[0] === r1.data.ids[0]);
  check('rename produces a NEW id', r4.data.ids?.[1] !== r1.data.ids[0]);

  // 5. Alice's original certificate still verifies under her name
  const v = await fetch(`${BASE}/api/verify/${r1.data.ids[0]}`);
  const vd = await v.json();
  check('original certificate still verifies as Alice', v.status === 200 && vd.status === 'valid' && vd.recipientName === 'Alice Smith',
    `status=${vd.status} name=${vd.recipientName}`);

  // 6. Email-less duplicate names with different data → rejected (H3)
  const r6 = await register({
    eventName: EVENT,
    certificates: [
      { recipientName: 'Same Name', rowData: { Roll: '101' } },
      { recipientName: 'Same Name', rowData: { Roll: '102' } },
    ],
  });
  check('ambiguous email-less duplicates rejected (400)', r6.status === 400, `status=${r6.status}`);

  // 7. Dashboard overview works with the events-sourced aggregation
  const d = await fetch(`${BASE}/api/dashboard`, { headers: auth });
  const dd = await d.json();
  check('dashboard overview returns stats', d.status === 200 && dd.stats?.totalEvents >= 1,
    `events=${dd.stats?.totalEvents}`);
  const smokeEvent = (dd.events || []).find((e) => e.eventName === EVENT);
  check('dashboard lists the event by name', Boolean(smokeEvent),
    `found=${Boolean(smokeEvent)}`);

  // 7a. Cookie-only authentication (no Authorization header) works end to end
  const dCookie = await fetch(`${BASE}/api/dashboard`, { headers: cookieAuth });
  const ddCookie = await dCookie.json().catch(() => ({}));
  check('cookie session authenticates (no bearer header)', dCookie.status === 200 && ddCookie.stats?.totalEvents >= 1,
    `status=${dCookie.status}`);
  const rCookie = await register(
    { eventName: EVENT, certificates: [{ recipientName: 'Cookie Auth Tester' }] },
    cookieAuth
  );
  check('cookie session + CSRF header can register (200)', rCookie.status === 200,
    `status=${rCookie.status} ${rCookie.data.detail ?? ''}`);

  // 7b. Events anchoring: event row + registration batch audit records exist
  const [eventRow] = await sql`SELECT id FROM events WHERE user_id = ${user.id} AND name = ${EVENT}`;
  check('events row created for the batch', Boolean(eventRow));
  const batches = await sql`
    SELECT row_count, inserted_count, reused_count FROM registration_batches
    WHERE event_id = ${eventRow?.id ?? '00000000-0000-0000-0000-000000000000'}
    ORDER BY created_at ASC`;
  check('registration batch audit rows written', batches.length >= 2,
    `batches=${batches.length}`);
  check('initial batch audit matches (3 rows, 3 inserted)',
    batches[0]?.row_count === 3 && batches[0]?.inserted_count === 3,
    `first=${JSON.stringify(batches[0])}`);
  const renameBatch = batches.find((b) => b.row_count === 2);
  check('rename batch audit matches (2 rows, 1 inserted, 1 reused)',
    renameBatch?.inserted_count === 1 && renameBatch?.reused_count === 1,
    `rename=${JSON.stringify(renameBatch)}`);

  // 7c. Verify-page asset endpoint: render spec for valid certificates with
  //     strict field filtering, 404 for revoked/unknown, template resolution.
  //     Attach a real template (1x1 PNG, one box printing "Name") to Alice's
  //     certificate so the full path is exercised.
  const TINY_PNG =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  await sql`
    INSERT INTO templates (user_id, name, image_data, width, height, layout_config)
    VALUES (${user.id}, ${EVENT}, ${TINY_PNG}, 1, 1,
      ${JSON.stringify({
        boxes: [{ id: 'b1', field: 'Name', x: 0, y: 0, width: 1, height: 1 }],
        qrZones: [],
      })}::jsonb)
    ON CONFLICT (user_id, name) DO NOTHING`;
  await sql`
    UPDATE certificates SET template_name = ${EVENT}
    WHERE id = ${r1.data.ids[0]} AND user_id = ${user.id}`;

  const assetOk = await fetch(`${BASE}/api/verify/${r1.data.ids[0]}/asset`);
  const assetData = await assetOk.json().catch(() => ({}));
  check('asset endpoint returns render spec for valid cert (200)', assetOk.status === 200 && assetData.status === 'ok',
    `status=${assetOk.status}`);
  check('asset resolves the template', Boolean(assetData.template?.imageData),
    `template=${Boolean(assetData.template)}`);
  check('asset returns only template-referenced fields',
    assetData.fields?.Name === 'Alice Smith' && !('Roll' in (assetData.fields ?? {})) &&
      Object.keys(assetData.fields ?? {}).length === 1,
    `fields=${JSON.stringify(assetData.fields)}`);

  // Revoke Alice's certificate, then the asset must stop resolving.
  const rv = await fetch(`${BASE}/api/certificates/${r1.data.ids[0]}/revoke`, {
    method: 'POST', headers: auth, body: '{}',
  });
  check('revoke succeeds (200)', rv.status === 200, `status=${rv.status}`);
  const assetRevoked = await fetch(`${BASE}/api/verify/${r1.data.ids[0]}/asset`);
  check('asset for revoked cert is 404', assetRevoked.status === 404, `status=${assetRevoked.status}`);
  const mainRevoked = await fetch(`${BASE}/api/verify/${r1.data.ids[0]}`);
  const mainRevokedData = await mainRevoked.json().catch(() => ({}));
  check('revoked verify page leaks no PII', mainRevoked.status === 200 && mainRevokedData.status === 'revoked' &&
    !mainRevokedData.recipientName, `status=${mainRevokedData.status}`);
  const assetMalformed = await fetch(`${BASE}/api/verify/not-a-uuid/asset`);
  check('asset for malformed id is 404', assetMalformed.status === 404, `status=${assetMalformed.status}`);

  // 7d. Event settings: opt-in scan counting + validity window (events API)
  const [eventForSettings] = await sql`SELECT id FROM events WHERE user_id = ${user.id} AND name = ${EVENT}`;
  const bobId = r1.data.ids[1];
  const patchSettings = async (body) => {
    const res = await fetch(`${BASE}/api/events/${eventForSettings.id}`, {
      method: 'PATCH', headers: auth, body: JSON.stringify(body),
    });
    return { status: res.status, data: await res.json().catch(() => ({})) };
  };

  const scanOn = await patchSettings({ trackScans: true });
  check('event settings PATCH accepts trackScans (200)', scanOn.status === 200 && scanOn.data.event?.trackScans === true,
    `status=${scanOn.status}`);
  const v1 = await (await fetch(`${BASE}/api/verify/${bobId}`)).json();
  const v2 = await (await fetch(`${BASE}/api/verify/${bobId}`)).json();
  check('opt-in scan counting increments (1 then 2)',
    v1.verificationCount === 1 && v2.verificationCount === 2,
    `counts=${v1.verificationCount},${v2.verificationCount}`);

  const yesterday = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const expSet = await patchSettings({ validThrough: yesterday });
  check('event settings PATCH accepts validThrough (200)', expSet.status === 200 && Boolean(expSet.data.event?.validThrough),
    `status=${expSet.status}`);
  const vExp = await (await fetch(`${BASE}/api/verify/${bobId}`)).json();
  check('expired certificate flags expired=true (details kept)',
    vExp.status === 'valid' && vExp.expired === true && vExp.recipientName === 'Bob Jones',
    `expired=${vExp.expired}`);
  const expClear = await patchSettings({ validThrough: null });
  const vClear = await (await fetch(`${BASE}/api/verify/${bobId}`)).json();
  check('clearing validThrough restores non-expired verify', expClear.status === 200 && vClear.expired === false,
    `expired=${vClear.expired}`);

  await patchSettings({ trackScans: false });
  const vOff = await (await fetch(`${BASE}/api/verify/${bobId}`)).json();
  check('scan counting off → no verificationCount field', vOff.verificationCount === undefined,
    `field=${JSON.stringify(vOff.verificationCount)}`);

  // 7e. Admin console: regular users are forbidden; elevated accounts can
  //     read aggregate analytics and manage the allowlist.
  const adminForbidden = await fetch(`${BASE}/api/admin/overview`, { headers: auth });
  check('admin API forbidden for regular user (403)', adminForbidden.status === 403,
    `status=${adminForbidden.status}`);
  await sql`INSERT INTO platform_access (email, role) VALUES (${TEST_EMAIL}, 'super_admin')
            ON CONFLICT (email) DO UPDATE SET role = 'super_admin'`;
  const adminOk = await fetch(`${BASE}/api/admin/overview`, { headers: auth });
  const adminData = await adminOk.json().catch(() => ({}));
  check('admin overview readable after elevation (200)',
    adminOk.status === 200 && typeof adminData.overview?.accounts === 'number',
    `status=${adminOk.status} accounts=${adminData.overview?.accounts}`);
  const grant = await fetch(`${BASE}/api/admin/access`, {
    method: 'POST', headers: auth,
    body: JSON.stringify({ email: 'invited-' + Date.now() + '@example.com', role: 'user' }),
  });
  const grantData = await grant.json().catch(() => ({}));
  check('allowlist grant works (200)', grant.status === 200 &&
    (grantData.access ?? []).some((a) => a.email.startsWith('invited-')),
    `status=${grant.status}`);
  const grantedEmail = (grantData.access ?? []).find((a) => a.email.startsWith('invited-'))?.email;
  const revoke = await fetch(`${BASE}/api/admin/access?email=${encodeURIComponent(grantedEmail)}`, {
    method: 'DELETE', headers: auth,
  });
  check('allowlist revoke works (200)', revoke.status === 200, `status=${revoke.status}`);
  await sql`DELETE FROM platform_access WHERE email = ${TEST_EMAIL}`;
  const adminAfterDemote = await fetch(`${BASE}/api/admin/overview`, { headers: auth });
  check('admin API forbidden again after removal (403)', adminAfterDemote.status === 403,
    `status=${adminAfterDemote.status}`);

  // 7f. Nonce regression sweep: every app page must be server-rendered per
  //     request so the proxy's nonce CSP applies to its inline scripts. A page
  //     that forgets connection() prerenders static HTML whose inline scripts
  //     the CSP blocks (silent white-screen).
  for (const page of ['/', '/login', '/dashboard', '/editor', '/admin', '/privacy', '/terms']) {
    const html = await (await fetch(`${BASE}${page}`)).text();
    const inline = [...html.matchAll(/<script(?![^>]*\ssrc=)(?![^>]*\snonce=)[^>]*>/g)].length;
    const nonced = (html.match(/nonce="/g) || []).length;
    check(`nonce CSP: ${page} has no un-nonce'd inline scripts`, inline === 0, `inline=${inline} nonced=${nonced}`);
  }

  // 8. Logout (via the cookie path) revokes the session server-side and
  //    instructs the browser to drop the cookie.
  const lo = await fetch(`${BASE}/api/auth/logout`, { method: 'POST', headers: cookieAuth });
  check('logout succeeds', lo.status === 200, `status=${lo.status}`);
  const setCookie = lo.headers.getSetCookie?.().join(' | ') ?? '';
  check('logout clears the session cookie', /certify_session=.*Max-Age=0/.test(setCookie),
    `set-cookie=${setCookie.slice(0, 80)}`);
  const verifyAfter = await fetch(`${BASE}/api/auth/verify`, { headers: auth });
  check('token invalid after logout (401)', verifyAfter.status === 401, `status=${verifyAfter.status}`);
  const verifyCookieAfter = await fetch(`${BASE}/api/auth/verify`, { headers: cookieAuth });
  check('cookie session invalid after logout (401)', verifyCookieAfter.status === 401,
    `status=${verifyCookieAfter.status}`);
} finally {
  // cleanup: deleting the throwaway user cascades its certificates
  await sql`DELETE FROM users WHERE email = ${TEST_EMAIL}`;
  console.log('  cleanup done (test user + certificates removed)');
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
