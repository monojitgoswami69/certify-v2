import { NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { inArray } from 'drizzle-orm';
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

  let body: { certificates?: RegisterItem[]; eventName?: string };
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

    parsedItems.push({
      index: i,
      name,
      email,
      eventName: itemEventName,
      templateName,
      fingerprint,
    });
  }

  try {
    // 1. Query existing records matching any fingerprint in the batch
    const fingerprintsArray = Array.from(fingerprintSet);
    const existingCerts =
      fingerprintsArray.length > 0
        ? await db
            .select({
              id: certificates.id,
              recordFingerprint: certificates.recordFingerprint,
            })
            .from(certificates)
            .where(inArray(certificates.recordFingerprint, fingerprintsArray))
        : [];

    const existingMap = new Map<string, string>();
    for (const cert of existingCerts) {
      if (cert.recordFingerprint) {
        existingMap.set(cert.recordFingerprint, cert.id);
      }
    }

    // 2. Determine which items need newly generated IDs vs existing IDs
    const resultIds: string[] = new Array(parsedItems.length);
    const newRowsToInsert = [];

    for (const item of parsedItems) {
      if (existingMap.has(item.fingerprint)) {
        // Idempotent hit: Reuse existing certificate ID without inserting duplicate row
        resultIds[item.index] = existingMap.get(item.fingerprint)!;
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
          status: 'issued' as const,
        });
      }
    }

    // 3. Batch insert new records if any
    if (newRowsToInsert.length > 0) {
      await db.insert(certificates).values(newRowsToInsert);
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
