import { NextResponse } from 'next/server';
import { and, asc, eq } from 'drizzle-orm';
import { db } from '../../../../../lib/db';
import { templates, templateVersions } from '../../../../../db/schema';
import { mutationAllowed, forbiddenCsrfResponse } from '../../../../../lib/server-auth';
import { requireIssuer } from '../../../../../lib/issuer-auth';
import { env } from '../../../../../lib/env';
import { isValidCertificateId } from '../../../../../lib/verification';
import { snapshotTemplateVersion } from '../../../../../lib/template-versions';
import { log, requestIdOf } from '../../../../../lib/logger';

/**
 * Version history for a saved template. GET lists snapshots (layout only —
 * image bytes stay in the templates row); POST restores one snapshot's
 * layout onto the live template.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { user, denial } = await requireIssuer(request);
  if (denial) return denial;

  const { id } = await params;
  if (!isValidCertificateId(id) || !env.DATABASE_URL) {
    return NextResponse.json({ detail: 'Template not found' }, { status: 404 });
  }

  try {
    const [owned] = await db
      .select({ id: templates.id })
      .from(templates)
      .where(and(eq(templates.id, id), eq(templates.userId, user.userId)))
      .limit(1);
    if (!owned) {
      return NextResponse.json({ detail: 'Template not found' }, { status: 404 });
    }

    const rows = await db
      .select({
        id: templateVersions.id,
        createdAt: templateVersions.createdAt,
        imageHash: templateVersions.imageHash,
        layoutConfig: templateVersions.layoutConfig,
      })
      .from(templateVersions)
      .where(eq(templateVersions.templateId, id))
      .orderBy(asc(templateVersions.createdAt));

    return NextResponse.json({
      versions: rows.map((r) => ({
        id: r.id,
        createdAt: r.createdAt.toISOString(),
        imageHash: r.imageHash,
        boxCount: Array.isArray((r.layoutConfig as { boxes?: unknown[] })?.boxes)
          ? (r.layoutConfig as { boxes: unknown[] }).boxes.length
          : 0,
        qrCount: Array.isArray((r.layoutConfig as { qrZones?: unknown[] })?.qrZones)
          ? (r.layoutConfig as { qrZones: unknown[] }).qrZones.length
          : 0,
      })),
    });
  } catch (error) {
    log.error('templates', 'Failed to list template versions', { requestId: requestIdOf(request) }, error);
    return NextResponse.json({ detail: 'Failed to load versions' }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!mutationAllowed(request)) return forbiddenCsrfResponse();
  const { user, denial } = await requireIssuer(request);
  if (denial) return denial;

  const { id } = await params;
  if (!isValidCertificateId(id) || !env.DATABASE_URL) {
    return NextResponse.json({ detail: 'Template not found' }, { status: 404 });
  }

  let body: { versionId?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ detail: 'Invalid request body' }, { status: 400 });
  }
  const versionId = typeof body.versionId === 'string' ? body.versionId : '';
  if (!isValidCertificateId(versionId)) {
    return NextResponse.json({ detail: 'Invalid version id' }, { status: 400 });
  }

  try {
    const [owned] = await db
      .select({ id: templates.id })
      .from(templates)
      .where(and(eq(templates.id, id), eq(templates.userId, user.userId)))
      .limit(1);
    if (!owned) {
      return NextResponse.json({ detail: 'Template not found' }, { status: 404 });
    }

    const [version] = await db
      .select({ layoutConfig: templateVersions.layoutConfig })
      .from(templateVersions)
      .where(and(eq(templateVersions.id, versionId), eq(templateVersions.templateId, id)))
      .limit(1);
    if (!version) {
      return NextResponse.json({ detail: 'Version not found' }, { status: 404 });
    }

    const restore = db
      .update(templates)
      .set({ layoutConfig: version.layoutConfig, updatedAt: new Date() })
      .where(and(eq(templates.id, id), eq(templates.userId, user.userId)))
      .returning({ id: templates.id, name: templates.name, layoutConfig: templates.layoutConfig });

    const [[updated]] = await db.batch([restore, ...snapshotTemplateVersion(user.userId, { id })]);
    if (!updated) return NextResponse.json({ detail: 'Template not found' }, { status: 404 });

    return NextResponse.json({ success: true, template: updated });
  } catch (error) {
    log.error('templates', 'Failed to restore template version', { requestId: requestIdOf(request) }, error);
    return NextResponse.json({ detail: 'Failed to restore version' }, { status: 500 });
  }
}
