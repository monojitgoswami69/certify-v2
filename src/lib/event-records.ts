import { and, eq, sql } from 'drizzle-orm';
import { certificates, events } from '../db/schema';
import { db } from './db';
import { isValidCertificateId } from './verification';

export async function findOwnedEvent(userId: string, selector: { id?: string; name?: string }) {
  if ((!selector.id && !selector.name) || (selector.id && !isValidCertificateId(selector.id))) return null;
  const [event] = await db.select({
    id: events.id, name: events.name, label: events.label, createdAt: events.createdAt,
    trackScans: events.trackScans, validThrough: events.validThrough,
    designLocked: sql<boolean>`${events.issuedDesign} IS NOT NULL`,
  }).from(events).where(and(
    eq(events.userId, userId),
    selector.id ? eq(events.id, selector.id) : eq(events.name, selector.name!),
  )).orderBy(events.createdAt, events.id).limit(1);
  return event ?? null;
}

export function eventCertificatesWhere(userId: string, eventId: string) {
  return and(eq(certificates.userId, userId), eq(certificates.eventId, eventId));
}
