import { API_BASE_URL } from '@/config/api';

/**
 * GET /travelers is server-paginated (default limit 50). Any page that renders
 * "all travelers" has to walk every page — a single capped request silently
 * drops the oldest travelers, which is why jobs visible on the Jobs page (fed by
 * the uncapped /jobs endpoint) went missing from the traveler lists.
 */
export const TRAVELERS_PAGE_SIZE = 200;

/** Safety stop (10k travelers) so a misbehaving response can't loop forever. */
export const MAX_TRAVELER_PAGES = 50;

/**
 * Fetch every traveler row, one page at a time, stopping at the first short or
 * empty batch. Throws on a non-OK response so callers can retry or fall back to
 * their cache.
 */
export async function fetchAllTravelerRows(): Promise<Record<string, unknown>[]> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('nexus_token') || '' : '';
  const rows: Record<string, unknown>[] = [];

  for (let page = 0; page < MAX_TRAVELER_PAGES; page++) {
    const response = await fetch(
      `${API_BASE_URL}/travelers/?skip=${page * TRAVELERS_PAGE_SIZE}&limit=${TRAVELERS_PAGE_SIZE}`,
      { headers: { 'Authorization': `Bearer ${token}` } }
    );
    if (!response.ok) {
      throw new Error(`Travelers fetch failed: ${response.status} ${response.statusText}`);
    }
    const batch = await response.json();
    if (!Array.isArray(batch) || batch.length === 0) break;
    rows.push(...batch);
    if (batch.length < TRAVELERS_PAGE_SIZE) break;
  }

  return rows;
}
