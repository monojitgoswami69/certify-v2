import { legacyVerificationOrigin } from '../../../../../lib/verification-links';
import { createHash } from 'node:crypto';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { certificates, events, templates } from '../../../../../db/schema';
import { requireIssuer } from '../../../../../lib/issuer-auth';
import { db } from '../../../../../lib/db';
import { freezeRenderFields } from '../../../../../lib/render-fields';
import { readIssuedDesign } from '../../../../../lib/event-design-validation';
import { eventCertificatesWhere, findOwnedEvent } from '../../../../../lib/event-records';
import { log, requestIdOf } from '../../../../../lib/logger';
import { forbiddenCsrfResponse, mutationAllowed } from '../../../../../lib/server-auth';

async function fetchDesign(userId: string, id: string) {
  const event = await findOwnedEvent(userId, { id });
  if (!event) return null;

  if (event.designLocked) {
    const [row] = await db.select({ design: events.issuedDesign, mailPreferences: events.mailPreferences }).from(events)
      .where(and(eq(events.id, id), eq(events.userId, userId))).limit(1);
    return { event, design: row?.design ?? null, revision: null, mailPreferences: row?.mailPreferences ?? null };
  }

  const [certificate] = await db.select({ name: certificates.templateName }).from(certificates)
    .where(eventCertificatesWhere(userId, id)).orderBy(desc(certificates.issuedAt)).limit(1);
  const names = [...new Set([certificate?.name, certificate?.name?.replace(/\.[^/.]+$/, ''), event.name]
    .filter((name): name is string => Boolean(name)).map((name) => name.trim().toLowerCase()))];
  const rows = await db.select({ id: templates.id, name: templates.name }).from(templates)
    .where(eq(templates.userId, userId)).orderBy(desc(templates.updatedAt));
  const match = names.map((name) => rows.find((row) => row.name.trim().toLowerCase() === name)).find(Boolean);
  if (!match) return { event, design: null, revision: null };

  const [saved] = await db.select({
    imageData: templates.imageData, width: templates.width, height: templates.height, layoutConfig: templates.layoutConfig,
  }).from(templates).where(and(eq(templates.userId, userId), eq(templates.id, match.id))).limit(1);
  const design = readIssuedDesign(saved);
  const revision = design ? createHash('sha256').update(JSON.stringify(design)).digest('hex') : null;
  return { event, design, revision };
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, denial } = await requireIssuer(request);
  if (denial) return denial;
  try {
    const result = await fetchDesign(user.userId, (await params).id);
    if (!result) return NextResponse.json({ detail: 'Event not found' }, { status: 404 });
    const design = result.design && {
      ...result.design, verificationOrigin: result.design.verificationOrigin ?? legacyVerificationOrigin(request),
    };
    return NextResponse.json({ ...result, design }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    log.error('event-design', 'Failed to load design', { requestId: requestIdOf(request) }, error);
    return NextResponse.json({ detail: 'Could not load the certificate design' }, { status: 500 });
  }
}

/** Confirm the original design of a pre-snapshot event after the issuer reviews it. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!mutationAllowed(request)) return forbiddenCsrfResponse();
  const { user, denial } = await requireIssuer(request);
  if (denial) return denial;
  const body = await request.json().catch(() => null);
  if (typeof body?.revision !== 'string') return NextResponse.json({ detail: 'Review the original design first' }, { status: 400 });

  try {
    const id = (await params).id;
    const result = await fetchDesign(user.userId, id);
    if (!result) return NextResponse.json({ detail: 'Event not found' }, { status: 404 });
    const { event, design, revision } = result;
    if (event.designLocked) return NextResponse.json({ success: true });
    if (!design || !revision || body.revision !== revision) {
      return NextResponse.json({ detail: 'The saved design changed. Review it again before confirming.' }, { status: 409 });
    }

    const rows = await db.select({ id: certificates.id, row: certificates.rowData }).from(certificates)
      .where(eventCertificatesWhere(user.userId, id));
    const updates = [];
    for (let i = 0; i < rows.length; i += 500) {
      const fields = rows.slice(i, i + 500).map((row) => ({
        id: row.id, fields: freezeRenderFields(design.layoutConfig, row.row as Record<string, string> | null),
      }));
      updates.push(db.execute(sql`
        UPDATE ${certificates}
        SET render_fields = input.fields, event_id = ${id}::uuid
        FROM jsonb_to_recordset(${JSON.stringify(fields)}::jsonb) AS input(id uuid, fields jsonb)
        WHERE ${certificates.id} = input.id AND ${certificates.userId} = ${user.userId}
          AND ${certificates.renderFields} IS NULL
          AND EXISTS (SELECT 1 FROM ${events} WHERE ${events.id} = ${id}
            AND ${events.userId} = ${user.userId} AND ${events.issuedDesign} = ${JSON.stringify(design)}::jsonb)
      `));
    }
    await db.batch([
      db.update(events).set({ issuedDesign: design }).where(and(eq(events.id, id), eq(events.userId, user.userId), isNull(events.issuedDesign))),
      ...updates,
    ]);
    return NextResponse.json({ success: true });
  } catch (error) {
    log.error('event-design', 'Failed to confirm the original design', { requestId: requestIdOf(request) }, error);
    return NextResponse.json({ detail: 'Could not confirm the original design' }, { status: 500 });
  }
}
