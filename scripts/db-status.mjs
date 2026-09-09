// Quick diagnostic of what's in the DB
import { readFileSync } from 'node:fs';
import { neon } from '@neondatabase/serverless';

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
  } catch {}
}
loadEnvLocal();

const sql = neon(process.env.DATABASE_URL);

const teamStats = await sql`
  SELECT COUNT(*)::int AS total,
         COUNT(country)::int AS with_country,
         COUNT(logo_url)::int AS with_logo
  FROM team_metadata
`;
const playerStats = await sql`
  SELECT COUNT(*)::int AS total,
         COUNT(country)::int AS with_country,
         COUNT(avatar_url)::int AS with_avatar,
         COUNT(faceit_id)::int AS with_faceit
  FROM player_metadata
`;
console.log('=== team_metadata ===');
console.log(' ', teamStats[0]);
console.log('=== player_metadata ===');
console.log(' ', playerStats[0]);

console.log('\n=== Sample 10 players (any) ===');
const anyPlayers = await sql`
  SELECT nickname_key, country, faceit_id, avatar_url IS NOT NULL AS has_avatar
  FROM player_metadata
  ORDER BY updated_at DESC
  LIMIT 10
`;
anyPlayers.forEach((p) => console.log(' ', JSON.stringify(p)));

console.log('\n=== Sample 10 players WITH country ===');
const withCountry = await sql`
  SELECT nickname_key, country, faceit_id, avatar_url IS NOT NULL AS has_avatar
  FROM player_metadata
  WHERE country IS NOT NULL
  ORDER BY updated_at DESC
  LIMIT 10
`;
if (withCountry.length === 0) console.log('  (none)');
withCountry.forEach((p) => console.log(' ', JSON.stringify(p)));
