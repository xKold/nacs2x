import Link from 'next/link';
import EventBracket, { type BracketData, type MatchScoreMap } from './EventBracket';
import { isRealFaceitTeamId } from '@/lib/faceit-team';

interface TeamStanding {
  team_id: string;
  name: string;
  wins: number;
  losses: number;
  roundsWon: number;
  roundsLost: number;
}

async function fetchBracketGroup(championshipId: string, group: number) {
  try {
    const res = await fetch(
      `https://www.faceit.com/api/championships/v1/championship/${championshipId}/group/${group}/bracket`,
      {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'Mozilla/5.0',
          Referer: 'https://www.faceit.com/',
        },
        cache: 'no-store',
      },
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data?.payload ?? null;
  } catch {
    return null;
  }
}

async function fetchBracket(championshipId: string): Promise<BracketData> {
  const [upper, lower, grandFinal] = await Promise.all([
    fetchBracketGroup(championshipId, 1),
    fetchBracketGroup(championshipId, 2),
    fetchBracketGroup(championshipId, 3),
  ]);
  return {
    upper: upper ?? undefined,
    lower: lower ?? undefined,
    grandFinal: grandFinal ?? undefined,
  };
}

async function fetchAllChampionshipMatches(championshipId: string, headers: Record<string, string>) {
  const allItems: any[] = [];
  let offset = 0;
  const limit = 100;

  while (true) {
    const res = await fetch(
      `https://open.faceit.com/data/v4/championships/${championshipId}/matches?limit=${limit}&offset=${offset}`,
      { headers, cache: 'no-store' }
    );
    if (!res.ok) break;
    const data = await res.json();
    const items = data.items || [];
    allItems.push(...items);
    if (items.length < limit) break;
    offset += limit;
  }

  return allItems;
}

