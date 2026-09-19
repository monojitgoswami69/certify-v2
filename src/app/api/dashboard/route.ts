import { NextResponse } from 'next/server';
import { desc, eq, or, isNull } from 'drizzle-orm';
import fs from 'fs';
import path from 'path';
import { db } from '../../../lib/db';
import { certificates, templates } from '../../../db/schema';
import { getAdminUserFromRequest, unauthorizedResponse } from '../../../lib/server-auth';

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
  const username = getAdminUserFromRequest(request);
  if (!username) {
    return unauthorizedResponse('Admin privilege required');
  }

  if (!process.env.DATABASE_URL) {
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
      const decodedEventName = decodeURIComponent(requestedEvent).trim();
      
      const selectFields: any = {
        id: certificates.id,
        eventName: certificates.eventName,
        recipientName: certificates.recipientName,
        recipientEmail: certificates.recipientEmail,
        status: certificates.status,
        issuedAt: certificates.issuedAt,
        templateName: certificates.templateName,
      };

      if (includeRowData) {
        selectFields.rowData = certificates.rowData;
      }

      const rows = await db
        .select(selectFields)
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
            .from(templates);

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
                      width: 1300,
                      height: 75,
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
                      width: 1200,
                      height: 50,
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
                      width: 600,
                      height: 40,
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

                const [inserted] = await db
                  .insert(templates)
                  .values({
                    name: 'Sample Data',
                    imageData: base64,
                    width,
                    height,
                    layoutConfig,
                  })
                  .returning();

                matchedTemplate = inserted || null;
              }
            } catch (seedErr) {
              console.warn('[Dashboard] Could not auto-seed sample template:', seedErr);
            }
          }
        } catch (err) {
          console.warn('[Dashboard] Could not fetch template for event:', err);
        }
      }

      // Auto-repair participants rowData for 'Sample Data' if columns were stripped
      if (decodedEventName.trim().toLowerCase() === 'sample data') {
        try {
          const sampleCsvPath = path.join(process.cwd(), 'demo-data', 'sample_data.csv');
          if (fs.existsSync(sampleCsvPath)) {
            const csvContent = fs.readFileSync(sampleCsvPath, 'utf-8');
            const lines = csvContent.trim().split(/\r?\n/).filter(Boolean);
            if (lines.length > 1) {
              const headers = lines[0].split(',').map((h) => h.replace(/^"|"$/g, '').trim());
              const sampleRows: Array<Record<string, string>> = [];
              for (let i = 1; i < lines.length; i++) {
                const parts = lines[i].match(/(".*?"|[^",\s]+)(?=\s*,|\s*$)/g) || lines[i].split(',');
                const cleanParts = parts.map((v) => v.replace(/^"|"$/g, '').trim());
                const r: Record<string, string> = {};
                headers.forEach((h, idx) => {
                  r[h] = cleanParts[idx] || '';
                });
                sampleRows.push(r);
              }

              for (let idx = 0; idx < participants.length; idx++) {
                const p = participants[idx];
                const matchedSampleRow =
                  sampleRows.find(
                    (sr) =>
                      sr.Name?.toLowerCase() === p.recipientName.toLowerCase() ||
                      (p.recipientEmail && sr.Email?.toLowerCase() === p.recipientEmail.toLowerCase())
                  ) || sampleRows[idx];

                if (matchedSampleRow && (!p.rowData || Object.keys(p.rowData).length <= 2)) {
                  p.rowData = matchedSampleRow;
                  await db
                    .update(certificates)
                    .set({ rowData: matchedSampleRow })
                    .where(eq(certificates.id, p.id))
                    .catch(() => {});
                }
              }
            }
          }
        } catch (repairErr) {
          console.warn('[Dashboard] Could not auto-repair sample participant data:', repairErr);
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
  const username = getAdminUserFromRequest(request);
  if (!username) {
    return unauthorizedResponse('Admin privilege required');
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

