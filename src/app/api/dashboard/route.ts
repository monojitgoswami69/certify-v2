import { NextResponse } from 'next/server';
import { mutationAllowed, forbiddenCsrfResponse } from '../../../lib/server-auth';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { db } from '../../../lib/db';
import { certificates, events as eventsTable } from '../../../db/schema';
import { requireIssuer } from '../../../lib/issuer-auth';
import { eventCertificatesWhere, findOwnedEvent } from '../../../lib/event-records';
import { env } from '../../../lib/env';
import { log, requestIdOf } from '../../../lib/logger';
import { currentMailStatus } from '../../../lib/mail-delivery';
import type { PersistedMailStatus } from '../../../types';

export const dynamic = 'force-dynamic';

export interface DashboardParticipant {
  id: string;
  recipientName: string;
  recipientEmail: string | null;
  status: string; // 'issued' | 'revoked' | 'static'
  issuedAt: string;
  templateName: string | null;
  rowData?: Record<string, string> | null;
  renderFields?: Record<string, string> | null;
  mailStatus: PersistedMailStatus;
  mailVersion: string | null;
  mailUpdatedAt: string | null;
  mailDetail: string | null;
}

export interface DashboardEventSummary {
  eventName: string;
  label?: string | null;
  designLocked?: boolean;
  certificateCount: number;
  activeCount: number;
  revokedCount: number;
  firstIssuedAt: string;
  lastIssuedAt: string;
  templateName: string | null;
  eventId?: string | null;
  validThrough?: string | null;
  trackScans?: boolean;
  scanSummary?: {
    totalScans: number;
    scannedCertificates?: number;
    lastScannedAt: string | null;
  };
}

export interface DashboardStats {
  totalEvents: number;
  totalCertificates: number;
  activeCertificates: number;
  revokedCertificates: number;
}

