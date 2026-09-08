import { NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { inArray, eq } from 'drizzle-orm';
import { getAuthUserFromRequest, unauthorizedResponse } from '../../../../lib/server-auth';
import { db } from '../../../../lib/db';
import { certificates } from '../../../../db/schema';
import { generateCertificateId, hashToken } from '../../../../lib/verification';

const MAX_BATCH = 2000;

interface RegisterItem {
  recipientName?: unknown;
  recipientEmail?: unknown;
  rowData?: unknown;
  templateName?: unknown;
  eventName?: unknown;
  isStatic?: unknown;
}

function computeRecordFingerprint(
  eventName: string,
  recipientName: string,
  recipientEmail: string | null
): string {
  const normEvent = eventName.trim().toLowerCase();
  const normEmail = (recipientEmail || '').trim().toLowerCase();
  const normName = recipientName.trim().toLowerCase();

  // If email exists, eventName + recipientEmail is the canonical unique identity
  if (normEmail && normEmail.includes('@')) {
    return createHash('sha256').update(`event:${normEvent}|email:${normEmail}`).digest('hex');
  }

  // If no email, hash eventName + recipientName
  return createHash('sha256').update(`event:${normEvent}|name:${normName}`).digest('hex');
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
      ? body.eventName.trim()
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

  for (let i = 0; i < items.length; i++) {
    const item = items[i] ?? {};
    const name = typeof item.recipientName === 'string' ? item.recipientName.trim() : '';
    if (!name) {
      return NextResponse.json(
        { detail: `certificates[${i}].recipientName is required` },
        { status: 400 }
      );
    }
    let email =
      typeof item.recipientEmail === 'string' && item.recipientEmail.includes('@')
        ? item.recipientEmail.trim()
        : null;

    const rowData = (item.rowData ?? null) as Record<string, string> | null;

    // Fallback: extract email from rowData if not explicitly provided
    if (!email && rowData && typeof rowData === 'object') {
      for (const [key, val] of Object.entries(rowData)) {
        if (
          typeof val === 'string' &&
          val.includes('@') &&
          /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val.trim())
        ) {
          email = val.trim();
          break;
        }
      }
    }

    const itemEventName =
      typeof item.eventName === 'string' && item.eventName.trim()
        ? item.eventName.trim()
        : batchEventName;

    const templateName =
      typeof item.templateName === 'string' ? item.templateName.slice(0, 200) : null;

    const fingerprint = computeRecordFingerprint(itemEventName, name, email);
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
    const existingCerts: Array<{ id: string; recordFingerprint: string | null; rowData: unknown }> = [];
    const FINGERPRINT_CHUNK_SIZE = 500;

    for (let i = 0; i < fingerprintsArray.length; i += FINGERPRINT_CHUNK_SIZE) {
      const chunk = fingerprintsArray.slice(i, i + FINGERPRINT_CHUNK_SIZE);
      if (chunk.length > 0) {
        const chunkResults = await db
          .select({
            id: certificates.id,
            recordFingerprint: certificates.recordFingerprint,
            rowData: certificates.rowData,
          })
          .from(certificates)
          .where(inArray(certificates.recordFingerprint, chunk));
        existingCerts.push(...chunkResults);
      }
    }

    const existingMap = new Map<string, string>();
    const existingWithoutRowData = new Map<string, string>();
    for (const cert of existingCerts) {
      if (cert.recordFingerprint) {
        existingMap.set(cert.recordFingerprint, cert.id);
        if (!cert.rowData) {
          existingWithoutRowData.set(cert.recordFingerprint, cert.id);
        }
      }
    }

    // 2. Determine which items need newly generated IDs vs existing IDs
    const resultIds: string[] = new Array(parsedItems.length);
    const newRowsToInsert = [];
    const updatesToApply: Array<{ id: string; rowData: Record<string, string> }> = [];

    for (const item of parsedItems) {
      if (existingMap.has(item.fingerprint)) {
        // Idempotent hit: Reuse existing certificate ID without inserting duplicate row
        const existingId = existingMap.get(item.fingerprint)!;
        resultIds[item.index] = existingId;

        // Queue rowData update if previously missing
        if (existingWithoutRowData.has(item.fingerprint) && item.rowData) {
          updatesToApply.push({ id: existingId, rowData: item.rowData });
          existingWithoutRowData.delete(item.fingerprint);
        }
      } else {
        // New record: Generate unique certificate ID
        const newId = generateCertificateId();
        resultIds[item.index] = newId;
        existingMap.set(item.fingerprint, newId); // Cache in case of duplicates within same CSV

        newRowsToInsert.push({
          id: newId,
          tokenHash: hashToken(newId),
          eventName: item.eventName,
          recordFingerprint: item.fingerprint,
          recipientName: item.name,
          recipientEmail: item.email,
          templateName: item.templateName,
          status: item.isStatic ? 'static' : 'issued',
          rowData: item.rowData,
        });
      }
    }

    // 3. Execute rowData updates in concurrent batches (eliminates sequential N+1 bottleneck)
    if (updatesToApply.length > 0) {
      const UPDATE_BATCH_SIZE = 25;
      for (let i = 0; i < updatesToApply.length; i += UPDATE_BATCH_SIZE) {
        const batch = updatesToApply.slice(i, i + UPDATE_BATCH_SIZE);
        await Promise.all(
          batch.map((u) =>
            db
              .update(certificates)
              .set({ rowData: u.rowData })
              .where(eq(certificates.id, u.id))
          )
        );
      }
    }

    // 4. Batch insert new records in chunks (avoids exceeding Neon/PostgreSQL parameter caps)
    if (newRowsToInsert.length > 0) {
      const INSERT_CHUNK_SIZE = 300;
      for (let i = 0; i < newRowsToInsert.length; i += INSERT_CHUNK_SIZE) {
        const chunk = newRowsToInsert.slice(i, i + INSERT_CHUNK_SIZE);
        await db.insert(certificates).values(chunk);
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
      { detail: error instanceof Error ? error.message : 'Failed to register certificates' },
      { status: 500 }
    );
  }
}
