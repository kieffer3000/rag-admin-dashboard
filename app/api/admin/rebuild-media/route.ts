import { auth, clerkClient } from '@clerk/nextjs/server';
import { sql } from '@/lib/board-db';

// TEMP owner-only recovery — rebuilds the project's MEDIA RECORDS (board_state
// .data.media) from the project's sourceIds + Pinecone metadata, when the media
// list got reduced (e.g. an old board snapshot overwrote it). Pinecone + the
// sourceIds are the source of truth; this just reconstructs the records the UI
// needs to LIST/select sources. Keeps board nodes/edges intact. Remove after use.

export const runtime = 'nodejs';
export const maxDuration = 300;

const OWNER = (process.env.ALLOWED_EMAILS ?? 'tiosquareinc@gmail.com')
  .split(',')
  .map((s) => s.trim().toLowerCase());

function pcHost(): string | null {
  const h = process.env.PINECONE_HOST;
  return h ? `https://${h.replace(/^https?:\/\//, '')}` : null;
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

  const url = new URL(req.url);
  const scope = url.searchParams.get('scope');
  const projectId = url.searchParams.get('project_id');
  const namespace = url.searchParams.get('namespace');
  if (!scope || !projectId || !namespace) {
    return Response.json({ error: 'need scope, project_id, namespace' }, { status: 400 });
  }

  // 1) the project's sourceIds (intact even when media records were lost)
  const prows = await sql`SELECT data FROM projects_state WHERE scope=${scope}`;
  const projects = (prows[0]?.data ?? []) as Array<{ id: string; sourceIds?: string[] }>;
  const project = Array.isArray(projects) ? projects.find((p) => p.id === projectId) : null;
  if (!project) return Response.json({ error: 'project not found in scope' }, { status: 404 });
  const sourceIds = Array.isArray(project.sourceIds) ? project.sourceIds : [];
  if (sourceIds.length === 0) {
    return Response.json({ error: 'project has no sourceIds' }, { status: 409 });
  }

  // 2) fetch each source's metadata (first chunk) from Pinecone, batched
  const base = pcHost();
  const key = process.env.PINECONE_API_KEY;
  const meta = new Map<string, { name: string; type: string }>();
  if (base && key) {
    for (let i = 0; i < sourceIds.length; i += 100) {
      const batch = sourceIds.slice(i, i + 100);
      const u = new URL(`${base}/vectors/fetch`);
      u.searchParams.set('namespace', namespace);
      batch.forEach((id) => u.searchParams.append('ids', `${id}#0`));
      try {
        const r = await fetch(u, { headers: { 'Api-Key': key } });
        if (!r.ok) continue;
        const j = await r.json();
        for (const [vid, v] of Object.entries((j.vectors ?? {}) as Record<string, any>)) {
          const sid = vid.replace(/#\d+$/, '');
          const m = v?.metadata ?? {};
          meta.set(sid, {
            name: String(m.source_name || m.name || sid),
            type: String(m.type || 'youtube')
          });
        }
      } catch {
        /* best-effort */
      }
    }
  }

  // 3) build a media record for EVERY sourceId (fallback name = id)
  const records = sourceIds.map((id) => {
    const m = meta.get(id);
    return {
      id,
      name: m?.name ?? id,
      type: m?.type ?? 'youtube',
      status: 'indexed',
      chunks: 0,
      content: '',
      source: '',
      date: '',
      description: ''
    };
  });

  // 4) write records into the board doc's media (keep nodes/edges/chats)
  const brows = await sql`
    SELECT data FROM board_state WHERE scope=${scope} AND project_id=${projectId}`;
  const board = (brows[0]?.data ?? {
    nodes: [],
    edges: [],
    stashedBrains: [],
    brainMessages: {}
  }) as Record<string, unknown>;
  board.media = records;
  (board as { savedAt?: number }).savedAt = Date.now();

  await sql`
    INSERT INTO board_state (scope, project_id, user_id, data, updated_at)
    VALUES (${scope}, ${projectId}, ${userId}, ${JSON.stringify(board)}::jsonb, now())
    ON CONFLICT (scope, project_id)
    DO UPDATE SET data = EXCLUDED.data, updated_at = now()`;

  return Response.json({
    ok: true,
    sourceIds: sourceIds.length,
    matchedInPinecone: meta.size,
    mediaRecordsWritten: records.length
  });
}
