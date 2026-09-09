import { NextRequest, NextResponse } from 'next/server';
import {
  getTeamMetadataMap,
  putTeamMetadata,
  getPlayerMetadataMap,
  putPlayerMetadata,
} from '@/lib/db';

interface VRSTeamRaw {
  rank: number;
  points: number;
  name: string;
  roster: string[];
}

/** Roster player + enriched metadata */
export interface RosterPlayer {
  nickname: string;
  country: string | null;
  faceitId: string | null;
  avatarUrl: string | null;
}

/** Team enriched with cross-region ranks + PandaScore/FACEIT metadata */
export interface VRSTeam extends VRSTeamRaw {
  naRank?: number | null;
  saRank?: number | null;
  americasRank?: number | null;
  worldRank?: number | null;
  region?: 'na' | 'sa';
  country?: string | null;
  logo?: string | null;
  /** Roster with per-player country + FACEIT metadata */
  rosterData?: RosterPlayer[];
}

const VALID_REGIONS = ['na', 'sa', 'americas', 'europe', 'asia', 'global'] as const;
type Region = (typeof VALID_REGIONS)[number];

// ─── NA / SA classification (data-driven with fallback) ────────────────

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

const KNOWN_SA_EXTRA = new Set(
  [
    'dendele', 'alkam turma do pagode', 'yawara', 'mibr fe', 'ex-mibr academy',
    'mibr academy', 'bestia academy', 'meia noite', 'alka', 'procyon',
    'back to back', 'atrix', 'ex-kru', 'players', 'your end',
    'sementes do mal', 'r2', 'guara', 'charrados', 'zetta', 'wachoskys',
    // reported round 3
    'borracheiros', 'quintessencia', 'metanoia wolves', 'crashers',
    'pugdesonesto', 'magicos', 'damajuana', 'mansao maromba', 'herewegoagain',
    // legacy list that was previously hardcoded
    'gaimin gladiators', 'sensei', 'solid', 'nitro', 'bounty hunters',
    'lp', 'fake do biru', 'keyd stars', 'uno mille', 'flyquest',
    'intense', 'swingers', 'infinity', 'hawks',
  ].map((n) => n.toLowerCase()),
);

