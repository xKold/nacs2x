import Link from 'next/link';
import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { fetchProTeamData, checkProTeamExists } from '@/lib/pro-team-api';
import { isRealFaceitTeamId } from '@/lib/faceit-team';
import TeamViewTabs from './TeamViewTabs';
import ProOverview from './ProOverview';

export default async function TeamPage({
  params,
  searchParams,
}: {
  params: Promise<{ teamId: string }>;
  searchParams: Promise<{ championship?: string; view?: string }>;
}) {
  const { teamId } = await params;
  const { championship, view } = await searchParams;

  // Cheap 404 for bracket placeholders like /teams/bye — skip the FACEIT
  // fetch entirely so crawlers hitting stray links don't burn API quota.
  if (!isRealFaceitTeamId(teamId)) {
    notFound();
  }

  const headers = {
    Authorization: `Bearer ${process.env.FACEIT_API_KEY}`,
    Accept: 'application/json',
  };

  // Always fetch FACEIT team info (needed for team name in both views)
  const teamRes = await fetch(
    `https://open.faceit.com/data/v4/teams/${teamId}`,
    { headers, cache: 'no-store' }
  );

  if (!teamRes.ok) {
    return (
      <div className="max-w-4xl mx-auto px-4">
        <div className="bg-surface rounded-xl border border-border p-8">
          <p className="text-live">Team not found (status: {teamRes.status})</p>
        </div>
      </div>
    );
  }

  const team = await teamRes.json();
  const teamName = team.name || team.nickname || 'Unknown Team';

  // Determine active view: default to 'faceit' when championship present, 'pro' otherwise
  const activeView: 'faceit' | 'pro' =
    view === 'faceit' ? 'faceit' : view === 'pro' ? 'pro' : championship ? 'faceit' : 'pro';

  // Fetch pro data: full fetch only when viewing pro tab, lightweight check otherwise
  let proData: Awaited<ReturnType<typeof fetchProTeamData>> = null;
  let hasProData = false;

  if (activeView === 'pro') {
    proData = await fetchProTeamData(teamName);
    hasProData = proData !== null;
  } else {
    // Lightweight check — only searches for team existence (cached 5min), no match fetching
    hasProData = await checkProTeamExists(teamName);
  }

  // Fetch FACEIT championship matches only when viewing FACEIT tab
  let matches: any[] = [];
  if (activeView === 'faceit' && championship) {
    let offset = 0;
    const limit = 100;
    while (true) {
      const matchesRes = await fetch(
        `https://open.faceit.com/data/v4/championships/${championship}/matches?limit=${limit}&offset=${offset}`,
        { headers, cache: 'no-store' }
      );
      if (!matchesRes.ok) break;
      const data = await matchesRes.json();
      const items = data.items || [];
      matches.push(...items);
      if (items.length < limit) break;
      offset += limit;
    }
  }

  // Filter matches to this team
  const teamMatches = matches.filter((m: any) => {
    const f1Id = m.teams?.faction1?.faction_id;
    const f2Id = m.teams?.faction2?.faction_id;
    return f1Id === teamId || f2Id === teamId;
  });

  // Calculate W-L record from inline results
  let wins = 0;
  let losses = 0;
  teamMatches.forEach((m: any) => {
    const score = m.results?.score;
    if (!score) return;
    const isF1 = m.teams?.faction1?.faction_id === teamId;
    const myScore = isF1 ? score.faction1 : score.faction2;
    const oppScore = isF1 ? score.faction2 : score.faction1;
    if (myScore !== undefined && oppScore !== undefined) {
      if (myScore > oppScore) wins++;
      else if (oppScore > myScore) losses++;
    }
  });

  // Categorize matches
  const now = Date.now();
  const ongoing: any[] = [];
  const upcoming: any[] = [];
  const completed: any[] = [];

  teamMatches.forEach((match: any) => {
    const status = match.status?.toLowerCase();
    const start =
      typeof match.scheduled_at === 'number'
        ? match.scheduled_at * 1000
        : typeof match.started_at === 'number'
        ? match.started_at * 1000
        : NaN;

    if (status === 'ongoing') {
      ongoing.push(match);
    } else if (status === 'finished') {
      completed.push(match);
    } else if (!isNaN(start) && start <= now) {
      completed.push(match);
    } else {
      upcoming.push(match);
    }
  });

  const sortByStartTime = (a: any, b: any) => {
    const aStart = ((a.scheduled_at ?? a.started_at) ?? 0) * 1000;
    const bStart = ((b.scheduled_at ?? b.started_at) ?? 0) * 1000;
    return aStart - bStart;
  };
  ongoing.sort(sortByStartTime);
  upcoming.sort(sortByStartTime);
  completed.sort(sortByStartTime);

  const renderMatch = (match: any) => {
    const team1 = match.teams?.faction1?.name || 'TBD';
    const team2 = match.teams?.faction2?.name || 'TBD';
    const team1Id = match.teams?.faction1?.faction_id;
    const team2Id = match.teams?.faction2?.faction_id;
    const isLive = match.status?.toLowerCase() === 'ongoing';

    const timestamp =
      typeof match.scheduled_at === 'number'
        ? match.scheduled_at * 1000
        : typeof match.started_at === 'number'
        ? match.started_at * 1000
        : NaN;

    const score1 = match.results?.score?.faction1;
    const score2 = match.results?.score?.faction2;
    const hasScore = score1 !== undefined && score2 !== undefined;

    const isF1 = team1Id === teamId;
    const oppName = isF1 ? team2 : team1;
    const myName = isF1 ? team1 : team2;

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
          <span className="font-semibold text-text">
            {myName}
          </span>
          {hasScore ? (
            <span className="text-sm font-bold text-text-secondary">
              {isF1 ? `${score1} - ${score2}` : `${score2} - ${score1}`}
            </span>
          ) : (
            <span className="text-text-muted text-sm">vs</span>
          )}
          <span className="font-semibold text-text group-hover:text-accent transition-colors">
            {oppName}
          </span>
        </div>
        <span className="text-sm text-text-muted" suppressHydrationWarning>
          {!isNaN(timestamp) ? new Date(timestamp).toLocaleString() : 'TBD'}
        </span>
      </Link>
    );
  };

  const renderSection = (title: string, sectionMatches: any[], badgeColor: string) => {
    if (sectionMatches.length === 0) return null;
    return (
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-3">
          <span className={`w-2 h-2 rounded-full ${badgeColor}`} />
          <h2 className="text-lg font-semibold">{title}</h2>
          <span className="text-xs text-text-muted">({sectionMatches.length})</span>
        </div>
        <div className="flex flex-col gap-2">
          {sectionMatches.map(renderMatch)}
        </div>
      </div>
    );
  };

  const roster = team.members || [];

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

        {/* Team Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold">{teamName}</h1>
        </div>

        {/* View Tabs */}
        <Suspense fallback={null}>
          <TeamViewTabs activeView={activeView} hasProData={hasProData} />
        </Suspense>

        {/* Pro Overview */}
        {activeView === 'pro' && proData && (
          <ProOverview data={proData} />
        )}

        {activeView === 'pro' && !proData && (
          <p className="text-text-muted text-center py-8">
            Team not found in pro circuit databases.
          </p>
        )}

        {/* FACEIT Stats View */}
        {activeView === 'faceit' && (
          <>
            {/* FACEIT Record */}
            {championship && (wins > 0 || losses > 0) && (
              <div className="flex items-center gap-2 mb-6">
                <span className="text-sm font-medium text-text-secondary">Record:</span>
                <span className="text-sm font-bold text-success">{wins}W</span>
                <span className="text-sm text-text-muted">-</span>
                <span className="text-sm font-bold text-live">{losses}L</span>
              </div>
            )}

            {/* Roster */}
            {roster.length > 0 && (
              <div className="mb-8">
                <h2 className="text-lg font-semibold mb-3">Roster</h2>
                <div className="flex flex-wrap gap-2">
                  {roster.map((member: any) => (
                    <Link
                      key={member.user_id}
                      href={`/players/${member.user_id}${championship ? `?championship=${championship}` : ''}`}
                      className="text-sm px-3 py-1.5 rounded-lg bg-surface-hover border border-border text-text hover:border-accent/40 hover:text-accent transition-all duration-200"
                    >
                      {member.nickname}
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {/* Match History */}
            {championship ? (
              <>
                {ongoing.length === 0 && upcoming.length === 0 && completed.length === 0 ? (
                  <p className="text-text-muted text-center py-8">No matches found for this team in this championship.</p>
                ) : (
                  <>
                    {renderSection('Ongoing', ongoing, 'bg-live')}
                    {renderSection('Upcoming', upcoming, 'bg-warning')}
                    {renderSection('Completed', completed, 'bg-success')}
                  </>
                )}
              </>
            ) : (
              <p className="text-text-muted text-center py-8">Select a championship to view match history.</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
