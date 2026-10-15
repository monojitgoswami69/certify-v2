import { NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { inArray, eq } from 'drizzle-orm';
import { getAuthUserFromRequest, unauthorizedResponse } from '../../../../lib/server-auth';
import { db } from '../../../../lib/db';
import { certificates } from '../../../../db/schema';
import { generateCertificateId, hashToken } from '../../../../lib/verification';

const MAX_BATCH = 2000;
const EMAIL_RE = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;

interface RegisterItem {
  recipientName?: unknown;
  recipientEmail?: unknown;
  rowData?: unknown;
  templateName?: unknown;
  eventName?: unknown;
  isStatic?: unknown;
}

const MAX_TEXT_LENGTH = 500;
const MAX_ROW_FIELDS = 100;

function computeRecordFingerprint(
  eventName: string,
  recipientName: string,
  recipientEmail: string | null,
  scopeEmailByName = false
): string {
  const normEvent = eventName.trim().toLowerCase();
  const normEmail = (recipientEmail || '').trim().toLowerCase();
  const normName = recipientName.trim().toLowerCase();

  // If email exists, eventName + recipientEmail is the canonical unique identity
  if (normEmail && normEmail.includes('@')) {
    const nameScope = scopeEmailByName ? `|name:${normName}` : '';
    return createHash('sha256').update(`event:${normEvent}|email:${normEmail}${nameScope}`).digest('hex');
  }

  // If no email, hash eventName + recipientName
  return createHash('sha256').update(`event:${normEvent}|name:${normName}`).digest('hex');
}

function sanitizeRowData(value: unknown): Record<string, string> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const out: Record<string, string> = {};
  let count = 0;
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (count >= MAX_ROW_FIELDS) break;
    if (val === null || val === undefined) continue;
    if (typeof val !== 'string' && typeof val !== 'number' && typeof val !== 'boolean') continue;
    out[key.slice(0, 200)] = String(val).slice(0, MAX_TEXT_LENGTH * 4);
    count++;
  }
  return out;
}

