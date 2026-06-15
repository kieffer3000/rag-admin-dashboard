// Delete all of a source's vectors from Pinecone (server-side; the repo is
// public so the key never reaches the client). Lists every chunk by the
// `${sourceId}#` prefix and also removes the legacy whole-doc vector (id =
// sourceId). Used by both source deletion and delete-before-reindex.
// Best-effort: returns the count deleted; never throws.

export async function deleteSourceVectors(
  sourceId: string,
  namespace: string
): Promise<number> {
  const rawHost = process.env.PINECONE_HOST;
  const key = process.env.PINECONE_API_KEY;
  if (!rawHost || !key) return 0;
  const host = `https://${rawHost.replace(/^https?:\/\//, '')}`;
  const ids: string[] = [];
  try {
    let paginationToken: string | undefined;
    for (let page = 0; page < 50; page++) {
      const u = new URL(`${host}/vectors/list`);
      u.searchParams.set('prefix', `${sourceId}#`);
      u.searchParams.set('namespace', namespace);
      u.searchParams.set('limit', '100');
      if (paginationToken) u.searchParams.set('paginationToken', paginationToken);
      const r = await fetch(u, { headers: { 'Api-Key': key } });
      if (!r.ok) break;
      const j = await r.json();
      for (const v of j.vectors ?? []) if (v?.id) ids.push(v.id);
      paginationToken = j.pagination?.next;
      if (!paginationToken) break;
    }
    ids.push(sourceId); // legacy whole-doc vector (pre-chunking)
    if (ids.length) {
      await fetch(`${host}/vectors/delete`, {
        method: 'POST',
        headers: { 'Api-Key': key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, namespace })
      });
    }
  } catch {
    /* best-effort */
  }
  return ids.length;
}
