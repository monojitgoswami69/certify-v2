import { authorizeAdmin, loadOverview, ok } from '../_guard';

/** Aggregate platform analytics — the Admin console's Overview tab. */
export async function GET(request: Request) {
  const { admin, denial } = await authorizeAdmin(request);
  if (denial) return denial;
  void admin;

  const overview = await loadOverview();
  return ok({ overview, generatedAt: new Date().toISOString() });
}
