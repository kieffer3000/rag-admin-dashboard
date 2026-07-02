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

let snapshotsEnsured = false;

/** Idempotent schema bootstrap for board SNAPSHOTS — the append-only version
 *  history. Every accepted board save also appends an immutable copy here
 *  (hash-deduplicated), so no save can ever destroy a past state: recovery is
 *  "pick a snapshot", not archaeology. Born from the 2026-07-02 incident. */
export async function ensureSnapshotsSchema() {
  if (!sql || snapshotsEnsured) return;
  await sql`
    CREATE TABLE IF NOT EXISTS board_snapshots (
      id bigserial PRIMARY KEY,
      scope text NOT NULL,
      project_id text NOT NULL,
      user_id text,
      saved_at timestamptz NOT NULL DEFAULT now(),
      hash text NOT NULL,
      node_count integer NOT NULL DEFAULT 0,
      media_count integer NOT NULL DEFAULT 0,
      bytes integer NOT NULL DEFAULT 0,
      data jsonb NOT NULL
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS board_snapshots_proj_idx
            ON board_snapshots (scope, project_id, saved_at DESC)`;
  snapshotsEnsured = true;
}

let agentsEnsured = false;

/** Idempotent schema bootstrap for agents — one JSONB array per scope (Clerk
 *  org = the client, else the user). Agents are account-global, not per-project. */
export async function ensureAgentsSchema() {
  if (!sql || agentsEnsured) return;
  await sql`
    CREATE TABLE IF NOT EXISTS agents_state (
      scope text PRIMARY KEY,
      user_id text,
      data jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `;
  agentsEnsured = true;
}

let projectsEnsured = false;

/** Idempotent schema bootstrap for the project LIST — one JSONB array per scope
 *  (the projects themselves; each project's board/sources persist separately). */
export async function ensureProjectsSchema() {
  if (!sql || projectsEnsured) return;
  await sql`
    CREATE TABLE IF NOT EXISTS projects_state (
      scope text PRIMARY KEY,
      user_id text,
      data jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `;
  projectsEnsured = true;
}

let orgSettingsEnsured = false;

/** Per-scope settings — currently the BYOK OpenRouter key (encrypted at rest).
 *  One row per scope (Clerk org, else user). */
export async function ensureOrgSettingsSchema() {
  if (!sql || orgSettingsEnsured) return;
  await sql`
    CREATE TABLE IF NOT EXISTS org_settings (
      scope text PRIMARY KEY,
      openrouter_key_enc text,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `;
  orgSettingsEnsured = true;
}

let userDataEnsured = false;

/** Idempotent schema bootstrap for misc account data — notes + chat
 *  conversations — as one JSONB blob per scope. */
export async function ensureUserDataSchema() {
  if (!sql || userDataEnsured) return;
  await sql`
    CREATE TABLE IF NOT EXISTS userdata_state (
      scope text PRIMARY KEY,
      user_id text,
      data jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `;
  userDataEnsured = true;
}
