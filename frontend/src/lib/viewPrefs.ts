// Per-user list rendering.
//
// The Travelers and Labor Tracking pages each ship two complete renderings of
// the same data: a card grid (the default everyone sees) and a dense
// dashboard-style table. Both read the same filtered/sorted/paginated state, so
// switching between them changes nothing but the markup — filters, search,
// sorting, pagination, bulk actions and permissions are shared.
//
// Abhi asked for the table on both pages, matching the dashboard's "Traveler
// Status & Progress" look. Add usernames here rather than scattering email
// comparisons through the pages.
const TABLE_VIEW_USERS = [
  'abhi@americancircuits.com',
];

/** True when this user should see the dense table instead of the card grid. */
export const prefersTableView = (username?: string | null): boolean =>
  TABLE_VIEW_USERS.includes((username || '').toLowerCase().trim());
