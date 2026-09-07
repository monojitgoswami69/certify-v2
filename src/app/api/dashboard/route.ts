import { NextResponse } from 'next/server';
import { desc, eq, or, isNull } from 'drizzle-orm';
import { db } from '../../../lib/db';
import { certificates, templates } from '../../../db/schema';
import { getAuthUserFromRequest, unauthorizedResponse } from '../../../lib/server-auth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

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

export async function GET(request: Request) {
  const username = getAuthUserFromRequest(request);
  if (!username) {
    return unauthorizedResponse('Invalid or expired session');
  }

  if (!process.env.DATABASE_URL) {
    return NextResponse.json(
      { detail: 'Database is not configured (DATABASE_URL missing)' },
      { status: 503 }
    );
  }

  const { searchParams } = new URL(request.url);
  const requestedEvent = searchParams.get('event');

  try {
    // -------------------------------------------------------------
    // Detailed View Mode: Fetch participants & CSV fields for an event
    // -------------------------------------------------------------
    if (requestedEvent) {
      const decodedEventName = decodeURIComponent(requestedEvent).trim();
      const rows = await db
        .select({
          id: certificates.id,
          eventName: certificates.eventName,
          recipientName: certificates.recipientName,
          recipientEmail: certificates.recipientEmail,
          status: certificates.status,
          issuedAt: certificates.issuedAt,
          templateName: certificates.templateName,
          rowData: certificates.rowData,
        })
        .from(certificates)
        .where(eq(certificates.eventName, decodedEventName))
        .orderBy(desc(certificates.issuedAt));

      let activeCount = 0;
      let revokedCount = 0;
      let firstIssuedAt = rows[0]?.issuedAt ? rows[0].issuedAt.toISOString() : new Date().toISOString();
      let lastIssuedAt = rows[0]?.issuedAt ? rows[0].issuedAt.toISOString() : new Date().toISOString();
      const eventTemplateName: string | null =
        rows.find((r) => r.templateName)?.templateName || null;

      const participants: DashboardParticipant[] = rows.map((r) => {
        const isActive = r.status === 'issued' || r.status === 'static';
        const isRevoked = r.status === 'revoked';
        if (isActive) activeCount++;
        else if (isRevoked) revokedCount++;

        const isoDate = r.issuedAt.toISOString();
        if (new Date(isoDate) < new Date(firstIssuedAt)) firstIssuedAt = isoDate;
        if (new Date(isoDate) > new Date(lastIssuedAt)) lastIssuedAt = isoDate;

        return {
          id: r.id,
          recipientName: r.recipientName,
          recipientEmail: r.recipientEmail,
          status: r.status,
          issuedAt: isoDate,
          templateName: r.templateName,
          rowData: (r.rowData as Record<string, string> | null) || null,
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

      // Find the associated canvas template if available
      let matchedTemplate = null;
      try {
        const allTemplates = await db
          .select({
            id: templates.id,
            name: templates.name,
            imageData: templates.imageData,
            width: templates.width,
            height: templates.height,
            layoutConfig: templates.layoutConfig,
          })
          .from(templates);

        if (allTemplates.length > 0) {
          const tplBase = eventTemplateName
            ? eventTemplateName.replace(/\.[^/.]+$/, '').trim().toLowerCase()
            : '';
          const evBase = decodedEventName.trim().toLowerCase();

          matchedTemplate =
            allTemplates.find((t) => t.name.trim().toLowerCase() === evBase) ||
            allTemplates.find((t) => tplBase && t.name.trim().toLowerCase() === tplBase) ||
            allTemplates.find(
              (t) =>
                (evBase && t.name.toLowerCase().includes(evBase)) ||
                (tplBase && t.name.toLowerCase().includes(tplBase))
            ) ||
            (allTemplates.length === 1 ? allTemplates[0] : null);
        }
      } catch (err) {
        console.warn('[Dashboard] Could not fetch template for event:', err);
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
    // Overview Mode: Fetch overall stats and registered events list
    // -------------------------------------------------------------
    const rows = await db
      .select({
        id: certificates.id,
        eventName: certificates.eventName,
        templateName: certificates.templateName,
        status: certificates.status,
        issuedAt: certificates.issuedAt,
      })
      .from(certificates)
      .orderBy(desc(certificates.issuedAt));

    let activeCertificates = 0;
    let revokedCertificates = 0;

    const eventMap = new Map<string, DashboardEventSummary>();

    for (const row of rows) {
      const eventName = (row.eventName || 'General Event').trim();
      const isActive = row.status === 'issued' || row.status === 'static';
      const isRevoked = row.status === 'revoked';

      if (isActive) activeCertificates++;
      if (isRevoked) revokedCertificates++;

      const isoIssuedAt = row.issuedAt.toISOString();

      let eventSummary = eventMap.get(eventName);
      if (!eventSummary) {
        eventSummary = {
          eventName,
          certificateCount: 0,
          activeCount: 0,
          revokedCount: 0,
          firstIssuedAt: isoIssuedAt,
          lastIssuedAt: isoIssuedAt,
          templateName: row.templateName || null,
        };
        eventMap.set(eventName, eventSummary);
      }

      eventSummary.certificateCount++;
      if (isActive) eventSummary.activeCount++;
      if (isRevoked) eventSummary.revokedCount++;

      if (new Date(isoIssuedAt) < new Date(eventSummary.firstIssuedAt)) {
        eventSummary.firstIssuedAt = isoIssuedAt;
      }
      if (new Date(isoIssuedAt) > new Date(eventSummary.lastIssuedAt)) {
        eventSummary.lastIssuedAt = isoIssuedAt;
      }
      if (!eventSummary.templateName && row.templateName) {
        eventSummary.templateName = row.templateName;
      }
    }

    const events = Array.from(eventMap.values()).sort(
      (a, b) => new Date(b.lastIssuedAt).getTime() - new Date(a.lastIssuedAt).getTime()
    );

    const stats: DashboardStats = {
      totalEvents: events.length,
      totalCertificates: rows.length,
      activeCertificates,
      revokedCertificates,
    };

    return NextResponse.json(
      {
        stats,
        events,
      },
      {
        headers: {
          'Cache-Control': 'no-store, max-age=0, must-revalidate',
        },
      }
    );
  } catch (error) {
    console.error('[Dashboard API Error]:', error);
    return NextResponse.json(
      { detail: 'Failed to fetch dashboard data' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request) {
  const username = getAuthUserFromRequest(request);
  if (!username) {
    return unauthorizedResponse('Invalid or expired session');
  }

  if (!process.env.DATABASE_URL) {
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

  const decodedEventName = decodeURIComponent(requestedEvent).trim();

  try {
    const eventCondition =
      decodedEventName === 'Unnamed Event'
        ? or(
            eq(certificates.eventName, 'Unnamed Event'),
            isNull(certificates.eventName),
            eq(certificates.eventName, '')
          )
        : eq(certificates.eventName, decodedEventName);

    // 1. Delete all certificates associated with this event
    const deletedCerts = await db
      .delete(certificates)
      .where(eventCondition)
      .returning({ id: certificates.id });

    // 2. Also delete any saved/auto-saved template matching this event name
    await db
      .delete(templates)
      .where(eq(templates.name, decodedEventName));

    return NextResponse.json({
      success: true,
      eventName: decodedEventName,
      deletedCount: deletedCerts.length,
    });
  } catch (error) {
    console.error('[Dashboard Event DELETE error]:', error);
    return NextResponse.json(
      { detail: error instanceof Error ? error.message : 'Failed to delete event and certificates' },
      { status: 500 }
    );
  }
}

