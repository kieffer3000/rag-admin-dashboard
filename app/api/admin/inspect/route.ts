import {
  sql,
  ensureBoardSchema,
  ensureProjectsSchema,
  ensureAgentsSchema
} from '@/lib/board-db';

// TEMPORARY read-only inspector (secret-gated) — dumps board/projects/agents
// structure per scope so we can see where the user's data actually is. Remove
// after use.

export const runtime = 'nodejs';

export async function GET(req: Request) {
  if (
    !process.env.INSPECT_SECRET ||
    req.headers.get('x-inspect-secret') !== process.env.INSPECT_SECRET
  ) {
    return Response.json({ error: 'forbidden' }, { status: 403 });
  }
  if (!sql) return Response.json({ error: 'no db' }, { status: 503 });
  await ensureBoardSchema();
  await ensureProjectsSchema();
  await ensureAgentsSchema();

  const scopes = (new URL(req.url).searchParams.get('scopes') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const out: Record<string, unknown> = {};
  for (const scope of scopes) {
    const projects = await sql`SELECT data FROM projects_state WHERE scope=${scope}`;
    const boards = await sql`SELECT project_id, data FROM board_state WHERE scope=${scope}`;
    const agents = await sql`SELECT data FROM agents_state WHERE scope=${scope}`;
    out[scope] = {
      projects_list: projects[0]?.data ?? null,
      boards: boards.map((b: any) => ({
        project_id: b.project_id,
        keys: Object.keys(b.data ?? {}),
        nodes: Array.isArray(b.data?.nodes) ? b.data.nodes.length : 0,
        media: Array.isArray(b.data?.media) ? b.data.media.length : 0,
        sample_media: Array.isArray(b.data?.media)
          ? b.data.media.slice(0, 3).map((m: any) => ({ id: m.id, name: m.name, type: m.type }))
          : []
      })),
      agents: Array.isArray(agents[0]?.data) ? agents[0].data.length : agents[0]?.data ? 1 : 0
    };
  }
  return Response.json(out);
}
