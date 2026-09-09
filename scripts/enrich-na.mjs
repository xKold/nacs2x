// One-off NA enrichment script.
//
// Fetches the Americas VRS file, classifies teams as NA or SA using the same
// logic as /api/rankings, then enriches only the NA teams + their rosters
// against PandaScore + FACEIT, writing to Neon.
//
// Idempotent — safe to re-run. Skips teams/players already cached in the DB.
// Throttled to respect PandaScore (1000/hr) and FACEIT (60/min) rate limits.
//
// Run with:  node scripts/enrich-na.mjs

import { readFileSync } from 'node:fs';
import { neon } from '@neondatabase/serverless';

// ─── Load .env.local ────────────────────────────────────────────────────

function loadEnvLocal() {
  try {
    const contents = readFileSync('.env.local', 'utf8');
    for (const line of contents.split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const eq = t.indexOf('=');
      if (eq === -1) continue;
      const k = t.slice(0, eq).trim();
      let v = t.slice(eq + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      if (!process.env[k]) process.env[k] = v;
    }
  } catch {}
}
loadEnvLocal();

const {
  DATABASE_URL,
  PANDASCORE_API_KEY,
  FACEIT_API_KEY,
} = process.env;

if (!DATABASE_URL) {
  console.error('ERROR: DATABASE_URL not set.');
  process.exit(1);
}
if (!PANDASCORE_API_KEY || !FACEIT_API_KEY) {
  console.error('ERROR: PANDASCORE_API_KEY and FACEIT_API_KEY are required.');
  process.exit(1);
}

const sql = neon(DATABASE_URL);

// ─── Classifier (mirrors app/api/rankings/route.ts) ────────────────────

const NA_COUNTRIES = new Set([
  'US', 'CA', 'MX',
  'BZ', 'GT', 'HN', 'SV', 'NI', 'CR', 'PA',
  'CU', 'DO', 'HT', 'JM', 'PR', 'TT',
]);
const SA_COUNTRIES = new Set([
  'BR', 'AR', 'CL', 'PE', 'CO', 'VE', 'EC', 'BO', 'UY', 'PY', 'GY', 'SR',
]);
const SA_SUBSTRINGS = [
  'mibr', 'furia', 'bestia', 'pain', 'imperial', 'shinden', 'kru', 'leviatan',
  'red canids', 'fluxo', 'oddik', 'sharks', 'legacy', 'w7m', 'galorys', 'case',
  'paqueta', 'keyd', 'isurus', 'gamehunters', 'dusty roots', '9z', 'adalyamigos',
  'gremio', 'vasco', 'flamengo', 'corinthians', 'palmeiras',
  'academia', 'sementes', 'metanoia', 'borracheiros', 'quintessencia',
  'pugdesonesto', 'damajuana', 'maromba',
];
const KNOWN_SA_EXTRA = new Set([
  'dendele', 'alkam turma do pagode', 'yawara', 'mibr fe', 'ex-mibr academy',
  'mibr academy', 'bestia academy', 'meia noite', 'alka', 'procyon',
  'back to back', 'atrix', 'ex-kru', 'players', 'your end',
  'sementes do mal', 'r2', 'guara', 'charrados', 'zetta', 'wachoskys',
  'borracheiros', 'quintessencia', 'metanoia wolves', 'crashers',
  'pugdesonesto', 'magicos', 'damajuana', 'mansao maromba', 'herewegoagain',
  'gaimin gladiators', 'sensei', 'solid', 'nitro', 'bounty hunters',
  'lp', 'fake do biru', 'keyd stars', 'uno mille', 'flyquest',
  'intense', 'swingers', 'infinity', 'hawks',
]);

function normalizeName(s) {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

function classifyByCountry(country, name) {
  const n = normalizeName(name);
  if (KNOWN_SA_EXTRA.has(n)) return 'sa';
  if (SA_SUBSTRINGS.some((s) => n.includes(s))) return 'sa';
  if (country) {
    const c = country.toUpperCase();
    if (SA_COUNTRIES.has(c)) return 'sa';
    if (NA_COUNTRIES.has(c)) return 'na';
  }
  return 'na';
}

// ─── VRS fetch ──────────────────────────────────────────────────────────

async function fetchAmericasVRS() {
  const yearRes = await fetch(
    'https://api.github.com/repos/ValveSoftware/counter-strike_regional_standings/contents/live',
  );
  const years = await yearRes.json();
  const latestYear = years
    .map((y) => y.name)
    .filter((n) => /^\d{4}$/.test(n))
    .sort()
    .reverse()[0];

  const filesRes = await fetch(
    `https://api.github.com/repos/ValveSoftware/counter-strike_regional_standings/contents/live/${latestYear}`,
  );
  const files = await filesRes.json();
  const latest = files
    .filter((f) => f.name.startsWith('standings_americas_') && f.name.endsWith('.md'))
    .sort((a, b) => b.name.localeCompare(a.name))[0];

  const md = await (await fetch(latest.download_url)).text();
  const teams = [];
  for (const line of md.split('\n')) {
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').map((c) => c.trim()).filter(Boolean);
    if (cells.length < 4) continue;
    const rank = parseInt(cells[0]);
    if (isNaN(rank)) continue;
    teams.push({
      rank,
      name: cells[2],
      roster: cells[3].split(',').map((p) => p.trim()).filter(Boolean),
    });
  }
  return { teams, dateFrom: latest.name };
}

// ─── Lookups ────────────────────────────────────────────────────────────

async function lookupPandaScoreTeam(name) {
  try {
    const url = `https://api.pandascore.co/csgo/teams?search[name]=${encodeURIComponent(name)}&per_page=10&token=${PANDASCORE_API_KEY}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const items = await res.json();
    const wanted = name.toLowerCase().trim();
    let hit = items.find((t) => (t.name || '').toLowerCase().trim() === wanted);
    if (!hit) {
      hit = items.find((t) => {
        const n = (t.name || '').toLowerCase().trim();
        if (!n.startsWith(wanted + ' ')) return false;
        const suffix = n.slice(wanted.length + 1);
        if (/^(academy|fe|female|women|junior|jr|black|blue|red|white|union)\b/.test(suffix))
          return false;
        return true;
      });
    }
    return hit ? { location: hit.location, image_url: hit.image_url, source: 'pandascore' } : null;
  } catch {
    return null;
  }
}

async function lookupFaceitTeam(name) {
  try {
    const url = `https://open.faceit.com/data/v4/search/teams?name=${encodeURIComponent(name)}&game=cs2&limit=10`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${FACEIT_API_KEY}`, Accept: 'application/json' },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const items = data.items || [];
    const wanted = name.toLowerCase().trim();
    const hit = items.find((t) => (t.name || '').toLowerCase().trim() === wanted);
    return hit
      ? {
          location: hit.country ? hit.country.toUpperCase() : null,
          image_url: hit.avatar ?? null,
          source: 'faceit',
        }
      : null;
  } catch {
    return null;
  }
}

async function lookupTeam(name) {
  const [ps, fc] = await Promise.all([lookupPandaScoreTeam(name), lookupFaceitTeam(name)]);
  if (!ps && !fc) return null;
  return {
    location: ps?.location ?? fc?.location ?? null,
    image_url: ps?.image_url ?? fc?.image_url ?? null,
    source: ps ? (fc ? 'pandascore+faceit' : 'pandascore') : 'faceit',
  };
}

async function lookupPandaScorePlayer(nick) {
  try {
    const url = `https://api.pandascore.co/csgo/players?search[name]=${encodeURIComponent(nick)}&per_page=10&token=${PANDASCORE_API_KEY}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const items = await res.json();
    const wanted = nick.toLowerCase().trim();
    const hit =
      items.find((p) => (p.name || '').toLowerCase().trim() === wanted) ??
      items.find((p) => (p.slug || '').toLowerCase().trim() === wanted);
    return hit ? { faceitId: null, country: hit.nationality?.toUpperCase() ?? null, avatarUrl: hit.image_url } : null;
  } catch {
    return null;
  }
}

async function lookupFaceitPlayer(nick) {
  try {
    const url = `https://open.faceit.com/data/v4/search/players?nickname=${encodeURIComponent(nick)}&game=cs2&limit=5`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${FACEIT_API_KEY}`, Accept: 'application/json' },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const items = data.items || [];
    const wanted = nick.toLowerCase().trim();
    const hit = items.find((p) => (p.nickname || '').toLowerCase().trim() === wanted);
    return hit
      ? {
          faceitId: hit.player_id ?? null,
          country: hit.country ? hit.country.toUpperCase() : null,
          avatarUrl: hit.avatar ?? null,
        }
      : null;
  } catch {
    return null;
  }
}

async function lookupPlayer(nick) {
  const [ps, fc] = await Promise.all([lookupPandaScorePlayer(nick), lookupFaceitPlayer(nick)]);
  if (!ps && !fc) return null;
  return {
    faceitId: fc?.faceitId ?? null,
    country: ps?.country ?? fc?.country ?? null,
    avatarUrl: ps?.avatarUrl ?? fc?.avatarUrl ?? null,
  };
}

// ─── DB helpers ────────────────────────────────────────────────────────

async function getCachedTeamKeys() {
  const rows = await sql`SELECT name_key FROM team_metadata WHERE country IS NOT NULL OR logo_url IS NOT NULL`;
  return new Set(rows.map((r) => r.name_key));
}
async function getCachedPlayerKeys() {
  const rows = await sql`SELECT nickname_key FROM player_metadata WHERE country IS NOT NULL OR avatar_url IS NOT NULL OR faceit_id IS NOT NULL`;
  return new Set(rows.map((r) => r.nickname_key));
}

async function upsertTeam(key, data) {
  await sql`
    INSERT INTO team_metadata (name_key, country, logo_url, source, updated_at)
    VALUES (${key}, ${data.country}, ${data.logoUrl}, ${data.source}, NOW())
    ON CONFLICT (name_key) DO UPDATE
    SET country = EXCLUDED.country, logo_url = EXCLUDED.logo_url,
        source = EXCLUDED.source, updated_at = NOW()
  `;
}
async function upsertPlayer(key, data) {
  await sql`
    INSERT INTO player_metadata (nickname_key, faceit_id, country, avatar_url, updated_at)
    VALUES (${key}, ${data.faceitId}, ${data.country}, ${data.avatarUrl}, NOW())
    ON CONFLICT (nickname_key) DO UPDATE
    SET faceit_id = EXCLUDED.faceit_id, country = EXCLUDED.country,
        avatar_url = EXCLUDED.avatar_url, updated_at = NOW()
  `;
}

// ─── Batched enrichment ────────────────────────────────────────────────

const BATCH_SIZE = 5;
const BATCH_DELAY_MS = 2000;

async function processBatched(items, worker, label) {
  let done = 0;
  let hits = 0;
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(batch.map(worker));
    hits += results.filter(Boolean).length;
    done += batch.length;
    process.stdout.write(`\r  ${label}: ${done}/${items.length}   (${hits} hits)`);
    if (i + BATCH_SIZE < items.length) {
      await new Promise((r) => setTimeout(r, BATCH_DELAY_MS));
    }
  }
  process.stdout.write('\n');
  return hits;
}

// ─── Main ──────────────────────────────────────────────────────────────

async function main() {
  console.log('Fetching Americas VRS…');
  const { teams: allAmericas, dateFrom } = await fetchAmericasVRS();
  console.log(`  latest file: ${dateFrom}`);
  console.log(`  total Americas teams: ${allAmericas.length}`);

  // First pass: classify with existing keyword/substring rules (no API needed).
  // Some teams will need a country lookup to classify properly, but the
  // classifier already trusts the substring rules first.
  const naTeams = allAmericas.filter((t) => classifyByCountry(null, t.name) === 'na');
  console.log(`  classified NA by keyword rules: ${naTeams.length}`);

  // Unique player nicknames across NA rosters
  const uniquePlayerKeys = new Map();
  for (const t of naTeams) {
    for (const nick of t.roster) {
      const k = normalizeName(nick);
      if (!uniquePlayerKeys.has(k)) uniquePlayerKeys.set(k, nick);
    }
  }
  console.log(`  unique NA players: ${uniquePlayerKeys.size}`);

  const cachedTeams = await getCachedTeamKeys();
  const cachedPlayers = await getCachedPlayerKeys();
  console.log(`  already cached in DB: ${cachedTeams.size} teams, ${cachedPlayers.size} players\n`);

  // ── Enrich teams ──
  const teamsToFetch = naTeams.filter((t) => !cachedTeams.has(normalizeName(t.name)));
  console.log(`Enriching ${teamsToFetch.length} teams…`);
  if (teamsToFetch.length > 0) {
    await processBatched(
      teamsToFetch,
      async (t) => {
        const r = await lookupTeam(t.name);
        if (!r || (!r.location && !r.image_url)) return null;
        await upsertTeam(normalizeName(t.name), {
          country: r.location,
          logoUrl: r.image_url,
          source: r.source,
        });
        return r;
      },
      'teams',
    );
  }

  // ── Enrich players ──
  const playersToFetch = [...uniquePlayerKeys.entries()]
    .filter(([k]) => !cachedPlayers.has(k))
    .map(([, nick]) => nick);
  console.log(`\nEnriching ${playersToFetch.length} players…`);
  if (playersToFetch.length > 0) {
    await processBatched(
      playersToFetch,
      async (nick) => {
        const r = await lookupPlayer(nick);
        if (!r || (!r.country && !r.avatarUrl && !r.faceitId)) return null;
        await upsertPlayer(normalizeName(nick), {
          faceitId: r.faceitId,
          country: r.country,
          avatarUrl: r.avatarUrl,
        });
        return r;
      },
      'players',
    );
  }

  console.log('\nDone.');

  // Final stats
  const teamStats = await sql`SELECT COUNT(*)::int AS c, COUNT(logo_url)::int AS with_logo FROM team_metadata`;
  const playerStats = await sql`SELECT COUNT(*)::int AS c, COUNT(country)::int AS with_country, COUNT(avatar_url)::int AS with_avatar FROM player_metadata`;
  console.log('\nDB now:');
  console.log('  team_metadata: ', teamStats[0]);
  console.log('  player_metadata:', playerStats[0]);
}

main().catch((err) => {
  console.error('\nFAILED:', err);
  process.exit(1);
});
