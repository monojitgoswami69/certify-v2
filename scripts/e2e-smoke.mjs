/**
 * End-to-end smoke test for the hardened registration endpoint.
 * Creates a throwaway user, exercises idempotency + rename isolation +
 * ambiguous-name rejection + logout revocation, then cleans up.
 * Run: node scripts/e2e-smoke.mjs [port]
 */
import { createHash, randomUUID } from 'node:crypto';
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
const EVENT_ID = randomUUID();
const TINY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const DESIGN = {
  imageData: TINY_PNG, width: 1, height: 1,
  layoutConfig: { boxes: [{ id: 'b1', field: 'Name', x: 0, y: 0, w: 1, h: 1 }], qrZones: [{ id: 'qr', x: 0, y: 0, size: 1 }] },
};
const INVITED_EMAIL = `invited-${TEST_EMAIL}`;
const ADMIN_FIXTURE = process.env.CERTIFY_SMOKE_ADMIN_EMAIL;
if (ADMIN_FIXTURE && ADMIN_FIXTURE !== process.env.ADMIN_EMAIL) {
  throw new Error('Start smoke tests with the same isolated ADMIN_EMAIL and CERTIFY_SMOKE_ADMIN_EMAIL');
}
if (ADMIN_FIXTURE) {
  if (!/^smoke-root-[a-z0-9-]+@example\.test$/.test(ADMIN_FIXTURE)) {
    throw new Error('Use a throwaway smoke-root-…@example.test address for isolated super admin tests');
  }
  const occupied = await sql`SELECT email FROM users WHERE email = ${ADMIN_FIXTURE}`;
  if (occupied.length) throw new Error('The super admin fixture address is already in use');
}


let failures = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '  PASS' : '  FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
  if (!cond) failures++;
};

// --- setup: throwaway user + token -------------------------------------------
await sql`INSERT INTO users (email, name, role) VALUES (${TEST_EMAIL}, 'Audit Smoke', 'user')
          ON CONFLICT (email) DO NOTHING`;
const [user] = await sql`SELECT id FROM users WHERE email = ${TEST_EMAIL}`;
await sql`INSERT INTO platform_access (email) VALUES (${TEST_EMAIL})`;
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
    method: 'POST', headers, body: JSON.stringify({ eventId: EVENT_ID, ...body }),
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

async function verifyProfile(headers) {
  const response = await fetch(`${BASE}/api/auth/verify`, { headers });
  return (await response.json().catch(() => ({}))).user;
}

