/**
 * Public render-spec field filter (server-side).
 *
 * The verify page's asset endpoint may only expose CSV columns that are
 * literally printed on the certificate face — never the rest of the
 * registrant's row. This helper mirrors the matching semantics of
 * `resolveFieldValue` (exact → trimmed → case-insensitive → alias groups)
 * so the client engine finds exactly the data it would render, and nothing
 * more.
 */

const NAME_ALIASES = ['name', 'fullname', 'recipientname', 'studentname', 'participantname', 'candidatename', 'membername'];
const EMAIL_ALIASES = ['email', 'emailaddress', 'recipientemail', 'mail'];
const DATE_ALIASES = ['date', 'issuedate', 'issuedat', 'dateofissue'];
const ALIAS_GROUPS = [NAME_ALIASES, EMAIL_ALIASES, DATE_ALIASES];

function normalizeKey(key: string): string {
  return key.trim().toLowerCase().replace(/[\s_\-]/g, '');
}

export function pickRenderFields(
  rowData: Record<string, string> | null | undefined,
  layoutConfig: { boxes?: Array<{ field?: string }> } | null | undefined
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!rowData || !layoutConfig || !Array.isArray(layoutConfig.boxes)) return out;

  // normalized form -> first original key (consistent with client matching)
  const byNormalized = new Map<string, string>();
  for (const [key, value] of Object.entries(rowData)) {
    const normalized = normalizeKey(key);
    if (normalized && !byNormalized.has(normalized)) byNormalized.set(normalized, key);
  }

  const wanted = new Set<string>();
  const expandAliasGroup = (normalizedField: string) => {
    for (const group of ALIAS_GROUPS) {
      if (group.includes(normalizedField)) {
        for (const alias of group) {
          const match = byNormalized.get(alias);
          if (match !== undefined) wanted.add(match);
        }
        return true;
      }
    }
    return false;
  };

  for (const box of layoutConfig.boxes) {
    const field = typeof box?.field === 'string' ? box.field : '';
    const normalized = normalizeKey(field);
    if (!normalized) continue;

    const direct = byNormalized.get(normalized);
    if (direct !== undefined) {
      wanted.add(direct);
      continue;
    }
    expandAliasGroup(normalized);
  }

  for (const key of wanted) {
    out[key] = rowData[key];
  }
  return out;
}
