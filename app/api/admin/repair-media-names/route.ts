import { auth, clerkClient } from '@clerk/nextjs/server';
import { sql } from '@/lib/board-db';

// TEMP owner-only repair — restores a board's media NAMES/TYPES from Pinecone
// chunk metadata (the untouched truth table: indexText writes {source_id,
// name, source_name, type} on every chunk, and delete-before-reindex means
// the LAST-indexed source owns its id). Built for the 2026-07-02 incident:
// cross-project media-id collisions let one project's items "squat" another's
// ids in the client store, and autosaves then wrote the wrong names into the
// experts board's doc. Dry-run by default; &apply=1 writes. Remove after
// recovery.

export const runtime = 'nodejs';
export const maxDuration = 300;

const OWNER = (process.env.ALLOWED_EMAILS ?? 'tiosquareinc@gmail.com')
  .split(',')
  .map((s) => s.trim().toLowerCase());

interface MediaEntry {
  id: string;
  name?: string;
  type?: string;
  thumbnail?: string;
  source?: string;
  [k: string]: unknown;
}

export async function GET(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: 'unauth' }, { status: 401 });
  try {
    const u = await (await clerkClient()).users.getUser(userId);
    const email = (
      u.emailAddresses.find((e) => e.id === u.primaryEmailAddressId)?.emailAddress ??
      u.emailAddresses[0]?.emailAddress ??
      ''
    ).toLowerCase();
    if (!OWNER.includes(email)) return Response.json({ error: 'forbidden' }, { status: 403 });
  } catch {
    return Response.json({ error: 'auth check failed' }, { status: 500 });
  }
  if (!sql) return Response.json({ error: 'no db' }, { status: 500 });

  const rawHost = process.env.PINECONE_HOST;
  const key = process.env.PINECONE_API_KEY;
  if (!rawHost || !key) return Response.json({ error: 'pinecone env missing' }, { status: 500 });
  // PINECONE_HOST is stored WITHOUT a scheme in prod — normalize or fetch
  // throws ERR_INVALID_URL (measured: first dry-run 500'd exactly here).
  const host = rawHost.startsWith('http') ? rawHost : `https://${rawHost}`;

  const url = new URL(req.url);
  const pid = url.searchParams.get('projectId') ?? '';
  const apply = url.searchParams.get('apply') === '1';
  if (!pid) return Response.json({ error: 'projectId required' }, { status: 400 });

  // Latest row for this project id (owner-gated, so cross-scope read is fine).
  const rows = await sql`
    SELECT scope, user_id, data FROM board_state
    WHERE project_id=${pid} ORDER BY updated_at DESC LIMIT 1`;
  if (!rows[0]) return Response.json({ error: 'board not found' }, { status: 404 });
  const scope = String(rows[0].scope);
  const rowUser = String(rows[0].user_id);
  const data = (rows[0].data ?? {}) as { media?: MediaEntry[] } & Record<string, unknown>;
  const media = Array.isArray(data.media) ? data.media : [];
  if (!media.length) return Response.json({ error: 'board has no media array' }, { status: 409 });

  // Same namespace derivation the app uses (nsForUser) — keep in sync.
  const ns = `u_${rowUser}`;

  // Fetch chunk #0 of every source — its metadata carries the TRUE name/type.
  const truth = new Map<string, { name: string; type?: string }>();
  const ids = media.map((m) => m.id).filter(Boolean);
  const BATCH = 80;
  try {
    for (let i = 0; i < ids.length; i += BATCH) {
      const batch = ids.slice(i, i + BATCH);
      const qs = batch.map((id) => `ids=${encodeURIComponent(`${id}#0`)}`).join('&');
      const r = await fetch(`${host}/vectors/fetch?${qs}&namespace=${encodeURIComponent(ns)}`, {
        headers: { 'Api-Key': key }
      });
      if (!r.ok) {
        return Response.json(
          { error: `pinecone fetch failed (${r.status})`, at: i, detail: (await r.text()).slice(0, 200) },
          { status: 502 }
        );
      }
      const j = (await r.json()) as { vectors?: Record<string, { metadata?: Record<string, unknown> }> };
      for (const [vid, v] of Object.entries(j.vectors ?? {})) {
        const sid = vid.replace(/#0$/, '');
        const md = v.metadata ?? {};
        const name = String(md.source_name ?? md.name ?? '');
        if (name) truth.set(sid, { name, type: md.type ? String(md.type) : undefined });
      }
    }
  } catch (e) {
    return Response.json(
      { error: `pinecone lookup error: ${e instanceof Error ? e.message : 'unknown'}` },
      { status: 502 }
    );
  }

  // Diff + repair: only entries whose Pinecone truth DIFFERS get touched.
  let renamed = 0;
  let matched = 0;
  let missing = 0;
  const samples: Array<{ id: string; from: string; to: string }> = [];
  const repaired = media.map((m) => {
    const t = truth.get(m.id);
    if (!t) {
      missing++;
      return m;
    }
    if ((m.name ?? '') === t.name) {
      matched++;
      return m;
    }
    renamed++;
    if (samples.length < 25) samples.push({ id: m.id, from: String(m.name ?? ''), to: t.name });
    // Identity was squatted: restore true name/type; drop the impostor's
    // thumbnail/source URL (they belonged to the other project's item).
    return { ...m, name: t.name, type: t.type ?? m.type, thumbnail: undefined, source: undefined };
  });

  if (apply && renamed > 0) {
    const newData = { ...data, media: repaired };
    await sql`
      UPDATE board_state SET data=${JSON.stringify(newData)}::jsonb, updated_at=now()
      WHERE scope=${scope} AND project_id=${pid}`;
  }

  return Response.json({
    projectId: pid,
    scope,
    namespace: ns,
    totalMedia: media.length,
    pineconeFound: truth.size,
    alreadyCorrect: matched,
    renamed,
    noVectorFound: missing,
    applied: apply && renamed > 0,
    samples
  });
}