export default async function Page({ params }: { params: Promise<{ championshipId: string }> }) {
  const { championshipId } = await params;

  const headers = {
    Authorization: `Bearer ${process.env.FACEIT_API_KEY}`,
    Accept: 'application/json',
  };

  // Fetch matches, subscriptions, and bracket in parallel
  const [allMatches, subsRes, bracket] = await Promise.all([
    fetchAllChampionshipMatches(championshipId, headers),
    fetch(
      `https://open.faceit.com/data/v4/championships/${championshipId}/subscriptions?limit=100`,
      { headers, cache: 'no-store' }
    ).catch(() => null),
    fetchBracket(championshipId),
  ]);

  // Score map for the bracket component — keyed by match_id (bracket's originId)
  const scoreMap: MatchScoreMap = {};
  for (const m of allMatches) {
    scoreMap[m.match_id] = {
      status: m.status,
      faction1Score: m.results?.score?.faction1,
      faction2Score: m.results?.score?.faction2,
    };
  }

  if (allMatches.length === 0) {
    return (
      <div className="max-w-7xl mx-auto px-4">
        <div className="bg-surface rounded-xl border border-border p-8">
          <p className="text-live">No matches found for this championship.</p>
        </div>
      </div>
    );
  }

  const subsData = subsRes && subsRes.ok ? await subsRes.json() : null;

  // Build standings from subscriptions + match results
  const standingsMap = new Map<string, TeamStanding>();

  if (subsData?.items) {
    for (const sub of subsData.items) {
      const teamId = sub.team?.team_id ?? sub.team_id;
      const name = sub.team?.name ?? sub.team?.nickname ?? 'Unknown';
      if (isRealFaceitTeamId(teamId)) {
        standingsMap.set(teamId, {
          team_id: teamId,
          name,
          wins: 0,
          losses: 0,
          roundsWon: 0,
          roundsLost: 0,
        });
      }
    }
  }

  // Also seed from match data in case subscriptions missed teams
  for (const match of allMatches) {
    for (const faction of ['faction1', 'faction2'] as const) {
      const team = match.teams?.[faction];
      if (isRealFaceitTeamId(team?.faction_id) && !standingsMap.has(team.faction_id)) {
        standingsMap.set(team.faction_id, {
          team_id: team.faction_id,
          name: team.name ?? 'Unknown',
          wins: 0,
          losses: 0,
          roundsWon: 0,
          roundsLost: 0,
        });
      }
    }
  }

  // Tally results from finished matches
  for (const match of allMatches) {
    const status = match.status?.toUpperCase();
    if (status !== 'FINISHED') continue;

    const score = match.results?.score;
    if (!score) continue;

    const f1Id = match.teams?.faction1?.faction_id;
    const f2Id = match.teams?.faction2?.faction_id;
    const s1 = score.faction1;
    const s2 = score.faction2;

    if (f1Id && standingsMap.has(f1Id)) {
      const entry = standingsMap.get(f1Id)!;
      if (s1 > s2) entry.wins++;
      else if (s2 > s1) entry.losses++;
      entry.roundsWon += s1 ?? 0;
      entry.roundsLost += s2 ?? 0;
    }

    if (f2Id && standingsMap.has(f2Id)) {
      const entry = standingsMap.get(f2Id)!;
      if (s2 > s1) entry.wins++;
      else if (s1 > s2) entry.losses++;
      entry.roundsWon += s2 ?? 0;
      entry.roundsLost += s1 ?? 0;
    }
  }

  // Sort standings: wins desc, losses asc, round diff desc
  const standings = Array.from(standingsMap.values()).sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins;
    if (a.losses !== b.losses) return a.losses - b.losses;
    return (b.roundsWon - b.roundsLost) - (a.roundsWon - a.roundsLost);
  });

  // Categorize matches — only ongoing and upcoming for the dashboard
  const ongoing: any[] = [];
  const upcoming: any[] = [];

  allMatches.forEach((match: any) => {
    const status = match.status?.toUpperCase();
    if (status === 'ONGOING') {
      ongoing.push(match);
    } else if (status !== 'FINISHED') {
      const start =
        typeof match.scheduled_at === 'number'
          ? match.scheduled_at * 1000
          : typeof match.started_at === 'number'
          ? match.started_at * 1000
          : NaN;
      if (isNaN(start) || start > Date.now()) {
        upcoming.push(match);
      }
    }
  });

  const sortByStartTime = (a: any, b: any) => {
    const aStart = (a.scheduled_at ?? a.started_at ?? 0) * 1000;
    const bStart = (b.scheduled_at ?? b.started_at ?? 0) * 1000;
    return aStart - bStart;
  };
  ongoing.sort(sortByStartTime);
  upcoming.sort(sortByStartTime);

  const renderMatch = (match: any) => {
    const team1 = match.teams?.faction1?.name || 'TBD';
    const team2 = match.teams?.faction2?.name || 'TBD';
    const status = match.status?.toUpperCase();
    const isLive = status === 'ONGOING';

    const timestamp =
      typeof match.scheduled_at === 'number'
        ? match.scheduled_at * 1000
        : typeof match.started_at === 'number'
        ? match.started_at * 1000
        : NaN;

    const timestampAttr = !isNaN(timestamp) ? timestamp : null;

    return (
      <Link
        key={match.match_id}
        href={`/matches/match/${match.match_id}`}
        className="group flex items-center justify-between p-4 rounded-lg bg-surface-hover/50 border border-border hover:border-accent/40 hover:bg-surface-hover transition-all duration-200"
      >
        <div className="flex items-center gap-3">
          {isLive && (
            <span className="flex items-center gap-1.5 text-xs font-semibold text-live">
              <span className="w-2 h-2 rounded-full bg-live animate-pulse" />
              LIVE
            </span>
          )}
          <span className="font-semibold text-text group-hover:text-accent transition-colors">
            {team1}
          </span>
          <span className="text-text-muted text-sm">vs</span>
          <span className="font-semibold text-text group-hover:text-accent transition-colors">
            {team2}
          </span>
        </div>
        <span
          className="match-time text-sm text-text-muted"
          data-timestamp={timestampAttr}
          suppressHydrationWarning
        >
          {!isNaN(timestamp) ? new Date(timestamp).toLocaleString() : 'TBD'}
        </span>
      </Link>
    );
  };

  const renderSection = (title: string, matches: any[], badgeColor: string) => {
    if (matches.length === 0) return null;
    return (
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-3">
          <span className={`w-2 h-2 rounded-full ${badgeColor}`} />
          <h2 className="text-lg font-semibold">{title}</h2>
          <span className="text-xs text-text-muted">({matches.length})</span>
        </div>
        <div className="flex flex-col gap-2">
          {matches.map(renderMatch)}
        </div>
      </div>
    );
  };

  const hasStandings = standings.length > 0;

  // Pull the championship name from the first match's competition_name (the
  // public /championships/{id} base-detail endpoint 404s for new ESEA-style
  // championship IDs, so we can't rely on it).
  const championshipName = allMatches[0]?.competition_name || 'Championship Dashboard';

  return (
    <div className="max-w-7xl mx-auto px-4">
      <h1 className="text-2xl font-bold mb-6">{championshipName}</h1>

      {/* Two-column layout: Standings + Ongoing/Upcoming */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: Standings */}
        {hasStandings && (
          <div className="bg-surface rounded-xl border border-border p-6">
            <h2 className="text-lg font-semibold mb-4">Standings</h2>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left px-3 py-2 text-text-muted font-medium w-8">#</th>
                    <th className="text-left px-3 py-2 text-text-muted font-medium">Team</th>
                    <th className="text-center px-3 py-2 text-text-muted font-medium">W</th>
                    <th className="text-center px-3 py-2 text-text-muted font-medium">L</th>
                    <th className="text-center px-3 py-2 text-text-muted font-medium">RD</th>
                  </tr>
                </thead>
                <tbody>
                  {standings.map((team, i) => (
                    <tr
                      key={team.team_id}
                      className="border-b border-border/50 hover:bg-surface-hover/50 transition-colors"
                    >
                      <td className="px-3 py-2.5 text-text-muted">{i + 1}</td>
                      <td className="px-3 py-2.5">
                        <Link
                          href={`/teams/${team.team_id}?championship=${championshipId}`}
                          className="font-medium text-text hover:text-accent transition-colors"
                        >
                          {team.name}
                        </Link>
                      </td>
                      <td className="text-center px-3 py-2.5 font-bold text-success">{team.wins}</td>
                      <td className="text-center px-3 py-2.5 font-bold text-live">{team.losses}</td>
                      <td className="text-center px-3 py-2.5 text-text-secondary">
                        {team.roundsWon - team.roundsLost >= 0 ? '+' : ''}
                        {team.roundsWon - team.roundsLost}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Right: Ongoing + Upcoming */}
        <div className="bg-surface rounded-xl border border-border p-6">
          {ongoing.length === 0 && upcoming.length === 0 ? (
            <p className="text-text-muted text-center py-8">No upcoming or live matches.</p>
          ) : (
            <>
              {renderSection('Ongoing', ongoing, 'bg-live')}
              {renderSection('Upcoming', upcoming, 'bg-warning')}
            </>
          )}
        </div>
      </div>

      {/* Bracket (only rendered when the championship has bracket data) */}
      <EventBracket bracket={bracket} scoreMap={scoreMap} />

      <script
        dangerouslySetInnerHTML={{
          __html: `
            document.addEventListener('DOMContentLoaded', function() {
              document.querySelectorAll('.match-time').forEach(function(el) {
                var ts = el.getAttribute('data-timestamp');
                if (ts) el.textContent = new Date(parseInt(ts)).toLocaleString();
              });
            });
          `,
        }}
      />
    </div>
  );
}