function setIssuance(headers, email, canIssueCertificates) {
  return fetch(`${BASE}/api/admin/access`, {
    method: 'PUT', headers, body: JSON.stringify({ email, canIssueCertificates }),
  });
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

  check('an allowlisted user can sign in with issuance disabled',
    (await verifyProfile(cookieAuth))?.canIssueCertificates === false);
  for (const [path, method] of [
    ['certificates/register', 'POST'], ['send-email-v2', 'POST'],
    ['auth/google/tokens', 'POST'], ['dashboard', 'GET'], ['templates', 'GET'], ['workspace-draft', 'GET'],
  ]) {
    const response = await fetch(`${BASE}/api/${path}`, { method, headers: cookieAuth });
    check(`${method} ${path} requires an issuance grant`,
      response.status === 403 && response.headers.get('X-Certify-Issuance-Required') === '1');
  }
  check('signed-out issuance request still returns 401',
    (await fetch(`${BASE}/api/dashboard`)).status === 401);
  check('regular users cannot grant themselves issuance',
    (await setIssuance(cookieAuth, TEST_EMAIL, true)).status === 403);
  await sql`UPDATE platform_access SET can_issue_certificates = true WHERE email = ${TEST_EMAIL}`;
  check('issuance grant appears in an existing session', (await verifyProfile(cookieAuth))?.canIssueCertificates === true);

  const issuerName = 'Smoke Test Issuer';
  await sql`UPDATE users SET issued_by_name = ${issuerName} WHERE id = ${user.id}`;

  // 1. First registration
  const batch1 = {
    eventName: EVENT,
    certificates: [
      { recipientName: 'Alice Smith', recipientEmail: 'alice@example.com', rowData: { Name: 'Alice Smith', Private: 'not printed' } },
      { recipientName: 'Bob Jones', recipientEmail: 'bob@example.com', rowData: { Name: 'Bob Jones' } },
      { recipientName: 'Carol NoEmail', rowData: { Name: 'Carol NoEmail' } },
    ],
  };
  const newOrigin = 'https://wecertify.tech';
  const legacyOrigin = 'https://certify-v2.mgbuilds.in';
  const r1 = await register({
    ...batch1, design: { ...DESIGN, verificationOrigin: 'https://unapproved.example.test' }, label: 'Attendees',
  }, { ...auth, Origin: newOrigin });
  check('initial batch registers (200)', r1.status === 200, `status=${r1.status} ${r1.data.detail ?? ''}`);
  check('3 ids returned', Array.isArray(r1.data.ids) && r1.data.ids.length === 3);
  check('3 newly registered', r1.data.newlyRegisteredCount === 3, `got ${r1.data.newlyRegisteredCount}`);
  check('issuance saves the approved origin and ignores the domain submitted in the design',
    r1.data.verificationOrigin === newOrigin);

  // 2. Exact same batch again → identical ids (idempotent, no duplicates)
  const r2 = await register({ ...batch1, design: DESIGN, label: 'Attendees' }, { ...auth, Origin: legacyOrigin });
  check('re-register is idempotent (200)', r2.status === 200, `status=${r2.status}`);
  check('same ids returned', JSON.stringify(r1.data.ids) === JSON.stringify(r2.data.ids));
  check('registration retries from another public domain retain the issued QR origin',
    r2.data.verificationOrigin === newOrigin);
  const issuedDesign = await (await fetch(`${BASE}/api/events/${EVENT_ID}/design`, { headers: cookieAuth })).json();
  check('dashboard reloads the saved QR origin', issuedDesign.design?.verificationOrigin === newOrigin);
  check('all reused, none new', r2.data.newlyRegisteredCount === 0 && r2.data.reusedCount === 3,
    `new=${r2.data.newlyRegisteredCount} reused=${r2.data.reusedCount}`);

  const differentCase = await register({ ...batch1, eventName: EVENT.toLowerCase() });
  check('event ID is authoritative even when the submitted name differs',
    differentCase.status === 200 && differentCase.data.eventId === r1.data.eventId &&
    JSON.stringify(differentCase.data.ids) === JSON.stringify(r1.data.ids));

  const duplicate = { recipientName: 'Duplicate Row', recipientEmail: 'duplicate@example.com' };
  const duplicates = await register({ eventId: randomUUID(), eventName: EVENT + ' Duplicate', design: DESIGN, certificates: [duplicate, duplicate] });
  check('an identical duplicate counts as one insert and one reuse',
    duplicates.status === 200 && duplicates.data.ids[0] === duplicates.data.ids[1] &&
    duplicates.data.newlyRegisteredCount === 1 && duplicates.data.reusedCount === 1);

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

  check('public verification includes the configured issuer and withholds the recipient email',
    vd.issuedBy === issuerName && !('recipientEmail' in vd));
  const ownerVerification = await (await fetch(`${BASE}/api/verify/${r1.data.ids[0]}`, { headers: cookieAuth })).json();
  check('the issuer can see the full recipient email on verification', ownerVerification.recipientEmail === 'alice@example.com');

  check('verification responses are protected against stale caches', v.headers.get('cache-control')?.includes('no-store'));

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
  const dCookie = await fetch(`${BASE}/api/dashboard?eventId=${EVENT_ID}`, { headers: cookieAuth });
  const ddCookie = await dCookie.json().catch(() => ({}));
  check('cookie session authenticates (no bearer header)', dCookie.status === 200 && ddCookie.event?.eventId === EVENT_ID,
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

  // 7c. The public artifact reads only immutable issued data.
  await sql`
    INSERT INTO templates (user_id, name, image_data, width, height, layout_config)
    VALUES (${user.id}, ${EVENT}, ${TINY_PNG}, 1, 1, ${JSON.stringify(DESIGN.layoutConfig)}::jsonb)`;

  const assetOk = await fetch(`${BASE}/api/verify/${r1.data.ids[0]}/asset`);
  const assetData = await assetOk.json().catch(() => ({}));
  check('asset endpoint returns render spec for valid cert (200)', assetOk.status === 200 && assetData.status === 'ok',
    `status=${assetOk.status}`);
  check('asset resolves the template', Boolean(assetData.template?.imageData),
    `template=${Boolean(assetData.template)}`);
  check('public downloads reuse the origin saved at issuance', assetData.verificationOrigin === newOrigin);
  check('asset returns only template-referenced fields',
    assetData.fields?.Name === 'Alice Smith' && !('Roll' in (assetData.fields ?? {})) &&
      Object.keys(assetData.fields ?? {}).length === 1,
    `fields=${JSON.stringify(assetData.fields)}`);

  const templatePath = `${BASE}/api/templates`;
  const [saved] = await sql`SELECT id FROM templates WHERE user_id = ${user.id} AND name = ${EVENT}`;
  const alternateImage =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j66kAAAAASUVORK5CYII=';
  const saveTemplate = (imageData, layoutConfig) => fetch(templatePath, {
    method: 'POST', headers: cookieAuth, body: JSON.stringify({ name: EVENT, imageData, layoutConfig }),
  });
  const priorTemplate = await saveTemplate(TINY_PNG, { boxes: [{ field: 'Name' }] });
  const latestTemplate = await saveTemplate(alternateImage, { boxes: [{ field: 'Name' }, { field: 'Private' }] });
  const savedTemplate = await (await fetch(`${templatePath}/${saved.id}`, { headers: cookieAuth })).json();
  check('cookie template saves replace changed artwork', priorTemplate.status === 200
    && latestTemplate.status === 200 && savedTemplate.template?.imageData === alternateImage);

  const afterEdit = await (await fetch(`${BASE}/api/verify/${r1.data.ids[0]}/asset`)).json();
  check('reusable template edits leave old artwork and public fields intact',
    afterEdit.template?.imageData === TINY_PNG && afterEdit.fields?.Name === 'Alice Smith' && !('Private' in (afterEdit.fields || {})));
  const blockedDesign = await register({ ...batch1, label: 'Attendees', design: { ...DESIGN, imageData: alternateImage } });
  check('an issued design cannot be replaced through registration', blockedDesign.status === 409);
  const changedRow = await register({ certificates: [{
    ...batch1.certificates[0], rowData: { Name: 'Changed original' },
  }] });
  check('re-registering edited recipient values reports a conflict', changedRow.data.outcomes?.[0]?.status === 'conflict');
  const afterConflict = await (await fetch(`${BASE}/api/verify/${r1.data.ids[0]}/asset`)).json();
  check('recipient conflicts leave the issued public record intact', afterConflict.fields?.Name === 'Alice Smith');

  const copyId = randomUUID();
  const copy = await register({ eventId: copyId, eventName: EVENT, label: 'Speakers', design: DESIGN, certificates: [batch1.certificates[0]] });
  const detail = await (await fetch(`${BASE}/api/dashboard?eventId=${copyId}&includeRowData=true`, { headers: cookieAuth })).json();
  check('same-name copies issue independently and UUID-based details return only their records',
    copy.status === 200 && copy.data.ids[0] !== r1.data.ids[0] && detail.event?.label === 'Speakers' && detail.participants?.length === 1);
  const deleted = await fetch(`${BASE}/api/dashboard?eventId=${copyId}`, { method: 'DELETE', headers: cookieAuth });
  check('issued events cannot be deleted through the dashboard endpoint', deleted.status === 409);

  const legacyId = randomUUID();
  const legacyCertId = randomUUID();
  const legacyTitle = 'Historical smoke event';
  await sql`INSERT INTO events (id, user_id, name) VALUES (${legacyId}, ${user.id}, ${legacyTitle})`;
  await sql`INSERT INTO templates (user_id, name, image_data, width, height, layout_config)
    VALUES (${user.id}, ${legacyTitle}, ${TINY_PNG}, 1, 1, ${JSON.stringify(DESIGN.layoutConfig)}::jsonb)`;
  const legacyHash = createHash('sha256').update(legacyCertId).digest('hex');
  await sql`INSERT INTO certificates (id, user_id, event_id, event_name, template_name, token_hash, recipient_name, row_data)
    VALUES (${legacyCertId}, ${user.id}, ${legacyId}, ${legacyTitle}, ${legacyTitle}, ${legacyHash}, 'Historical Recipient', '{"Name":"Historical Recipient", "Private":"Hidden"}')`;
  const legacyVerification = await (await fetch(`${BASE}/api/verify/${legacyCertId}`)).json();
  const unconfirmedAsset = await fetch(`${BASE}/api/verify/${legacyCertId}/asset`);
  check('legacy certificates still verify while their unconfirmed downloads are unavailable',
    legacyVerification.status === 'valid' && unconfirmedAsset.status === 404);
  const legacyPath = `${BASE}/api/events/${legacyId}/design`;
  const legacy = await (await fetch(legacyPath, { headers: cookieAuth })).json();
  const confirmedLegacy = await fetch(legacyPath, {
    method: 'POST', headers: cookieAuth, body: JSON.stringify({ revision: legacy.revision }),
  });
  const lockedLegacy = await (await fetch(`${BASE}/api/verify/${legacyCertId}/asset`, {
    headers: { Origin: newOrigin },
  })).json();
  check('owner confirmation freezes legacy artwork and only its printed fields',
    confirmedLegacy.status === 200 && lockedLegacy.fields?.Name === 'Historical Recipient' && !('Private' in (lockedLegacy.fields || {})));
  check('historic certs without a stored QR origin use the previous public domain',
    lockedLegacy.verificationOrigin === legacyOrigin);

  const versionsPath = `${templatePath}/${saved.id}/versions`;
  const { versions } = await (await fetch(versionsPath, { headers: cookieAuth })).json();
  const restore = { method: 'POST', body: JSON.stringify({ versionId: versions?.[0]?.id }) };
  const cookieWithoutMarker = { Cookie: `certify_session=${token}`, 'Content-Type': 'application/json' };
  const blockedRestore = await fetch(versionsPath, { ...restore, headers: cookieWithoutMarker });
  check('cookie template restore requires a mutation marker (403)', blockedRestore.status === 403);
  const restored = await fetch(versionsPath, { ...restore, headers: cookieAuth });
  const restoredLayout = await restored.json();
  check('template saves write version history and restore the selected layout',
    versions?.length === 2 && restored.status === 200 && restoredLayout.template?.layoutConfig?.boxes?.length === 1);

  const draftPath = `${BASE}/api/workspace-draft`;
  const draftState = {
    savedAt: new Date().toISOString(), eventName: EVENT, csvHeaders: ['Name'],
    csvRows: Array.from({ length: 2001 }, (_, i) => ({ Name: `Synthetic recipient ${i}` })),
    csvFileName: 'roster.csv', boxes: [{ field: 'Name' }], qrZones: [], images: [], templateRef: null,
  };
  const writeDraft = (state, headers = cookieAuth) => fetch(draftPath, {
    method: 'PUT', headers, body: JSON.stringify({ state }),
  });
  const noMarkerDraft = await writeDraft(draftState, cookieWithoutMarker);
  check('cookie draft writes require a mutation marker (403)', noMarkerDraft.status === 403);
  const draftWrite = await writeDraft(draftState);
  const staleDraft = await writeDraft({ ...draftState, savedAt: new Date(0).toISOString(), csvRows: [] });
  const largeDraft = await writeDraft({ ...draftState, csvRows: [{ Name: 'é'.repeat(1_400_000) }] });
  const { draft } = await (await fetch(draftPath, { headers: cookieAuth })).json();
  check('draft retains every row after a stale write and an oversized UTF-8 upload',
    draftWrite.status === 200 && staleDraft.status === 200 && largeDraft.status === 413
    && draft?.state?.csvRows?.length === 2001);

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
  const eventForSettings = { id: EVENT_ID };
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

  const simultaneousScans = await Promise.all(
    Array.from({ length: 4 }, async () => (await (await fetch(`${BASE}/api/verify/${bobId}`)).json()).verificationCount)
  );
  check('overlapping verification requests each increment the counter',
    simultaneousScans.toSorted((a, b) => a - b).join(',') === '3,4,5,6');

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
  check('regular session exposes the user platform role', (await verifyProfile(cookieAuth))?.platformRole === 'user');
  const adminForbidden = await fetch(`${BASE}/api/admin/overview`, { headers: auth });
  check('admin API forbidden for regular user (403)', adminForbidden.status === 403,
    `status=${adminForbidden.status}`);
  await sql`UPDATE platform_access SET role = 'super_admin' WHERE email = ${TEST_EMAIL}`;
  const fakeRoot = await fetch(`${BASE}/api/admin/overview`, { headers: auth });
  check('a stored super_admin role cannot override ADMIN_EMAIL', fakeRoot.status === 403);
  await sql`UPDATE platform_access SET role = 'admin' WHERE email = ${TEST_EMAIL}`;
  check('delegated moderation is visible in the existing session', (await verifyProfile(cookieAuth))?.platformRole === 'admin');
  const adminOk = await fetch(`${BASE}/api/admin/overview`, { headers: auth });
  const adminData = await adminOk.json().catch(() => ({}));
  check('admin overview readable after elevation (200)',
    adminOk.status === 200 && typeof adminData.overview?.accounts === 'number',
    `status=${adminOk.status} accounts=${adminData.overview?.accounts}`);
  const grantBody = JSON.stringify({ email: INVITED_EMAIL, role: 'user' });
  const grantNoCsrf = await fetch(`${BASE}/api/admin/access`, {
    method: 'POST',
    headers: { Cookie: cookieAuth.Cookie, 'Content-Type': 'application/json' },
    body: grantBody,
  });
  check('admin grant requires the cookie CSRF marker', grantNoCsrf.status === 403);
  const grant = await fetch(`${BASE}/api/admin/access`, {
    method: 'POST', headers: auth, body: grantBody,
  });
  const grantData = await grant.json().catch(() => ({}));
  const invited = (grantData.access ?? []).find((row) => row.email === INVITED_EMAIL);
  check('allowlist grant applies default mail limits',
    grant.status === 200 && invited?.mailsPerMinute === 55 && invited?.mailsPerSecond === 8);
  check('sign-in grant leaves issuance disabled', invited?.canIssueCertificates === false);
  check('delegated admin cannot change their own issuance',
    (await setIssuance(auth, TEST_EMAIL, false)).status === 403);

  const limitsBody = JSON.stringify({ email: INVITED_EMAIL, mailsPerMinute: 12, mailsPerSecond: 2 });
  const patch = (headers) => fetch(`${BASE}/api/admin/access`, { method: 'PATCH', headers, body: limitsBody });
  check('delegated admin cannot edit mail limits', (await patch(auth)).status === 403);
  if (ADMIN_FIXTURE) {
    const [rootUser] = await sql`INSERT INTO users (email, name, role) VALUES (${ADMIN_FIXTURE}, 'Smoke Root', 'admin')
                               RETURNING id`;
    const rootToken = jwt.sign({ userId: rootUser.id, issuedAtMs: Date.now() }, process.env.JWT_SECRET,
      { expiresIn: '1h', algorithm: 'HS256' });
    const rootAuth = { ...cookieAuth, Cookie: `certify_session=${rootToken}` };
    check('configured super admin session exposes the super_admin platform role',
      (await verifyProfile(rootAuth))?.platformRole === 'super_admin');
    check('superadmin starts without issuance', (await verifyProfile(rootAuth))?.canIssueCertificates === false);
    check('superadmin can manage access with issuance disabled',
      (await fetch(`${BASE}/api/admin/access`, { headers: rootAuth })).status === 200);
    check('superadmin needs an explicit issuance grant',
      (await register({}, rootAuth)).status === 403);
    check('delegated admin cannot grant the superadmin issuance',
      (await setIssuance(auth, ADMIN_FIXTURE, true)).status === 403);
    check('superadmin can revoke issuance for another admin',
      (await setIssuance(rootAuth, TEST_EMAIL, false)).status === 200 &&
      (await verifyProfile(cookieAuth))?.canIssueCertificates === false);
    const publicAfterRevocation = await fetch(`${BASE}/api/verify/${bobId}`);
    check('issued certificates still verify and download after the issuer loses access',
      (await publicAfterRevocation.json()).status === 'valid' &&
      (await fetch(`${BASE}/api/verify/${bobId}/asset`)).status === 200);
    check('superadmin can re-enable issuance for another admin',
      (await setIssuance(rootAuth, TEST_EMAIL, true)).status === 200 &&
      (await verifyProfile(cookieAuth))?.canIssueCertificates === true);
    check('issuance grants require the cookie CSRF marker',
      (await setIssuance({ Cookie: rootAuth.Cookie, 'Content-Type': 'application/json' }, ADMIN_FIXTURE, true)).status === 403);
    check('issuance grants require a boolean value',
      (await setIssuance(rootAuth, ADMIN_FIXTURE, 'true')).status === 400);
    check('superadmin can explicitly grant their own issuance',
      (await setIssuance(rootAuth, ADMIN_FIXTURE, true)).status === 200 &&
      (await verifyProfile(rootAuth))?.canIssueCertificates === true &&
      (await fetch(`${BASE}/api/dashboard`, { headers: rootAuth })).status === 200);
    check('superadmin can revoke their own issuance and keep moderation',
      (await setIssuance(rootAuth, ADMIN_FIXTURE, false)).status === 200 &&
      (await fetch(`${BASE}/api/dashboard`, { headers: rootAuth })).status === 403 &&
      (await fetch(`${BASE}/api/admin/access`, { headers: rootAuth })).status === 200);
    const result = await patch(rootAuth);
    const payload = await result.json().catch(() => ({}));
    check('configured super admin can edit both limits', result.status === 200 &&
      payload.access?.some((row) => row.email === INVITED_EMAIL && row.mailsPerMinute === 12 && row.mailsPerSecond === 2));
    const persisted = await fetch(`${BASE}/api/admin/access`, { headers: rootAuth });
    check('edited limits persist on reload',
      (await persisted.json()).access?.some((row) => row.email === INVITED_EMAIL && row.mailsPerMinute === 12 && row.mailsPerSecond === 2));
    const noExtraRoot = await fetch(`${BASE}/api/admin/access`, {
      method: 'POST', headers: rootAuth, body: JSON.stringify({ email: INVITED_EMAIL, role: 'super_admin' }),
    });
    check('admin API cannot create a second super admin', noExtraRoot.status === 400);
    const invalidLimits = await fetch(`${BASE}/api/admin/access`, {
      method: 'PATCH', headers: rootAuth,
      body: JSON.stringify({ email: INVITED_EMAIL, mailsPerMinute: 0, mailsPerSecond: 999 }),
    });
    check('mail limit bounds are validated', invalidLimits.status === 400);
  }
  const [invitedUser] = await sql`INSERT INTO users (email, name) VALUES (${INVITED_EMAIL}, 'Smoke Invite') RETURNING id`;
  const invitedToken = jwt.sign({ userId: invitedUser.id, issuedAtMs: Date.now() }, process.env.JWT_SECRET,
    { expiresIn: '1h', algorithm: 'HS256' });
  const inviteAuth = { ...cookieAuth, Cookie: `certify_session=${invitedToken}` };
  const verifyInvite = () => fetch(`${BASE}/api/auth/verify`, { headers: inviteAuth });
  check('allowlisted invite can use an authenticated endpoint', (await verifyInvite()).status === 200);
  check('delegated admin can grant issuance to a regular user',
    (await setIssuance(auth, INVITED_EMAIL, true)).status === 200 &&
    (await verifyProfile(inviteAuth))?.canIssueCertificates === true);
  const foreignOverview = await (await fetch(`${BASE}/api/dashboard`, { headers: inviteAuth })).json();
  check('another issuer cannot list the owner’s event',
    Array.isArray(foreignOverview.events) && !foreignOverview.events.some((event) => event.eventId === EVENT_ID));
  const foreignEvent = await fetch(`${BASE}/api/dashboard?eventId=${EVENT_ID}`, { headers: inviteAuth });
  const foreignDesign = await fetch(`${BASE}/api/events/${EVENT_ID}/design`, { headers: inviteAuth });
  const foreignTemplate = await fetch(`${BASE}/api/templates/${saved.id}`, { headers: inviteAuth });
  check('another issuer cannot read the private event, design, or template',
    foreignEvent.status === 404 && foreignDesign.status === 404 && foreignTemplate.status === 404);
  const foreignDraft = await (await fetch(`${BASE}/api/workspace-draft`, { headers: inviteAuth })).json();
  check('another issuer cannot read the owner’s workspace draft', foreignDraft.draft === null);
  const foreignVerification = await (await fetch(`${BASE}/api/verify/${bobId}`, { headers: inviteAuth })).json();
  check('another issuer receives public verification fields only',
    foreignVerification.status === 'valid' && !('recipientEmail' in foreignVerification));
  const foreignEdit = await fetch(`${BASE}/api/events/${EVENT_ID}`, {
    method: 'PATCH', headers: inviteAuth, body: JSON.stringify({ trackScans: true }),
  });
  check('another issuer cannot update event settings', foreignEdit.status === 404);
  check('issuance revocation immediately blocks registration and mail in the same session',
    (await setIssuance(auth, INVITED_EMAIL, false)).status === 200 &&
    (await register({}, inviteAuth)).status === 403 &&
    (await fetch(`${BASE}/api/send-email-v2`, { method: 'POST', headers: inviteAuth })).status === 403 &&
    (await verifyProfile(inviteAuth))?.canIssueCertificates === false);
  const revoke = await fetch(`${BASE}/api/admin/access?email=${encodeURIComponent(INVITED_EMAIL)}`, {
    method: 'DELETE', headers: auth,
  });
  check('allowlist revoke works (200)', revoke.status === 200, `status=${revoke.status}`);
  check('revocation rejects the existing session', (await verifyInvite()).status === 401);
  await fetch(`${BASE}/api/admin/access`, { method: 'POST', headers: auth, body: grantBody });
  check('re-granting access does not revive the old session', (await verifyInvite()).status === 401);
  await sql`UPDATE platform_access SET role = 'user' WHERE email = ${TEST_EMAIL}`;
  check('demotion is reflected in the existing session', (await verifyProfile(cookieAuth))?.platformRole === 'user');
  const adminAfterDemote = await fetch(`${BASE}/api/admin/overview`, { headers: auth });
  check('admin API forbidden again after demotion (403)', adminAfterDemote.status === 403,
    `status=${adminAfterDemote.status}`);

  // 7f. Nonce regression sweep: every app page must be server-rendered per
  //     request so the proxy's nonce CSP applies to its inline scripts. A page
  //     that forgets connection() prerenders static HTML whose inline scripts
  //     the CSP blocks (silent white-screen).
  for (const page of ['/', '/login', '/dashboard', '/editor', '/admin', '/privacy', '/terms']) {
    const response = await fetch(`${BASE}${page}`, { redirect: 'manual' });
    const html = await response.text();
    const inline = [...html.matchAll(/<script(?![^>]*\ssrc=)(?![^>]*\snonce=)[^>]*>/g)].length;
    const nonced = (html.match(/nonce="/g) || []).length;
    check(`nonce CSP: ${page} has no un-nonce'd inline scripts`, inline === 0, `inline=${inline} nonced=${nonced}`);
    if (page === '/') {
      check('signed-out homepage describes WeCertify and links to sign-in and both policies',
        response.status === 200 && html.includes('WeCertify') && html.includes('Design, issue, and verify certificates') &&
        ['/login', '/privacy', '/terms'].every((path) => html.includes(`href="${path}"`)));
    }
    if (page === '/privacy') {
      check('public privacy policy discloses the Gmail scope and Limited Use',
        response.status === 200 && html.includes('https://www.googleapis.com/auth/gmail.send') &&
        html.includes('Limited Use requirements'));
    }
    if (page === '/terms') {
      check('terms are accessible without sign-in', response.status === 200 && html.includes('Terms of Service'));
    }
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
  await sql`DELETE FROM platform_access WHERE email IN (${TEST_EMAIL}, ${INVITED_EMAIL})`;
  await sql`DELETE FROM users WHERE email IN (${TEST_EMAIL}, ${INVITED_EMAIL})`;
  if (ADMIN_FIXTURE) {
    await sql`DELETE FROM platform_access WHERE email = ${ADMIN_FIXTURE}`;
    await sql`DELETE FROM users WHERE email = ${ADMIN_FIXTURE}`;
  }
  console.log('  cleanup done (test user + certificates removed)');
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