export async function GET(request: Request) {
  const { user, denial } = await requireIssuer(request);
  if (denial) return denial;

  if (!env.DATABASE_URL) {
    return NextResponse.json(
      { detail: 'Database is not configured (DATABASE_URL missing)' },
      { status: 503 }
    );
  }

  const { searchParams } = new URL(request.url);
  const requestedEvent = searchParams.get('event')?.trim();
  const requestedId = searchParams.get('eventId');
  const includeRowData = searchParams.get('includeRowData') === 'true';

  try {
    // -------------------------------------------------------------
    // Detailed View Mode: Fetch participants & CSV fields for an event
    // -------------------------------------------------------------
    if (requestedId || requestedEvent) {
      const event = await findOwnedEvent(user.userId, { id: requestedId || undefined, name: requestedEvent });
      if (!event) return NextResponse.json({ detail: 'Event not found' }, { status: 404 });
      const selectFields = {
        id: certificates.id,
        recipientName: certificates.recipientName,
        recipientEmail: certificates.recipientEmail,
        status: certificates.status,
        issuedAt: certificates.issuedAt,
        templateName: certificates.templateName,
        scanCount: certificates.scanCount,
        lastScannedAt: certificates.lastScannedAt,
        mailStatus: currentMailStatus,
        mailVersion: certificates.mailAttemptId,
        mailUpdatedAt: certificates.mailUpdatedAt,
        mailDetail: certificates.mailDetail,
        ...(includeRowData ? { rowData: certificates.rowData, renderFields: certificates.renderFields } : {}),
      };

      const rows = event
        ? await db
            .select(selectFields)
            .from(certificates)
            .where(eventCertificatesWhere(user.userId, event.id))
            .orderBy(desc(certificates.issuedAt))
        : [];

      let activeCount = 0;
      let revokedCount = 0;
      // ISO-8601 strings sort lexicographically, so min/max need no Date objects.
      let firstIssuedAt = rows[0]?.issuedAt.toISOString() ?? event.createdAt.toISOString();
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
          renderFields: r.renderFields ?? null,
          mailStatus: r.mailStatus,
          mailVersion: r.mailVersion,
          mailUpdatedAt: r.mailUpdatedAt?.toISOString() ?? null,
          mailDetail: r.mailDetail,
        };
      });

      const totalScans = rows.reduce((sum, r) => sum + (r.scanCount ?? 0), 0);
      const scannedCerts = rows.filter((r) => (r.scanCount ?? 0) > 0).length;
      let lastScanIso: string | null = null;
      for (const r of rows) {
        if (!r.lastScannedAt) continue;
        const iso = r.lastScannedAt.toISOString();
        if (!lastScanIso || iso > lastScanIso) {
          lastScanIso = iso;
        }
      }

      const eventSummary: DashboardEventSummary = {
        eventName: event.name,
        label: event.label,
        designLocked: event.designLocked,
        certificateCount: rows.length,
        activeCount,
        revokedCount,
        firstIssuedAt,
        lastIssuedAt,
        templateName: eventTemplateName,
        eventId: event?.id ?? null,
        validThrough: event?.validThrough ? event.validThrough.toISOString() : null,
        trackScans: event?.trackScans ?? false,
        scanSummary: {
          totalScans,
          scannedCertificates: scannedCerts,
          lastScannedAt: lastScanIso,
        },
      };

      return NextResponse.json(
        {
          event: eventSummary,
          participants,
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
    // certificates), never one row per certificate.
    // -------------------------------------------------------------
    const aggregateRows = await db
      .select({
        eventName: eventsTable.name,
        label: eventsTable.label,
        certificateCount: sql<number>`count(${certificates.id})::int`,
        activeCount: sql<number>`count(${certificates.id}) filter (where ${certificates.status} in ('issued','static'))::int`,
        revokedCount: sql<number>`count(${certificates.id}) filter (where ${certificates.status} = 'revoked')::int`,
        firstIssuedAt: sql<string | null>`min(${certificates.issuedAt})::text`,
        lastIssuedAt: sql<string | null>`max(${certificates.issuedAt})::text`,
        templateName: sql<
          string | null
        >`max(${certificates.templateName}) filter (where ${certificates.templateName} is not null)`,
        eventCreatedAt: eventsTable.createdAt,
        eventId: eventsTable.id,
        validThrough: eventsTable.validThrough,
        trackScans: eventsTable.trackScans,
        totalScans: sql<number>`coalesce(sum(${certificates.scanCount}), 0)::int`,
        lastScannedAt: sql<string | null>`max(${certificates.lastScannedAt})::text`,
      })
      .from(eventsTable)
      .leftJoin(
        certificates,
        and(eq(certificates.eventId, eventsTable.id), eq(certificates.userId, eventsTable.userId))
      )
      .where(eq(eventsTable.userId, user.userId))
      .groupBy(eventsTable.id, eventsTable.name, eventsTable.createdAt);

    const eventSummaries: DashboardEventSummary[] = aggregateRows
      .filter((row) => row.certificateCount > 0)
      .map((row) => {
        const fallback = row.eventCreatedAt.toISOString();
        return {
          eventName: row.eventName,
          label: row.label,
          certificateCount: row.certificateCount,
          activeCount: row.activeCount,
          revokedCount: row.revokedCount,
          firstIssuedAt: row.firstIssuedAt ? new Date(row.firstIssuedAt).toISOString() : fallback,
          lastIssuedAt: row.lastIssuedAt ? new Date(row.lastIssuedAt).toISOString() : fallback,
          templateName: row.templateName,
          eventId: row.eventId,
          validThrough: row.validThrough ? row.validThrough.toISOString() : null,
          trackScans: row.trackScans,
          scanSummary: {
            totalScans: row.totalScans,
            lastScannedAt: row.lastScannedAt ? new Date(row.lastScannedAt).toISOString() : null,
          },
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
  const { user, denial } = await requireIssuer(request);
  if (denial) return denial;

  if (!env.DATABASE_URL) {
    return NextResponse.json(
      { detail: 'Database is not configured (DATABASE_URL missing)' },
      { status: 503 }
    );
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('eventId') || undefined;
  const name = searchParams.get('event')?.trim();
  if (!id && !name) return NextResponse.json({ detail: 'An event ID is required' }, { status: 400 });

  try {
    const event = await findOwnedEvent(user.userId, { id, name });
    if (!event) return NextResponse.json({ detail: 'Event not found' }, { status: 404 });
    if (event.designLocked) {
      return NextResponse.json({ detail: 'Issued events are kept for verification. Revoke individual certificates as needed.' }, { status: 409 });
    }
    const [deleted] = await db.delete(eventsTable).where(and(
      eq(eventsTable.userId, user.userId),
      eq(eventsTable.id, event.id),
      isNull(eventsTable.issuedDesign),
      sql`NOT EXISTS (SELECT 1 FROM ${certificates} WHERE ${eventCertificatesWhere(user.userId, event.id)})`,
    )).returning({ id: eventsTable.id });
    if (!deleted) return NextResponse.json({ detail: 'Issued events are kept for verification.' }, { status: 409 });
    return NextResponse.json({ success: true });
  } catch (error) {
    log.error('dashboard', 'Failed to delete empty event', { requestId: requestIdOf(request), userId: user.userId }, error);
    return NextResponse.json({ detail: 'Failed to delete event' }, { status: 500 });
  }
}
