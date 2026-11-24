import { sql } from 'drizzle-orm';
import { db } from './db';

export type MailSlot = { allowed: true } | { allowed: false; retryAfter: number | null };

/** Lock the policy row so parallel requests and policy edits use one rolling window. */
export async function reserveMailSlot(email: string): Promise<MailSlot> {
  const result = await db.execute<{ retry_after: number | null; reserved: boolean }>(sql`
    WITH locked AS MATERIALIZED (
      SELECT email, mails_per_minute, mails_per_second, mail_attempts
      FROM platform_access WHERE email = ${email} AND can_issue_certificates FOR UPDATE
    ), timed AS MATERIALIZED (
      SELECT *, clock_timestamp() AS now FROM locked
    ), recent AS (
      SELECT *, ARRAY(
        SELECT stamp FROM unnest(mail_attempts) AS stamp
        WHERE stamp > now - interval '60 seconds' ORDER BY stamp
      ) AS attempts
      FROM timed
    ), windows AS (
      SELECT *, ARRAY(
        SELECT stamp FROM unnest(attempts) AS stamp
        WHERE stamp > now - interval '1 second' ORDER BY stamp
      ) AS burst
      FROM recent
    ), decision AS MATERIALIZED (
      SELECT *, greatest(
        extract(epoch FROM attempts[cardinality(attempts) - mails_per_minute + 1] + interval '60 seconds' - now),
        extract(epoch FROM burst[cardinality(burst) - mails_per_second + 1] + interval '1 second' - now),
        0
      ) AS wait
      FROM windows
    ), reservation AS (
      UPDATE platform_access p SET mail_attempts = array_append(d.attempts, d.now)
      FROM decision d WHERE p.email = d.email AND d.wait = 0
      RETURNING p.email
    )
    SELECT CASE WHEN wait > 0 THEN ceil(wait)::int END AS retry_after,
           EXISTS (SELECT 1 FROM reservation) AS reserved
    FROM decision
  `);
  const row = result.rows[0];
  if (row?.reserved) return { allowed: true };
  return { allowed: false, retryAfter: row?.retry_after ?? null };
}
