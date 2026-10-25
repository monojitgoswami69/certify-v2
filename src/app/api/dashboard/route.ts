import { NextResponse } from 'next/server';
import { mutationAllowed, forbiddenCsrfResponse } from '../../../lib/server-auth';
import { and, desc, eq, isNull, or, sql } from 'drizzle-orm';
import fs from 'fs';
import path from 'path';
import { db } from '../../../lib/db';
import { certificates, events as eventsTable, templates } from '../../../db/schema';
import { unauthorizedResponse } from '../../../lib/server-auth';
import { getAuthenticatedUser } from '../../../lib/accounts';
import { env } from '../../../lib/env';
import { log, requestIdOf } from '../../../lib/logger';

export const dynamic = 'force-dynamic';

export interface DashboardParticipant {
  id: string;
  recipientName: string;
  recipientEmail: string | null;
  status: string; // 'issued' | 'revoked' | 'static'
  issuedAt: string;
  templateName: string | null;
  rowData?: Record<string, string> | null;
}

export interface DashboardEventSummary {
  eventName: string;
  certificateCount: number;
  activeCount: number;
  revokedCount: number;
  firstIssuedAt: string;
  lastIssuedAt: string;
  templateName: string | null;
}

export interface DashboardStats {
  totalEvents: number;
  totalCertificates: number;
  activeCertificates: number;
  revokedCertificates: number;
}

/**
 * Resolves the events row for a requested event name. Returns null when the
 * account has no event by that name.
 */
async function findEventByName(userId: string, eventName: string) {
  const normalized = eventName.trim();
  if (!normalized) return null;
  const [row] = await db
    .select({ id: eventsTable.id, name: eventsTable.name })
    .from(eventsTable)
    .where(and(eq(eventsTable.userId, userId), eq(eventsTable.name, normalized)))
    .limit(1);
  return row ?? null;
}

/**
 * Certificates belonging to an event: anchored rows via event_id, plus any
 * pre-migration stragglers still carrying only the legacy event_name string
 * (blank names always belonged to the "General Event" bucket).
 */
function eventCertificatesWhere(userId: string, eventId: string, eventName: string) {
  const legacyNameMatch =
    eventName === 'General Event' || eventName === 'Unnamed Event'
      ? or(
          eq(certificates.eventName, eventName),
          isNull(certificates.eventName),
          eq(certificates.eventName, '')
        )
      : eq(certificates.eventName, eventName);
  return and(
    eq(certificates.userId, userId),
    or(eq(certificates.eventId, eventId), and(isNull(certificates.eventId), legacyNameMatch))
  );
}

