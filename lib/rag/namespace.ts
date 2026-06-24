// Per-user Pinecone namespaces (multi-tenancy). One namespace per authenticated
// Clerk user = hard data isolation (a query targets exactly one namespace, so a
// user can only ever retrieve their own vectors) AND cheaper reads (a query
// scans only that user's vectors). The namespace is ALWAYS derived server-side
// from the authenticated userId — never accepted from the client.
//
// Key on the immutable Clerk userId, not email (emails change → corpus orphans).
// The email is kept in vector metadata for admin readability instead.

/** The data namespace for a user's sources. */
export function nsForUser(userId: string): string {
  return `u_${userId}`;
}

/** The long-term-memory namespace for a user (separate from their sources). */
export function memNsForUser(userId: string): string {
  return `u_${userId}__mem`;
}
