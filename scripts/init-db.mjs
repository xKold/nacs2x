// One-off DB init script. Idempotent (uses CREATE TABLE IF NOT EXISTS).
// Run with: node scripts/init-db.mjs
//
// Loads DATABASE_URL from .env.local so we don't have to pass env vars.

import { readFileSync } from 'node:fs';
import { neon } from '@neondatabase/serverless';

// Manual .env.local parser (Node doesn't auto-load it outside Next.js)
function loadEnvLocal() {
  try {
    const contents = readFileSync('.env.local', 'utf8');
    for (const line of contents.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = val;
    }
  } catch {
    // .env.local not readable — assume env already set
  }
}

loadEnvLocal();

if (!process.env.DATABASE_URL) {
  console.error('ERROR: DATABASE_URL not set. Check .env.local.');
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);

async function main() {
  console.log('Creating tables...');

  await sql`
    CREATE TABLE IF NOT EXISTS team_metadata (
      name_key TEXT PRIMARY KEY,
      country CHAR(2),
      logo_url TEXT,
      source TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  console.log('  ✓ team_metadata');

  await sql`
    CREATE TABLE IF NOT EXISTS player_metadata (
      nickname_key TEXT PRIMARY KEY,
      faceit_id TEXT,
      country CHAR(2),
      avatar_url TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  console.log('  ✓ player_metadata');

  const teamCount = await sql`SELECT COUNT(*)::int AS c FROM team_metadata`;
  const playerCount = await sql`SELECT COUNT(*)::int AS c FROM player_metadata`;
  console.log(`\nCurrent rows:  team_metadata=${teamCount[0].c}, player_metadata=${playerCount[0].c}`);
  console.log('Done.');
}

main().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
