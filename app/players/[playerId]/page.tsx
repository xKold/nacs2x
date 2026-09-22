import Link from 'next/link';
import { Suspense } from 'react';
import { fetchProPlayerData, checkProPlayerExists } from '@/lib/pro-player-api';
import { isRealFaceitTeamId } from '@/lib/faceit-team';
import PlayerViewTabs from './PlayerViewTabs';
import PlayerProOverview from './PlayerProOverview';

export default async function PlayerPage({
  params,
  searchParams,
}: {
  params: Promise<{ playerId: string }>;
  searchParams: Promise<{ championship?: string; view?: string }>;
}) {
  const { playerId } = await params;
  const { championship, view } = await searchParams;

  const headers = {
    Authorization: `Bearer ${process.env.FACEIT_API_KEY}`,
    Accept: 'application/json',
  };

  const fetchJson = async (url: string) => {
    const res = await fetch(url, { headers, cache: 'no-store' });
    if (!res.ok) return null;
    return res.json();
  };

  // Always fetch FACEIT player info (needed for nickname in both views)
  const player = await fetchJson(`https://open.faceit.com/data/v4/players/${playerId}`);

  if (!player) {
    return (
      <div className="max-w-4xl mx-auto px-4">
        <div className="bg-surface rounded-xl border border-border p-8">
          <p className="text-live">Player not found.</p>
        </div>
      </div>
    );
  }

  // Parse player info
  const nickname = player.nickname ?? 'Unknown';
  const country = player.country?.toUpperCase() ?? '';
  const elo = player.games?.cs2?.faceit_elo ?? null;
  const skillLevel = player.games?.cs2?.skill_level ?? null;
  const faceitUrl = player.faceit_url
    ? player.faceit_url.replace('{lang}', 'en')
    : null;
  const steamId64 = player.steam_id_64 ?? null;

  // Determine active view (default: faceit)
  const activeView: 'faceit' | 'pro' = view === 'pro' ? 'pro' : 'faceit';

  // Always fetch FACEIT teams (needed for pro team-name fallback + FACEIT view)
  const teamsData = await fetchJson(
    `https://open.faceit.com/data/v4/players/${playerId}/teams?game=cs2`
  );
  const faceitTeamNames: string[] = (teamsData?.items ?? [])
    .filter((t: any) => t.game === 'cs2')
    .map((t: any) => t.name ?? t.nickname)
    .filter(Boolean);

  // Fetch pro data: full fetch on pro view, lightweight check on faceit view
  let proData: Awaited<ReturnType<typeof fetchProPlayerData>> = null;
  let hasProData = false;

  if (activeView === 'pro') {
    proData = await fetchProPlayerData(nickname, faceitTeamNames);
    hasProData = proData !== null;
  } else {
    hasProData = await checkProPlayerExists(nickname, faceitTeamNames);
  }

  // Fetch additional FACEIT data only when viewing FACEIT tab
  let stats: any = null;
  let history: any = null;
  let champMatches: any = null;

  if (activeView === 'faceit') {
    const faceitFetches: Promise<any>[] = [
      fetchJson(`https://open.faceit.com/data/v4/players/${playerId}/stats/cs2`),
      fetchJson(`https://open.faceit.com/data/v4/players/${playerId}/history?game=cs2&limit=100`),
    ];

    if (championship) {
      faceitFetches.push(
        fetchJson(`https://open.faceit.com/data/v4/championships/${championship}/matches?limit=100`)
      );
    }

    [stats, history, champMatches] = await Promise.all(faceitFetches);
  }

  // Parse FACEIT data (only used for faceit view)
  const lifetime = stats?.lifetime ?? {};
  const statCards = [
    { label: 'Matches', value: lifetime['Matches'] ?? '—' },
    { label: 'Win Rate', value: lifetime['Win Rate %'] ? `${lifetime['Win Rate %']}%` : '—' },
    { label: 'Avg K/D', value: lifetime['Average K/D Ratio'] ?? '—' },
    { label: 'Avg HS%', value: lifetime['Average Headshots %'] ? `${lifetime['Average Headshots %']}%` : '—' },
    { label: 'Longest Win Streak', value: lifetime['Longest Win Streak'] ?? '—' },
    { label: 'Current Win Streak', value: lifetime['Current Win Streak'] ?? '—' },
  ];

  const playerTeams: any[] = (teamsData?.items ?? []).filter(
    (t: any) => t.game === 'cs2' && isRealFaceitTeamId(t.team_id)
  );

  const allHistory: any[] = history?.items ?? [];

  // Group unique championships from match history
  const championshipMap = new Map<string, { name: string; id: string; matchCount: number; latestDate: number }>();
  allHistory
    .filter((m: any) => m.competition_type === 'championship')
    .forEach((m: any) => {
      const cid = m.competition_id;
      if (!cid) return;
      if (!championshipMap.has(cid)) {
        championshipMap.set(cid, {
          name: m.competition_name || 'Unknown Tournament',
          id: cid,
          matchCount: 1,
          latestDate: m.started_at || m.finished_at || 0,
        });
      } else {
        const entry = championshipMap.get(cid)!;
        entry.matchCount++;
        const date = m.started_at || m.finished_at || 0;
        if (date > entry.latestDate) entry.latestDate = date;
      }
    });
  const tournamentsList = Array.from(championshipMap.values())
    .sort((a, b) => b.latestDate - a.latestDate);

  // Parse ESEA division history from championship names
  const eseaDivisions: { season: number; division: string; competitionId: string; fullName: string }[] = [];
  const seenSeasons = new Set<number>();
  for (const t of tournamentsList) {
    const divMatch = t.name.match(/ESEA\s+(Open|Intermediate|Main|Advanced|Premier|Challenger)\s+Season\s+(\d+)/i);
    if (divMatch) {
      const seasonNum = parseInt(divMatch[2]);
      if (!seenSeasons.has(seasonNum)) {
        seenSeasons.add(seasonNum);
        eseaDivisions.push({
          season: seasonNum,
          division: divMatch[1],
          competitionId: t.id,
          fullName: t.name,
        });
      }
    }
  }
  eseaDivisions.sort((a, b) => b.season - a.season);

  // Filter recent ESEA matches
  const eseaMatches = allHistory.filter((m: any) => {
    const name = (m.competition_name || '').toLowerCase();
    return m.competition_type === 'championship' && name.includes('esea');
  });

  let playerChampMatches: any[] = [];
  if (championship && champMatches?.items) {
    playerChampMatches = champMatches.items.filter((match: any) => {
      const f1Players = match.teams?.faction1?.roster ?? [];
      const f2Players = match.teams?.faction2?.roster ?? [];
      return (
        f1Players.some((p: any) => p.player_id === playerId) ||
        f2Players.some((p: any) => p.player_id === playerId)
      );
    });
    playerChampMatches.sort((a: any, b: any) => {
      const aT = (a.scheduled_at ?? a.started_at ?? 0);
      const bT = (b.scheduled_at ?? b.started_at ?? 0);
      return bT - aT;
    });
  }

  const renderMatchRow = (match: any, showCompetition = false) => {
    const team1 = match.teams?.faction1?.name ?? 'TBD';
    const team2 = match.teams?.faction2?.name ?? 'TBD';
    const f1Id = match.teams?.faction1?.faction_id;
    const score1 = match.results?.score?.faction1;
    const score2 = match.results?.score?.faction2;
    const hasScore = score1 !== undefined && score2 !== undefined;

    const f1Roster = match.teams?.faction1?.roster ?? [];
    const isF1 = f1Roster.some((p: any) => p.player_id === playerId);
    const myScore = isF1 ? score1 : score2;
    const oppScore = isF1 ? score2 : score1;
    const won = hasScore && myScore > oppScore;

    const timestamp =
      typeof match.scheduled_at === 'number'
        ? match.scheduled_at * 1000
        : typeof match.started_at === 'number'
        ? match.started_at * 1000
        : NaN;

    return (
      <Link
        key={match.match_id}
        href={`/matches/match/${match.match_id}`}
        className="group flex items-center justify-between p-3 rounded-lg bg-surface-hover/50 border border-border hover:border-accent/40 hover:bg-surface-hover transition-all duration-200"
      >
        <div className="flex items-center gap-3">
          {hasScore && (
            <span
              className={`text-xs font-bold px-2 py-0.5 rounded ${
                won ? 'bg-success/20 text-success' : 'bg-live/20 text-live'
              }`}
            >
              {won ? 'W' : 'L'}
            </span>
          )}
          <span className="font-medium text-text text-sm">{team1}</span>
          {hasScore ? (
            <span className="text-sm font-bold text-text-secondary">
              {score1} - {score2}
            </span>
          ) : (
            <span className="text-text-muted text-sm">vs</span>
          )}
          <span className="font-medium text-text text-sm">{team2}</span>
        </div>
        <div className="flex items-center gap-3">
          {showCompetition && match.competition_name && (
            <span className="text-xs text-text-muted hidden sm:inline">{match.competition_name}</span>
          )}
          <span className="text-xs text-text-muted" suppressHydrationWarning>
            {!isNaN(timestamp) ? new Date(timestamp).toLocaleDateString() : ''}
          </span>
        </div>
      </Link>
    );
  };

  const renderHistoryRow = (match: any) => {
    const team1 = match.teams?.[0]?.nickname ?? 'Team 1';
    const team2 = match.teams?.[1]?.nickname ?? 'Team 2';
    const team1Players = match.teams?.[0]?.players ?? [];
    const isTeam1 = team1Players.some((p: any) => p.player_id === playerId);
    const score1 = parseInt(match.teams?.[0]?.team_stats?.['Final Score'] ?? '0');
    const score2 = parseInt(match.teams?.[1]?.team_stats?.['Final Score'] ?? '0');
    const hasScore = !isNaN(score1) && !isNaN(score2) && (score1 > 0 || score2 > 0);
    const myScore = isTeam1 ? score1 : score2;
    const oppScore = isTeam1 ? score2 : score1;
    const won = hasScore && myScore > oppScore;

    const timestamp =
      typeof match.started_at === 'number'
        ? match.started_at * 1000
        : typeof match.finished_at === 'number'
        ? match.finished_at * 1000
        : NaN;

    return (
      <Link
        key={match.match_id}
        href={`/matches/match/${match.match_id}`}
        className="group flex items-center justify-between p-3 rounded-lg bg-surface-hover/50 border border-border hover:border-accent/40 hover:bg-surface-hover transition-all duration-200"
      >
        <div className="flex items-center gap-3">
          {hasScore && (
            <span
              className={`text-xs font-bold px-2 py-0.5 rounded ${
                won ? 'bg-success/20 text-success' : 'bg-live/20 text-live'
              }`}
            >
              {won ? 'W' : 'L'}
            </span>
          )}
          <span className="font-medium text-text text-sm">{team1}</span>
          {hasScore ? (
            <span className="text-sm font-bold text-text-secondary">
              {score1} - {score2}
            </span>
          ) : (
            <span className="text-text-muted text-sm">vs</span>
          )}
          <span className="font-medium text-text text-sm">{team2}</span>
        </div>
        <div className="flex items-center gap-3">
          {match.competition_name && (
            <span className="text-xs text-text-muted hidden sm:inline">{match.competition_name}</span>
          )}
          <span className="text-xs text-text-muted" suppressHydrationWarning>
            {!isNaN(timestamp) ? new Date(timestamp).toLocaleDateString() : ''}
          </span>
        </div>
      </Link>
    );
  };

  return (
    <div className="max-w-4xl mx-auto px-4">
      <div className="bg-surface rounded-xl border border-border p-8">
        {/* Back Link */}
        {championship && (
          <Link
            href={`/matches/event/${championship}`}
            className="inline-flex items-center gap-1.5 text-sm text-text-secondary hover:text-accent transition-colors mb-4"
          >
            &larr; Back to Championship
          </Link>
        )}

        {/* Player Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold">{nickname}</h1>
          <div className="flex flex-wrap items-center gap-4 mt-2">
            {country && (
              <span className="text-sm text-text-secondary">{country}</span>
            )}
            {elo !== null && (
              <span className="text-sm text-text-secondary">
                ELO: <span className="font-bold text-accent">{elo}</span>
              </span>
            )}
            {skillLevel !== null && (
              <span className="text-sm text-text-secondary">
                Level: <span className="font-bold text-accent">{skillLevel}</span>
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 mt-3">
            {faceitUrl && (
              <a
                href={faceitUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm px-3 py-1.5 rounded-lg bg-surface-hover border border-border text-text-secondary hover:text-accent hover:border-accent/40 transition-all duration-200"
              >
                FACEIT Profile &rarr;
              </a>
            )}
            {steamId64 && (
              <a
                href={`https://steamcommunity.com/profiles/${steamId64}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm px-3 py-1.5 rounded-lg bg-surface-hover border border-border text-text-secondary hover:text-accent hover:border-accent/40 transition-all duration-200"
              >
                Steam Profile &rarr;
              </a>
            )}
          </div>
        </div>

        {/* View Tabs */}
        <Suspense fallback={null}>
          <PlayerViewTabs activeView={activeView} hasProData={hasProData} />
        </Suspense>

        {/* Pro Overview */}
        {activeView === 'pro' && proData && (
          <PlayerProOverview
            data={proData}
            playerNickname={nickname}
            faceitTeams={(teamsData?.items ?? [])
              .filter((t: any) => t.game === 'cs2')
              .map((t: any) => ({ teamId: t.team_id, name: t.name ?? t.nickname ?? '' }))}
          />
        )}

        {activeView === 'pro' && !proData && (
          <p className="text-text-muted text-center py-8">
            Player not found in pro circuit databases.
          </p>
        )}

        {/* FACEIT Stats View */}
        {activeView === 'faceit' && (
          <>
            {/* Lifetime CS2 Stats */}
            {stats?.lifetime && (
              <div className="mb-8">
                <h2 className="text-lg font-semibold mb-3">Lifetime CS2 Stats</h2>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                  {statCards.map((card) => (
                    <div
                      key={card.label}
                      className="bg-surface-hover rounded-lg border border-border p-4 text-center"
                    >
                      <div className="text-2xl font-bold text-accent">{card.value}</div>
                      <div className="text-xs text-text-muted mt-1">{card.label}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Teams */}
            {playerTeams.length > 0 && (
              <div className="mb-8">
                <h2 className="text-lg font-semibold mb-3">Teams</h2>
                <div className="flex flex-wrap gap-2">
                  {playerTeams.map((t: any) => (
                    <Link
                      key={t.team_id}
                      href={`/teams/${t.team_id}${championship ? `?championship=${championship}` : ''}`}
                      className="text-sm px-3 py-1.5 rounded-lg bg-surface-hover border border-border text-text hover:border-accent/40 hover:text-accent transition-all duration-200"
                    >
                      {t.name ?? t.nickname ?? 'Unknown Team'}
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {/* Tournaments (unique championships from history) */}
            {tournamentsList.length > 0 && (
              <div className="mb-8">
                <h2 className="text-lg font-semibold mb-3">Tournaments</h2>
                <div className="flex flex-wrap gap-2">
                  {tournamentsList.map((t) => (
                    <Link
                      key={t.id}
                      href={`/matches/event/${t.id}`}
                      className="inline-flex items-center gap-2 text-sm px-3 py-1.5 rounded-lg bg-surface-hover border border-border text-text-secondary hover:border-accent/40 hover:text-accent transition-all duration-200"
                    >
                      <span>{t.name}</span>
                      <span className="text-xs text-text-muted">({t.matchCount})</span>
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {/* ESEA Division History */}
            {eseaDivisions.length > 0 && (
              <div className="mb-8">
                <div className="flex items-center gap-2 mb-3">
                  <span className="w-2 h-2 rounded-full bg-warning" />
                  <h2 className="text-lg font-semibold">ESEA History</h2>
                </div>
                <div className="flex flex-wrap gap-2">
                  {eseaDivisions.map((d) => (
                    <Link
                      key={d.competitionId}
                      href={`/matches/event/${d.competitionId}`}
                      className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-surface-hover border border-border hover:border-accent/40 transition-all duration-200"
                    >
                      <span className="text-sm font-bold text-text">S{d.season}</span>
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded ${
                        d.division.toLowerCase() === 'advanced' ? 'bg-purple-500/20 text-purple-400 border border-purple-500/30'
                        : d.division.toLowerCase() === 'premier' || d.division.toLowerCase() === 'challenger' ? 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30'
                        : d.division.toLowerCase() === 'main' ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                        : d.division.toLowerCase() === 'intermediate' ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                        : 'bg-text-muted/15 text-text-muted border border-text-muted/30'
                      }`}>
                        {d.division}
                      </span>
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {/* Championship Matches (when viewing a specific championship) */}
            {championship && playerChampMatches.length > 0 && (
              <div className="mb-8">
                <div className="flex items-center gap-2 mb-3">
                  <span className="w-2 h-2 rounded-full bg-accent" />
                  <h2 className="text-lg font-semibold">Championship Matches</h2>
                  <span className="text-xs text-text-muted">({playerChampMatches.length})</span>
                </div>
                <div className="flex flex-col gap-2">
                  {playerChampMatches.map((m: any) => renderMatchRow(m))}
                </div>
              </div>
            )}

            {/* Recent ESEA Matches */}
            {eseaMatches.length > 0 && (
              <div className="mb-8">
                <div className="flex items-center gap-2 mb-3">
                  <span className="w-2 h-2 rounded-full bg-success" />
                  <h2 className="text-lg font-semibold">Recent ESEA Matches</h2>
                  <span className="text-xs text-text-muted">({eseaMatches.length})</span>
                </div>
                <div className="flex flex-col gap-2">
                  {eseaMatches.map((m: any) => renderHistoryRow(m))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
