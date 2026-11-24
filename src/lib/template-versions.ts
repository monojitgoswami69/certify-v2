import { sql } from 'drizzle-orm';
import { templates, templateVersions } from '../db/schema';
import { db } from './db';

export function snapshotTemplateVersion(userId: string, templateMatch: { id: string } | { name: string }) {
  const match = 'id' in templateMatch
    ? sql`${templates.id} = ${templateMatch.id}`
    : sql`${templates.name} = ${templateMatch.name}`;
  const ownerAndTemplate = sql`${templates.userId} = ${userId} AND ${match}`;

  return [
    db.execute(sql`
      INSERT INTO ${templateVersions} (template_id, layout_config, image_hash, created_at)
      SELECT id, layout_config, image_hash, clock_timestamp()
      FROM ${templates}
      WHERE ${ownerAndTemplate}
    `),
    db.execute(sql`
      DELETE FROM ${templateVersions}
      WHERE id IN (
        SELECT ${templateVersions.id}
        FROM ${templateVersions}
        JOIN ${templates} ON ${templates.id} = ${templateVersions.templateId}
        WHERE ${ownerAndTemplate}
        ORDER BY ${templateVersions.createdAt} DESC, ${templateVersions.id} DESC
        OFFSET 10
      )
    `),
  ] as const;
}
