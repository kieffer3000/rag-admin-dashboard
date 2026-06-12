import 'server-only';
import { neon } from '@neondatabase/serverless';

// Raw Neon client for board/chat persistence (separate from the template's
// drizzle products setup). Null when POSTGRES_URL is absent (e.g. local dev
// without it) so the API can degrade gracefully instead of crashing at import.
export const sql = process.env.POSTGRES_URL
  ? neon(process.env.POSTGRES_URL)
  : null;

let ensured = false;

/** Idempotent schema bootstrap. One JSONB document per (scope, project). */
export async function ensureBoardSchema() {
  if (!sql || ensured) return;
  await sql`
    CREATE TABLE IF NOT EXISTS board_state (
      scope text NOT NULL,
      project_id text NOT NULL,
      user_id text,
      data jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (scope, project_id)
    )
  `;
  ensured = true;
}