export async function GET(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) {
    return unauthorizedResponse('Invalid or expired token');
  }

  if (!env.DATABASE_URL) {
    return NextResponse.json(
      { detail: 'Database is not configured (DATABASE_URL missing)' },
      { status: 503 }
    );
  }

  const { searchParams } = new URL(request.url);
  const requestedEvent = searchParams.get('event');
  const includeRowData = searchParams.get('includeRowData') === 'true';
  const includeTemplate = searchParams.get('includeTemplate') === 'true';

  try {
    // -------------------------------------------------------------
    // Detailed View Mode: Fetch participants & CSV fields for an event
    // -------------------------------------------------------------
    if (requestedEvent) {
      const decodedEventName = requestedEvent.trim();
      const event = await findEventByName(user.userId, decodedEventName);

      const selectFields = {
        id: certificates.id,
        recipientName: certificates.recipientName,
        recipientEmail: certificates.recipientEmail,
        status: certificates.status,
        issuedAt: certificates.issuedAt,
        templateName: certificates.templateName,
        ...(includeRowData ? { rowData: certificates.rowData } : {}),
      };

      const rows = event
        ? await db
            .select(selectFields)
            .from(certificates)
            .where(eventCertificatesWhere(user.userId, event.id, event.name))
            .orderBy(desc(certificates.issuedAt))
        : [];

      let activeCount = 0;
      let revokedCount = 0;
      // ISO-8601 strings sort lexicographically, so min/max need no Date objects.
      let firstIssuedAt = rows[0]?.issuedAt.toISOString() ?? new Date().toISOString();
      let lastIssuedAt = firstIssuedAt;
      const eventTemplateName: string | null =
        rows.find((r) => r.templateName)?.templateName || null;

      const participants: DashboardParticipant[] = rows.map((r) => {
        const isActive = r.status === 'issued' || r.status === 'static';
        if (isActive) activeCount++;
        else if (r.status === 'revoked') revokedCount++;

        const isoDate = r.issuedAt.toISOString();
        if (isoDate < firstIssuedAt) firstIssuedAt = isoDate;
        if (isoDate > lastIssuedAt) lastIssuedAt = isoDate;

        return {
          id: r.id,
          recipientName: r.recipientName,
          recipientEmail: r.recipientEmail,
          status: r.status,
          issuedAt: isoDate,
          templateName: r.templateName,
          rowData: includeRowData ? ((r.rowData as Record<string, string> | null) || null) : null,
        };
      });

      const eventSummary: DashboardEventSummary = {
        eventName: decodedEventName,
        certificateCount: rows.length,
        activeCount,
        revokedCount,
        firstIssuedAt,
        lastIssuedAt,
        templateName: eventTemplateName,
      };

      // Only query canvas template graphic if explicitly requested by Studio/Editor
      let matchedTemplate = null;
      if (includeTemplate) {
        try {
          const templateHeaders = await db
            .select({
              id: templates.id,
              name: templates.name,
            })
            .from(templates)
            .where(eq(templates.userId, user.userId));

          const tplBase = eventTemplateName
            ? eventTemplateName.replace(/\.[^/.]+$/, '').trim().toLowerCase()
            : '';
          const evBase = decodedEventName.trim().toLowerCase();

          let matchMeta = null;
          if (templateHeaders.length > 0) {
            matchMeta =
              templateHeaders.find((t) => t.name.trim().toLowerCase() === evBase) ||
              templateHeaders.find(
                (t) =>
                  eventTemplateName &&
                  t.name.trim().toLowerCase() === eventTemplateName.trim().toLowerCase()
              ) ||
              templateHeaders.find((t) => tplBase && t.name.trim().toLowerCase() === tplBase);
          }

          if (matchMeta) {
            const [fullTemplate] = await db
              .select({
                id: templates.id,
                name: templates.name,
                imageData: templates.imageData,
                width: templates.width,
                height: templates.height,
                layoutConfig: templates.layoutConfig,
              })
              .from(templates)
              .where(eq(templates.id, matchMeta.id))
              .limit(1);

            matchedTemplate = fullTemplate || null;
          }

          // Fallback / Auto-seed for Sample Data if not yet in templates table
          if (
            !matchedTemplate &&
            (evBase === 'sample data' ||
              tplBase === 'sample-template' ||
              eventTemplateName?.toLowerCase() === 'sample-template.png')
          ) {
            try {
              const sampleImgPath = path.join(process.cwd(), 'demo-data', 'sample-template.png');
              if (fs.existsSync(sampleImgPath)) {
                const buf = fs.readFileSync(sampleImgPath);
                const base64 = `data:image/png;base64,${buf.toString('base64')}`;
                const width = buf.readUInt32BE(16);
                const height = buf.readUInt32BE(20);
                const layoutConfig = {
                  boxes: [
                    {
                      id: 'sample-box-1',
                      x: 350,
                      y: 640,
                      w: 1300,
                      h: 75,
                      field: 'Name',
                      fontSize: 44,
                      fontColor: '#0f172a',
                      fontFamily: 'Inter',
                      hAlign: 'center',
                      vAlign: 'bottom',
                    },
                    {
                      id: 'sample-box-2',
                      x: 400,
                      y: 770,
                      w: 1200,
                      h: 50,
                      field: 'Course',
                      fontSize: 22,
                      fontColor: '#334155',
                      fontFamily: 'Inter',
                      hAlign: 'center',
                      vAlign: 'bottom',
                    },
                    {
                      id: 'sample-box-3',
                      x: 400,
                      y: 890,
                      w: 600,
                      h: 40,
                      field: 'Date',
                      fontSize: 16,
                      fontColor: '#64748b',
                      fontFamily: 'Inter',
                      hAlign: 'center',
                      vAlign: 'bottom',
                    },
                  ],
                  qrZones: [
                    {
                      id: 'sample-qr-1',
                      x: 1620,
                      y: 1040,
                      size: 190,
                      style: {
                        bodyShape: 'smooth',
                        eyeFrameShape: 'rounded',
                        eyeDotShape: 'rounded',
                        patternColor: '#000000',
                        backgroundColor: 'transparent',
                        centerShape: 'rounded',
                      },
                    },
                  ],
                  defaultFont: 'Inter',
                  defaultFontSize: 44,
                  defaultFontColor: '#0f172a',
                };

                // onConflict: a concurrent seed must not 500 on the unique name.
                await db
                  .insert(templates)
                  .values({
                    userId: user.userId,
                    name: 'Sample Data',
                    imageData: base64,
                    width,
                    height,
                    layoutConfig,
                  })
                  .onConflictDoNothing({ target: [templates.userId, templates.name] });
                const [seeded] = await db
                  .select({
                    id: templates.id,
                    name: templates.name,
                    imageData: templates.imageData,
                    width: templates.width,
                    height: templates.height,
                    layoutConfig: templates.layoutConfig,
                  })
                  .from(templates)
                  .where(and(eq(templates.userId, user.userId), eq(templates.name, 'Sample Data')))
                  .limit(1);

                matchedTemplate = seeded || null;
              }
            } catch (seedErr) {
              log.warn('dashboard', 'Could not auto-seed sample template', { requestId: requestIdOf(request) }, seedErr);
            }
          }
        } catch (err) {
          log.warn('dashboard', 'Could not fetch template for event', { requestId: requestIdOf(request) }, err);
        }
      }

      return NextResponse.json(
        {
          event: eventSummary,
          participants,
          template: matchedTemplate,
        },
        {
          headers: {
            'Cache-Control': 'no-store, max-age=0, must-revalidate',
          },
        }
      );
    }

    // -------------------------------------------------------------
    // Overview Mode: one aggregate row per event (events LEFT JOIN
    // certificates), never one row per certificate. Includes freshly
    // created events that have no certificates yet.
    // -------------------------------------------------------------
    const aggregateRows = await db
      .select({
        eventName: eventsTable.name,
        certificateCount: sql<number>`count(${certificates.id})::int`,
        activeCount: sql<number>`count(${certificates.id}) filter (where ${certificates.status} in ('issued','static'))::int`,
        revokedCount: sql<number>`count(${certificates.id}) filter (where ${certificates.status} = 'revoked')::int`,
        firstIssuedAt: sql<string | null>`min(${certificates.issuedAt})::text`,
        lastIssuedAt: sql<string | null>`max(${certificates.issuedAt})::text`,
        templateName: sql<
          string | null
        >`max(${certificates.templateName}) filter (where ${certificates.templateName} is not null)`,
        eventCreatedAt: eventsTable.createdAt,
      })
      .from(eventsTable)
      .leftJoin(
        certificates,
        and(eq(certificates.eventId, eventsTable.id), eq(certificates.userId, eventsTable.userId))
      )
      .where(eq(eventsTable.userId, user.userId))
      .groupBy(eventsTable.id, eventsTable.name, eventsTable.createdAt);

    const eventSummaries: DashboardEventSummary[] = aggregateRows
      .map((row) => {
        const fallback = row.eventCreatedAt.toISOString();
        return {
          eventName: row.eventName,
          certificateCount: row.certificateCount,
          activeCount: row.activeCount,
          revokedCount: row.revokedCount,
          firstIssuedAt: row.firstIssuedAt ? new Date(row.firstIssuedAt).toISOString() : fallback,
          lastIssuedAt: row.lastIssuedAt ? new Date(row.lastIssuedAt).toISOString() : fallback,
          templateName: row.templateName,
        };
      })
      .sort((a, b) => (a.lastIssuedAt < b.lastIssuedAt ? 1 : a.lastIssuedAt > b.lastIssuedAt ? -1 : 0));

    const stats: DashboardStats = {
      totalEvents: eventSummaries.length,
      totalCertificates: eventSummaries.reduce((sum, e) => sum + e.certificateCount, 0),
      activeCertificates: eventSummaries.reduce((sum, e) => sum + e.activeCount, 0),
      revokedCertificates: eventSummaries.reduce((sum, e) => sum + e.revokedCount, 0),
    };

    return NextResponse.json(
      {
        stats,
        events: eventSummaries,
      },
      {
        headers: {
          'Cache-Control': 'no-store, max-age=0, must-revalidate',
        },
      }
    );
  } catch (error) {
    log.error('dashboard', 'Failed to fetch dashboard data', { requestId: requestIdOf(request), userId: user.userId }, error);
    return NextResponse.json(
      { detail: 'Failed to fetch dashboard data' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request) {
  if (!mutationAllowed(request)) return forbiddenCsrfResponse();
  const user = await getAuthenticatedUser(request);
  if (!user) {
    return unauthorizedResponse('Invalid or expired token');
  }

  if (!env.DATABASE_URL) {
    return NextResponse.json(
      { detail: 'Database is not configured (DATABASE_URL missing)' },
      { status: 503 }
    );
  }

  const { searchParams } = new URL(request.url);
  const requestedEvent = searchParams.get('event');
  if (!requestedEvent) {
    return NextResponse.json({ detail: 'event query parameter is required' }, { status: 400 });
  }

  const decodedEventName = requestedEvent.trim();
  if (!decodedEventName) {
    return NextResponse.json({ detail: 'event query parameter is required' }, { status: 400 });
  }

  try {
    const event = await findEventByName(user.userId, decodedEventName);
    if (!event) {
      return NextResponse.json({
        success: true,
        eventName: decodedEventName,
        deletedCount: 0,
      });
    }

    // Single batch = single Neon HTTP call = one transaction, so the event's
    // certificates, the event row itself (cascading its batch audit records),
    // and its same-named template disappear (or survive) together.
    const deleted = await db.batch([
      db
        .delete(certificates)
        .where(eventCertificatesWhere(user.userId, event.id, event.name))
        .returning({ id: certificates.id }),
      db.delete(eventsTable).where(and(eq(eventsTable.userId, user.userId), eq(eventsTable.id, event.id))),
      db
        .delete(templates)
        .where(and(eq(templates.userId, user.userId), eq(templates.name, decodedEventName))),
    ]);

    const deletedCount = Array.isArray(deleted[0]) ? deleted[0].length : 0;

    return NextResponse.json({
      success: true,
      eventName: decodedEventName,
      deletedCount,
    });
  } catch (error) {
    log.error('dashboard', 'Failed to delete event and certificates', { requestId: requestIdOf(request), userId: user.userId }, error);
    return NextResponse.json(
      { detail: 'Failed to delete event and certificates' },
      { status: 500 }
    );
  }
}