export async function POST(request: Request) {
  const username = getAuthUserFromRequest(request);
  if (!username) {
    return unauthorizedResponse('Invalid or expired token');
  }

  if (!process.env.DATABASE_URL) {
    return NextResponse.json(
      { detail: 'Certificate verification is not configured (DATABASE_URL missing)' },
      { status: 503 }
    );
  }

  let body: { certificates?: RegisterItem[]; eventName?: string; isStatic?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ detail: 'Invalid request body' }, { status: 400 });
  }

  const batchEventName =
    typeof body.eventName === 'string' && body.eventName.trim()
      ? body.eventName.trim().slice(0, MAX_TEXT_LENGTH)
      : 'General Event';

  const items = body.certificates;
  if (!Array.isArray(items) || items.length === 0) {
    return NextResponse.json(
      { detail: 'certificates must be a non-empty array' },
      { status: 400 }
    );
  }
  if (items.length > MAX_BATCH) {
    return NextResponse.json(
      { detail: `Batch too large: max ${MAX_BATCH} certificates per request` },
      { status: 400 }
    );
  }

  // Parse items & compute fingerprints
  const parsedItems = [];
  const fingerprintSet = new Set<string>();
  // Same email + different name within one batch = different people; keep them as separate certificates
  const namesByEmailFingerprint = new Map<string, string>();

  for (let i = 0; i < items.length; i++) {
    const item = items[i] ?? {};
    const name =
      typeof item.recipientName === 'string' ? item.recipientName.trim().slice(0, MAX_TEXT_LENGTH) : '';
    if (!name) {
      return NextResponse.json(
        { detail: `certificates[${i}].recipientName is required` },
        { status: 400 }
      );
    }
    let email =
      typeof item.recipientEmail === 'string' && EMAIL_RE.test(item.recipientEmail.trim())
        ? item.recipientEmail.trim().slice(0, 320)
        : null;

    const rowData = sanitizeRowData(item.rowData);

    // Fallback: extract email from rowData if not explicitly provided
    if (!email && rowData) {
      for (const val of Object.values(rowData)) {
        if (EMAIL_RE.test(val.trim())) {
          email = val.trim().slice(0, 320);
          break;
        }
      }
    }

    const itemEventName =
      typeof item.eventName === 'string' && item.eventName.trim()
        ? item.eventName.trim().slice(0, MAX_TEXT_LENGTH)
        : batchEventName;

    const templateName =
      typeof item.templateName === 'string' ? item.templateName.slice(0, 200) : null;

    let fingerprint = computeRecordFingerprint(itemEventName, name, email);
    if (email) {
      const normName = name.toLowerCase();
      const firstName = namesByEmailFingerprint.get(fingerprint);
      if (firstName === undefined) {
        namesByEmailFingerprint.set(fingerprint, normName);
      } else if (firstName !== normName) {
        fingerprint = computeRecordFingerprint(itemEventName, name, email, true);
      }
    }
    fingerprintSet.add(fingerprint);

    const isStatic = Boolean(item.isStatic ?? body.isStatic);

    parsedItems.push({
      index: i,
      name,
      email,
      eventName: itemEventName,
      templateName,
      fingerprint,
      isStatic,
      rowData,
    });
  }

  try {
    // 1. Query existing records matching any fingerprint in the batch (chunked to prevent parameter limits)
    const fingerprintsArray = Array.from(fingerprintSet);
    interface ExistingCertMeta {
      id: string;
      recipientName: string;
      recipientEmail: string | null;
      rowData: Record<string, string> | null;
      templateName: string | null;
      status: string;
    }
    const existingMap = new Map<string, ExistingCertMeta>();
    const FINGERPRINT_CHUNK_SIZE = 500;

    for (let i = 0; i < fingerprintsArray.length; i += FINGERPRINT_CHUNK_SIZE) {
      const chunk = fingerprintsArray.slice(i, i + FINGERPRINT_CHUNK_SIZE);
      if (chunk.length > 0) {
        const chunkResults = await db
          .select({
            id: certificates.id,
            recordFingerprint: certificates.recordFingerprint,
            recipientName: certificates.recipientName,
            recipientEmail: certificates.recipientEmail,
            rowData: certificates.rowData,
            templateName: certificates.templateName,
            status: certificates.status,
          })
          .from(certificates)
          .where(inArray(certificates.recordFingerprint, chunk));

        for (const cert of chunkResults) {
          if (cert.recordFingerprint) {
            existingMap.set(cert.recordFingerprint, {
              id: cert.id,
              recipientName: cert.recipientName,
              recipientEmail: cert.recipientEmail,
              rowData: (cert.rowData as Record<string, string> | null) || null,
              templateName: cert.templateName,
              status: cert.status,
            });
          }
        }
      }
    }

    // 2. Determine which items need newly generated IDs vs existing IDs
    const resultIds: string[] = new Array(parsedItems.length);
    const newRowsToInsert = [];
    const updatesToApply: Array<{
      id: string;
      recipientName?: string;
      recipientEmail?: string;
      rowData?: Record<string, string> | null;
      templateName?: string | null;
      status?: string;
    }> = [];

    for (const item of parsedItems) {
      const targetStatus = item.isStatic ? 'static' : 'issued';

      if (existingMap.has(item.fingerprint)) {
        // Idempotent hit: Reuse existing certificate ID without inserting duplicate row
        const existing = existingMap.get(item.fingerprint)!;
        resultIds[item.index] = existing.id;

        // Check if any stored field actually changed. A revoked certificate is never
        // silently re-instated by re-running a batch; that requires an explicit admin action.
        const nameChanged = item.name !== existing.recipientName;
        const emailChanged = Boolean(item.email) && item.email !== existing.recipientEmail;
        const rowDataChanged =
          item.rowData &&
          (!existing.rowData ||
            JSON.stringify(item.rowData) !== JSON.stringify(existing.rowData));
        const templateChanged =
          item.templateName && item.templateName !== existing.templateName;
        const statusChanged = targetStatus !== existing.status && existing.status !== 'revoked';

        if (nameChanged || emailChanged || rowDataChanged || templateChanged || statusChanged) {
          updatesToApply.push({
            id: existing.id,
            ...(nameChanged ? { recipientName: item.name } : {}),
            ...(emailChanged && item.email ? { recipientEmail: item.email } : {}),
            ...(rowDataChanged ? { rowData: item.rowData } : {}),
            ...(templateChanged ? { templateName: item.templateName } : {}),
            ...(statusChanged ? { status: targetStatus } : {}),
          });
          if (nameChanged) existing.recipientName = item.name;
          if (emailChanged) existing.recipientEmail = item.email;
          if (rowDataChanged && item.rowData) existing.rowData = item.rowData;
          if (templateChanged) existing.templateName = item.templateName;
          if (statusChanged) existing.status = targetStatus;
        }
      } else {
        // New record: Generate unique certificate ID
        const newId = generateCertificateId();
        resultIds[item.index] = newId;
        existingMap.set(item.fingerprint, {
          id: newId,
          recipientName: item.name,
          recipientEmail: item.email,
          rowData: item.rowData || null,
          templateName: item.templateName || null,
          status: targetStatus,
        });

        newRowsToInsert.push({
          id: newId,
          tokenHash: hashToken(newId),
          eventName: item.eventName,
          recordFingerprint: item.fingerprint,
          recipientName: item.name,
          recipientEmail: item.email,
          templateName: item.templateName,
          status: targetStatus,
          rowData: item.rowData,
        });
      }
    }

    // 3. Batch insert new records FIRST in chunks (avoids parameter caps and ensures rows exist)
    if (newRowsToInsert.length > 0) {
      const INSERT_CHUNK_SIZE = 300;
      for (let i = 0; i < newRowsToInsert.length; i += INSERT_CHUNK_SIZE) {
        const chunk = newRowsToInsert.slice(i, i + INSERT_CHUNK_SIZE);
        await db.insert(certificates).values(chunk);
      }
    }

    // 4. Execute only changed rowData & metadata updates in concurrent batches
    if (updatesToApply.length > 0) {
      const UPDATE_BATCH_SIZE = 25;
      for (let i = 0; i < updatesToApply.length; i += UPDATE_BATCH_SIZE) {
        const batch = updatesToApply.slice(i, i + UPDATE_BATCH_SIZE);
        await Promise.all(
          batch.map((u) => {
            const setValues: Record<string, unknown> = {};
            if (u.recipientName) setValues.recipientName = u.recipientName;
            if (u.recipientEmail) setValues.recipientEmail = u.recipientEmail;
            if (u.rowData) setValues.rowData = u.rowData;
            if (u.templateName) setValues.templateName = u.templateName;
            if (u.status) setValues.status = u.status;
            return db
              .update(certificates)
              .set(setValues)
              .where(eq(certificates.id, u.id));
          })
        );
      }
    }

    return NextResponse.json({
      ids: resultIds,
      count: resultIds.length,
      reusedCount: parsedItems.length - newRowsToInsert.length,
      newlyRegisteredCount: newRowsToInsert.length,
    });
  } catch (error) {
    console.error('[Certificate registration error]:', error);
    return NextResponse.json(
      { detail: 'Failed to register certificates' },
      { status: 500 }
    );
  }
}
