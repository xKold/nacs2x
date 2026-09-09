import { neon } from '@neondatabase/serverless';

// Guard: if DATABASE_URL is missing (e.g. env misconfig), fall back to a
// no-op SQL client so the app still functions — just without DB caching.
const sql = process.env.DATABASE_URL
  ? neon(process.env.DATABASE_URL)
  : null;

// ─── Team metadata ─────────────────────────────────────────────────────

export interface TeamMetadata {
  nameKey: string;
  country: string | null;
  logoUrl: string | null;
  source: string | null;
  updatedAt: Date;
}

/** Cache staleness thresholds (in days). */
const TEAM_TTL_DAYS = 30;
const PLAYER_TTL_DAYS = 60;

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

export async function getTeamMetadata(nameKey: string): Promise<TeamMetadata | null> {
  if (!sql) return null;
  try {
    const rows = (await sql`
      SELECT name_key, country, logo_url, source, updated_at
      FROM team_metadata
      WHERE name_key = ${nameKey}
        AND updated_at > ${daysAgo(TEAM_TTL_DAYS)}
      LIMIT 1
    `) as Array<{
      name_key: string;
      country: string | null;
      logo_url: string | null;
      source: string | null;
      updated_at: Date;
    }>;
    if (rows.length === 0) return null;
    const r = rows[0];
    return {
      nameKey: r.name_key,
      country: r.country,
      logoUrl: r.logo_url,
      source: r.source,
      updatedAt: r.updated_at,
    };
  } catch (err) {
    console.error('[db.getTeamMetadata] failed:', err);
    return null;
  }
}

export async function putTeamMetadata(
  nameKey: string,
  data: { country: string | null; logoUrl: string | null; source: string | null },
): Promise<void> {
  if (!sql) return;
  try {
    await sql`
      INSERT INTO team_metadata (name_key, country, logo_url, source, updated_at)
      VALUES (${nameKey}, ${data.country}, ${data.logoUrl}, ${data.source}, NOW())
      ON CONFLICT (name_key) DO UPDATE
      SET country = EXCLUDED.country,
          logo_url = EXCLUDED.logo_url,
          source = EXCLUDED.source,
          updated_at = NOW()
    `;
  } catch (err) {
    console.error('[db.putTeamMetadata] failed:', err);
  }
}

// ─── Player metadata ───────────────────────────────────────────────────

export interface PlayerMetadata {
  nicknameKey: string;
  faceitId: string | null;
  country: string | null;
  avatarUrl: string | null;
  updatedAt: Date;
}

export async function getPlayerMetadata(
  nicknameKey: string,
): Promise<PlayerMetadata | null> {
  if (!sql) return null;
  try {
    const rows = (await sql`
      SELECT nickname_key, faceit_id, country, avatar_url, updated_at
      FROM player_metadata
      WHERE nickname_key = ${nicknameKey}
        AND updated_at > ${daysAgo(PLAYER_TTL_DAYS)}
      LIMIT 1
    `) as Array<{
      nickname_key: string;
      faceit_id: string | null;
      country: string | null;
      avatar_url: string | null;
      updated_at: Date;
    }>;
    if (rows.length === 0) return null;
    const r = rows[0];
    return {
      nicknameKey: r.nickname_key,
      faceitId: r.faceit_id,
      country: r.country,
      avatarUrl: r.avatar_url,
      updatedAt: r.updated_at,
    };
  } catch (err) {
    console.error('[db.getPlayerMetadata] failed:', err);
    return null;
  }
}

export async function putPlayerMetadata(
  nicknameKey: string,
  data: { faceitId: string | null; country: string | null; avatarUrl: string | null },
): Promise<void> {
  if (!sql) return;
  try {
    await sql`
      INSERT INTO player_metadata (nickname_key, faceit_id, country, avatar_url, updated_at)
      VALUES (${nicknameKey}, ${data.faceitId}, ${data.country}, ${data.avatarUrl}, NOW())
      ON CONFLICT (nickname_key) DO UPDATE
      SET faceit_id = EXCLUDED.faceit_id,
          country = EXCLUDED.country,
          avatar_url = EXCLUDED.avatar_url,
          updated_at = NOW()
    `;
  } catch (err) {
    console.error('[db.putPlayerMetadata] failed:', err);
  }
}

// ─── Batch helpers (used by the rankings route) ────────────────────────

/**
 * Fetch metadata for many teams in one round-trip. Returns a map keyed by
 * name_key. Missing/stale teams are simply absent from the map.
 */
export async function getTeamMetadataMap(
  nameKeys: string[],
): Promise<Map<string, TeamMetadata>> {
  const out = new Map<string, TeamMetadata>();
  if (!sql || nameKeys.length === 0) return out;
  try {
    const rows = (await sql`
      SELECT name_key, country, logo_url, source, updated_at
      FROM team_metadata
      WHERE name_key = ANY(${nameKeys})
        AND updated_at > ${daysAgo(TEAM_TTL_DAYS)}
    `) as Array<{
      name_key: string;
      country: string | null;
      logo_url: string | null;
      source: string | null;
      updated_at: Date;
    }>;
    for (const r of rows) {
      out.set(r.name_key, {
        nameKey: r.name_key,
        country: r.country,
        logoUrl: r.logo_url,
        source: r.source,
        updatedAt: r.updated_at,
      });
    }
  } catch (err) {
    console.error('[db.getTeamMetadataMap] failed:', err);
  }
  return out;
}

export async function getPlayerMetadataMap(
  nicknameKeys: string[],
): Promise<Map<string, PlayerMetadata>> {
  const out = new Map<string, PlayerMetadata>();
  if (!sql || nicknameKeys.length === 0) return out;
  try {
    const rows = (await sql`
      SELECT nickname_key, faceit_id, country, avatar_url, updated_at
      FROM player_metadata
      WHERE nickname_key = ANY(${nicknameKeys})
        AND updated_at > ${daysAgo(PLAYER_TTL_DAYS)}
    `) as Array<{
      nickname_key: string;
      faceit_id: string | null;
      country: string | null;
      avatar_url: string | null;
      updated_at: Date;
    }>;
    for (const r of rows) {
      out.set(r.nickname_key, {
        nicknameKey: r.nickname_key,
        faceitId: r.faceit_id,
        country: r.country,
        avatarUrl: r.avatar_url,
        updatedAt: r.updated_at,
      });
    }
  } catch (err) {
    console.error('[db.getPlayerMetadataMap] failed:', err);
  }
  return out;
}