function normalizeName(s: string): string {
  return s
    .normalize('NFD')
    // strip combining diacritical marks (U+0300..U+036F)
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

function classifyByCountry(country: string | null | undefined, name: string): 'na' | 'sa' {
  const normalized = normalizeName(name);
  if (KNOWN_SA_EXTRA.has(normalized)) return 'sa';
  if (SA_SUBSTRINGS.some((s) => normalized.includes(s))) return 'sa';
  if (country) {
    const c = country.toUpperCase();
    if (SA_COUNTRIES.has(c)) return 'sa';
    if (NA_COUNTRIES.has(c)) return 'na';
  }
  return 'na';
}

// ─── External lookups (PandaScore + FACEIT) ────────────────────────────

interface PSTeam {
  id: number;
  name: string;
  location: string | null;
  image_url: string | null;
}

interface FaceitTeamHit {
  name?: string;
  country?: string;
  avatar?: string;
}

interface FaceitPlayerHit {
  player_id?: string;
  nickname?: string;
  country?: string;
  avatar?: string;
}

interface LookupResult {
  location: string | null;
  image_url: string | null;
  source: string;
}

async function lookupPandaScoreTeam(teamName: string): Promise<LookupResult | null> {
  const token = process.env.PANDASCORE_API_KEY;
  if (!token) return null;
  try {
    const url = `https://api.pandascore.co/csgo/teams?search[name]=${encodeURIComponent(teamName)}&per_page=10&token=${token}`;
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return null;
    const teams = (await res.json()) as PSTeam[];
    const wanted = teamName.toLowerCase().trim();

    // 1) Exact case-insensitive name match (best signal)
    let match = teams.find((t) => (t.name || '').toLowerCase().trim() === wanted);

    // 2) "Chicken Coop" -> "Chicken Coop Esports": prefer teams whose name
    //    STARTS with ours + space, and skip variants like "ex-X" or "X Academy"
    //    that indicate a different team. Only used when no exact hit.
    if (!match) {
      match = teams.find((t) => {
        const n = (t.name || '').toLowerCase().trim();
        if (!n.startsWith(wanted + ' ')) return false;
        const suffix = n.slice(wanted.length + 1);
        // Skip common variant suffixes
        if (/^(academy|fe|female|women|junior|jr|black|blue|red|white|union)\b/.test(suffix)) return false;
        return true;
      });
    }

    if (match) {
      return { location: match.location, image_url: match.image_url, source: 'pandascore' };
    }
    return null;
  } catch {
    return null;
  }
}

async function lookupFaceitTeam(teamName: string): Promise<LookupResult | null> {
  const key = process.env.FACEIT_API_KEY;
  if (!key) return null;
  try {
    const url = `https://open.faceit.com/data/v4/search/teams?name=${encodeURIComponent(teamName)}&game=cs2&limit=10`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const data = await res.json();
    const items = (data.items || []) as FaceitTeamHit[];
    const wanted = teamName.toLowerCase().trim();
    const exact = items.find((t) => (t.name || '').toLowerCase().trim() === wanted);
    if (exact) {
      return {
        location: exact.country ? exact.country.toUpperCase() : null,
        image_url: exact.avatar ?? null,
        source: 'faceit',
      };
    }
    return null;
  } catch {
    return null;
  }
}

/** Merged team lookup: PandaScore + FACEIT in parallel; prefer PS logo. */
async function lookupTeamMetadata(teamName: string): Promise<LookupResult | null> {
  const [ps, faceit] = await Promise.all([
    lookupPandaScoreTeam(teamName),
    lookupFaceitTeam(teamName),
  ]);
  if (!ps && !faceit) return null;
  return {
    location: ps?.location ?? faceit?.location ?? null,
    image_url: ps?.image_url ?? faceit?.image_url ?? null,
    source: ps ? faceit ? 'pandascore+faceit' : 'pandascore' : 'faceit',
  };
}

interface PlayerLookupResult {
  faceitId: string | null;
  country: string | null;
  avatarUrl: string | null;
}

async function lookupFaceitPlayer(nickname: string): Promise<PlayerLookupResult | null> {
  const key = process.env.FACEIT_API_KEY;
  if (!key) return null;
  try {
    const url = `https://open.faceit.com/data/v4/search/players?nickname=${encodeURIComponent(nickname)}&game=cs2&limit=5`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const data = await res.json();
    const items = (data.items || []) as FaceitPlayerHit[];
    const wanted = nickname.toLowerCase().trim();
    const exact = items.find((p) => (p.nickname || '').toLowerCase().trim() === wanted);
    if (exact) {
      return {
        faceitId: exact.player_id ?? null,
        country: exact.country ? exact.country.toUpperCase() : null,
        avatarUrl: exact.avatar ?? null,
      };
    }
    return null;
  } catch {
    return null;
  }
}

interface PSPlayer {
  id: number;
  name: string | null;
  slug: string | null;
  nationality: string | null;
  image_url: string | null;
}

/**
 * Look up a player on PandaScore. PandaScore's `name` field is the player's
 * pro-scene handle (e.g., "NAF", "EliGE"), so exact-match is reliable.
 * Also returns `nationality` (real country) and `image_url` (headshot).
 */
async function lookupPandaScorePlayer(nickname: string): Promise<PlayerLookupResult | null> {
  const token = process.env.PANDASCORE_API_KEY;
  if (!token) return null;
  try {
    const url = `https://api.pandascore.co/csgo/players?search[name]=${encodeURIComponent(nickname)}&per_page=10&token=${token}`;
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return null;
    const items = (await res.json()) as PSPlayer[];
    const wanted = nickname.toLowerCase().trim();
    // Prefer exact name match; fall back to exact slug match.
    const exact =
      items.find((p) => (p.name || '').toLowerCase().trim() === wanted) ??
      items.find((p) => (p.slug || '').toLowerCase().trim() === wanted);
    if (exact) {
      return {
        faceitId: null, // not part of PandaScore's schema
        country: exact.nationality ? exact.nationality.toUpperCase() : null,
        avatarUrl: exact.image_url,
      };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Combined player lookup: prefer PandaScore (curated pro data with real
 * headshots + nationality), fall back to FACEIT for grassroots/academy
 * players. Merges results — always take PandaScore's headshot when available,
 * always take FACEIT's faceit_id when available so lookup pages work.
 */
async function lookupPlayer(nickname: string): Promise<PlayerLookupResult | null> {
  const [ps, faceit] = await Promise.all([
    lookupPandaScorePlayer(nickname),
    lookupFaceitPlayer(nickname),
  ]);
  if (!ps && !faceit) return null;
  return {
    // FACEIT ID from FACEIT (PandaScore doesn't have it)
    faceitId: faceit?.faceitId ?? null,
    // PandaScore country preferred; fall back to FACEIT
    country: ps?.country ?? faceit?.country ?? null,
    // PandaScore headshot preferred (actual pro photos); fall back to FACEIT avatar
    avatarUrl: ps?.avatarUrl ?? faceit?.avatarUrl ?? null,
  };
}

// ─── VRS markdown fetch ────────────────────────────────────────────────

function getVrsRevalidate(): number {
  const day = new Date().getUTCDate();
  return day <= 15 ? 600 : 43200;
}

function githubHeaders(): HeadersInit {
  const token = process.env.GITHUB_TOKEN;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function parseMarkdownTable(md: string): VRSTeamRaw[] {
  const lines = md.split('\n');
  const teams: VRSTeamRaw[] = [];
  for (const line of lines) {
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').map((c) => c.trim()).filter(Boolean);
    if (cells.length < 4) continue;
    const rank = parseInt(cells[0]);
    if (isNaN(rank)) continue;
    const points = parseInt(cells[1]);
    const name = cells[2];
    const roster = cells[3].split(',').map((p) => p.trim()).filter(Boolean);
    teams.push({ rank, points, name, roster });
  }
  return teams;
}

async function fetchRegionFile(
  region: 'americas' | 'europe' | 'asia' | 'global',
  revalidate: number,
): Promise<{ teams: VRSTeamRaw[]; updatedAt: string | null }> {
  try {
    const yearRes = await fetch(
      'https://api.github.com/repos/ValveSoftware/counter-strike_regional_standings/contents/live',
      { headers: githubHeaders(), next: { revalidate } },
    );
    if (!yearRes.ok) return { teams: [], updatedAt: null };
    const years = (await yearRes.json()) as { name: string }[];
    const latestYear = years
      .map((y) => y.name)
      .filter((n) => /^\d{4}$/.test(n))
      .sort()
      .reverse()[0];
    if (!latestYear) return { teams: [], updatedAt: null };

    const indexRes = await fetch(
      `https://api.github.com/repos/ValveSoftware/counter-strike_regional_standings/contents/live/${latestYear}`,
      { headers: githubHeaders(), next: { revalidate } },
    );
    if (!indexRes.ok) return { teams: [], updatedAt: null };
    const files = (await indexRes.json()) as { name: string; download_url: string }[];
    const regionFiles = files
      .filter((f) => f.name.startsWith(`standings_${region}_`) && f.name.endsWith('.md'))
      .sort((a, b) => b.name.localeCompare(a.name));
    if (regionFiles.length === 0) return { teams: [], updatedAt: null };

    const latestFile = regionFiles[0];
    const dateMatch = latestFile.name.match(/(\d{4})_(\d{2})_(\d{2})/);
    const updatedAt = dateMatch ? `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}` : null;

    const mdRes = await fetch(latestFile.download_url, { next: { revalidate } });
    if (!mdRes.ok) return { teams: [], updatedAt };
    const md = await mdRes.text();
    return { teams: parseMarkdownTable(md), updatedAt };
  } catch {
    return { teams: [], updatedAt: null };
  }
}

// ─── Team enrichment (DB-cached; live-fetch on miss) ───────────────────

/**
 * Enrichment budget per request. Fresh loads populate the DB gradually so
 * we never blow the Vercel function timeout on an empty cache.
 */
const MAX_TEAM_LOOKUPS_PER_REQUEST = 40;
const MAX_PLAYER_LOOKUPS_PER_REQUEST = 40;

async function enrichTeamsFromDBAndAPI(
  americasTeams: VRSTeamRaw[],
): Promise<Map<string, { country: string | null; logo: string | null }>> {
  const nameKeys = americasTeams.map((t) => normalizeName(t.name));
  const cached = await getTeamMetadataMap(nameKeys);

  // Determine which need fetching
  const missing: { team: VRSTeamRaw; key: string }[] = [];
  for (const t of americasTeams) {
    const key = normalizeName(t.name);
    if (!cached.has(key)) missing.push({ team: t, key });
  }

  const toFetch = missing.slice(0, MAX_TEAM_LOOKUPS_PER_REQUEST);
  const lookupResults = await Promise.all(
    toFetch.map(({ team }) => lookupTeamMetadata(team.name)),
  );

  // Only cache SUCCESSFUL lookups. If both country and logo are missing,
  // treat it as "not found this round" and retry next request (protects
  // against transient failures like rate limits polluting the cache).
  await Promise.all(
    toFetch.map(async ({ key }, i) => {
      const result = lookupResults[i];
      if (!result || (!result.location && !result.image_url)) return;
      await putTeamMetadata(key, {
        country: result.location,
        logoUrl: result.image_url,
        source: result.source,
      });
    }),
  );

  // Combine cached + newly fetched into the final map
  const out = new Map<string, { country: string | null; logo: string | null }>();
  cached.forEach((v, k) => out.set(k, { country: v.country, logo: v.logoUrl }));
  toFetch.forEach(({ key }, i) => {
    const result = lookupResults[i];
    out.set(key, { country: result?.location ?? null, logo: result?.image_url ?? null });
  });
  return out;
}

async function enrichPlayers(
  nicknames: string[],
): Promise<Map<string, RosterPlayer>> {
  // Dedupe by normalized nickname
  const uniqueMap = new Map<string, string>(); // key -> first-seen nickname
  for (const n of nicknames) {
    const key = normalizeName(n);
    if (!uniqueMap.has(key)) uniqueMap.set(key, n);
  }
  const keys = [...uniqueMap.keys()];

  const cached = await getPlayerMetadataMap(keys);

  const missing: { key: string; nickname: string }[] = [];
  for (const [key, nickname] of uniqueMap) {
    if (!cached.has(key)) missing.push({ key, nickname });
  }

  const toFetch = missing.slice(0, MAX_PLAYER_LOOKUPS_PER_REQUEST);
  const lookupResults = await Promise.all(
    toFetch.map(({ nickname }) => lookupPlayer(nickname)),
  );

  // Only cache SUCCESSFUL player lookups (same reason as teams).
  await Promise.all(
    toFetch.map(async ({ key }, i) => {
      const r = lookupResults[i];
      if (!r || (!r.country && !r.avatarUrl && !r.faceitId)) return;
      await putPlayerMetadata(key, {
        faceitId: r.faceitId,
        country: r.country,
        avatarUrl: r.avatarUrl,
      });
    }),
  );

  const out = new Map<string, RosterPlayer>();
  for (const [key, meta] of cached) {
    out.set(key, {
      nickname: uniqueMap.get(key) ?? key,
      country: meta.country,
      faceitId: meta.faceitId,
      avatarUrl: meta.avatarUrl,
    });
  }
  toFetch.forEach(({ key, nickname }, i) => {
    const r = lookupResults[i];
    out.set(key, {
      nickname,
      country: r?.country ?? null,
      faceitId: r?.faceitId ?? null,
      avatarUrl: r?.avatarUrl ?? null,
    });
  });
  return out;
}

// ─── Cross-region ranks ────────────────────────────────────────────────

async function enrichAmericas(
  americasTeams: VRSTeamRaw[],
  globalTeams: VRSTeamRaw[],
): Promise<VRSTeam[]> {
  const [teamMeta, playerMeta] = await Promise.all([
    enrichTeamsFromDBAndAPI(americasTeams),
    enrichPlayers(americasTeams.flatMap((t) => t.roster)),
  ]);

  const globalRankByName = new Map(
    globalTeams.map((t) => [t.name.toLowerCase(), t.rank] as const),
  );

  const enriched: VRSTeam[] = americasTeams.map((t) => {
    const meta = teamMeta.get(normalizeName(t.name));
    return {
      ...t,
      americasRank: t.rank,
      worldRank: globalRankByName.get(t.name.toLowerCase()) ?? null,
      country: meta?.country ?? null,
      logo: meta?.logo ?? null,
      region: classifyByCountry(meta?.country ?? null, t.name),
      rosterData: t.roster.map((n) => {
        const rp = playerMeta.get(normalizeName(n));
        return (
          rp ?? {
            nickname: n,
            country: null,
            faceitId: null,
            avatarUrl: null,
          }
        );
      }),
    };
  });

  let naCounter = 0;
  let saCounter = 0;
  for (const t of enriched) {
    if (t.region === 'na') {
      naCounter += 1;
      t.naRank = naCounter;
    } else {
      saCounter += 1;
      t.saRank = saCounter;
    }
  }
  return enriched;
}

export async function GET(request: NextRequest) {
  const requestedRegion = (request.nextUrl.searchParams.get('region') || 'na') as Region;
  const region: Region = VALID_REGIONS.includes(requestedRegion) ? requestedRegion : 'na';

  const revalidate = getVrsRevalidate();

  if (region === 'na' || region === 'sa' || region === 'americas') {
    const [americas, global] = await Promise.all([
      fetchRegionFile('americas', revalidate),
      fetchRegionFile('global', revalidate),
    ]);

    const enriched = await enrichAmericas(americas.teams, global.teams);
    const filtered =
      region === 'na'
        ? enriched.filter((t) => t.region === 'na')
        : region === 'sa'
          ? enriched.filter((t) => t.region === 'sa')
          : enriched;

    return NextResponse.json({
      teams: filtered,
      updatedAt: americas.updatedAt,
      region,
    });
  }

  const { teams, updatedAt } = await fetchRegionFile(region, revalidate);
  return NextResponse.json({ teams, updatedAt, region });
}
