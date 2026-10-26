import { requireAdmin, forbiddenResponse, loadOverview, ok } from '../_guard';

/** Aggregate platform analytics — the Admin console's Overview tab. */
export async function GET(request: Request) {
  const admin = await requireAdmin(request);
  if (!admin) return forbiddenResponse();

  const overview = await loadOverview();
  return ok({ overview, generatedAt: new Date().toISOString() });
}
