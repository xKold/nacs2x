import Link from 'next/link';
import MatchStatsTable from '@/app/components/MatchStatsTable';
import { normalizeFaceitStats } from '@/lib/normalizers/faceit-stats';
import { isRealFaceitTeamId } from '@/lib/faceit-team';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const headers = {
    Authorization: `Bearer ${process.env.FACEIT_API_KEY}`,
    Accept: 'application/json',
  };

  const matchDetailRes = await fetch(
    `https://open.faceit.com/data/v4/matches/${id}`,
    { headers, next: { revalidate: 30 } }
  );

  if (!matchDetailRes.ok) {
    return (
      <div className="max-w-4xl mx-auto px-4">
        <div className="bg-surface rounded-xl border border-border p-8">
          <p className="text-live">Match not found (status: {matchDetailRes.status})</p>
        </div>
      </div>
    );
  }

  const matchDetails = await matchDetailRes.json();

  const matchStatsRes = await fetch(
    `https://open.faceit.com/data/v4/matches/${id}/stats`,
    { headers, next: { revalidate: 30 } }
  );

  const matchStats = matchStatsRes.ok
    ? await matchStatsRes.json()
    : { rounds: [] };

  const team1Name = matchDetails.teams?.faction1?.name ?? 'TBD';
  const team2Name = matchDetails.teams?.faction2?.name ?? 'TBD';
  const team1Id = matchDetails.teams?.faction1?.faction_id;
  const team2Id = matchDetails.teams?.faction2?.faction_id;
  const championshipId = matchDetails.competition_id;
  const score1 = matchDetails.results?.score?.faction1;
  const score2 = matchDetails.results?.score?.faction2;
  const hasScore = score1 !== undefined && score2 !== undefined;
  const isLive = matchDetails.status === 'ongoing';
  const isFinished = matchDetails.status === 'FINISHED' || matchDetails.status === 'finished';

  const bestOf = matchDetails.best_of || matchStats.rounds?.length || 1;
  const boLabel = bestOf > 1 ? `BO${bestOf}` : 'BO1';

  const formattedDate = matchDetails.started_at
    ? new Date(matchDetails.started_at * 1000).toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    : matchDetails.start_date
      ? new Date(matchDetails.start_date).toLocaleDateString('en-US', {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
          year: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
        })
      : '';

  // Normalize FACEIT stats
  const normalizedStats = normalizeFaceitStats(matchStats, team1Name, team2Name);

  return (
    <div className="max-w-5xl mx-auto px-4">
      {/* HLTV-Style Header Card */}
      <div className={`rounded-xl border overflow-hidden mb-6 ${isLive ? 'border-live/30 shadow-lg shadow-live/5' : 'border-border'}`}>
        <div className="bg-gradient-to-b from-surface-hover via-surface to-surface p-6 sm:p-8">
          {/* Status badge */}
          <div className="flex justify-center mb-5">
            {isLive ? (
              <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-live px-3 py-1 bg-live/10 border border-live/30 rounded-full">
                <span className="w-2 h-2 rounded-full bg-live animate-pulse" />
                Live
              </span>
            ) : isFinished ? (
              <span className="inline-flex items-center text-xs font-bold uppercase tracking-wider text-text-muted px-3 py-1 bg-text-muted/10 border border-text-muted/30 rounded-full">
                Match Over
              </span>
            ) : (
              <span className="inline-flex items-center text-xs font-bold uppercase tracking-wider text-warning px-3 py-1 bg-warning/10 border border-warning/30 rounded-full">
                Upcoming
              </span>
            )}
          </div>

          {/* Teams + Score */}
          <div className="flex items-center justify-center gap-6 sm:gap-10">
            {/* Team 1 */}
            <div className="flex flex-col items-center gap-3 min-w-0 flex-1">
              <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-xl bg-surface-hover border border-border flex items-center justify-center">
                <span className="text-2xl font-bold text-text-muted">
                  {team1Name.slice(0, 2).toUpperCase()}
                </span>
              </div>
              {isRealFaceitTeamId(team1Id) && championshipId ? (
                <Link
                  href={`/teams/${team1Id}?championship=${championshipId}`}
                  className="font-bold text-lg sm:text-xl text-center truncate max-w-full text-text hover:text-accent transition-colors"
                >
                  {team1Name}
                </Link>
              ) : (
                <span className={`font-bold text-lg sm:text-xl text-center truncate max-w-full ${hasScore && score1 < score2 ? 'text-text-muted' : 'text-text'}`}>
                  {team1Name}
                </span>
              )}
            </div>

            {/* Score */}
            <div className="flex flex-col items-center gap-1 flex-shrink-0">
              {hasScore ? (
                <div className="flex items-center gap-3">
                  <span className={`text-5xl font-black tabular-nums ${score1 > score2 ? 'text-success' : 'text-text-muted'}`}>
                    {score1}
                  </span>
                  <span className="text-3xl text-text-muted font-light">:</span>
                  <span className={`text-5xl font-black tabular-nums ${score2 > score1 ? 'text-success' : 'text-text-muted'}`}>
                    {score2}
                  </span>
                </div>
              ) : (
                <span className="text-3xl text-text-muted font-medium">vs</span>
              )}
              <span className="text-xs text-text-muted font-semibold uppercase tracking-wider">{boLabel}</span>
            </div>

            {/* Team 2 */}
            <div className="flex flex-col items-center gap-3 min-w-0 flex-1">
              <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-xl bg-surface-hover border border-border flex items-center justify-center">
                <span className="text-2xl font-bold text-text-muted">
                  {team2Name.slice(0, 2).toUpperCase()}
                </span>
              </div>
              {isRealFaceitTeamId(team2Id) && championshipId ? (
                <Link
                  href={`/teams/${team2Id}?championship=${championshipId}`}
                  className="font-bold text-lg sm:text-xl text-center truncate max-w-full text-text hover:text-accent transition-colors"
                >
                  {team2Name}
                </Link>
              ) : (
                <span className={`font-bold text-lg sm:text-xl text-center truncate max-w-full ${hasScore && score2 < score1 ? 'text-text-muted' : 'text-text'}`}>
                  {team2Name}
                </span>
              )}
            </div>
          </div>

          {/* Date */}
          <div className="flex items-center justify-center gap-3 mt-5 text-sm text-text-muted">
            {formattedDate && <span suppressHydrationWarning>{formattedDate}</span>}
          </div>
        </div>
      </div>

      {/* Map Result Cards with half scores */}
      {normalizedStats && normalizedStats.maps.length > 0 && (
        <div className="mb-6">
          <h2 className="text-sm font-bold uppercase tracking-wider text-text-secondary mb-4">Map Results</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {normalizedStats.maps.map((map, i) => {
              const t1HalfStr = formatHalfScores(map.team1FirstHalf, map.team1SecondHalf, map.team1Overtime);
              const t2HalfStr = formatHalfScores(map.team2FirstHalf, map.team2SecondHalf, map.team2Overtime);

              return (
                <div key={i} className="rounded-xl border border-border overflow-hidden">
                  {/* Map header */}
                  <div className="px-4 py-2 bg-surface-hover text-xs font-bold uppercase tracking-wider text-text-muted">
                    {map.mapName}
                  </div>

                  {/* Team 1 row */}
                  <div className={`flex items-center gap-3 px-4 py-2.5 bg-surface ${!map.team1Won ? 'opacity-50' : ''}`}>
                    <span className="text-sm font-semibold text-text flex-1 truncate">
                      {team1Name}
                    </span>
                    {t1HalfStr && (
                      <span className="text-xs text-text-muted tabular-nums">
                        {t1HalfStr}
                      </span>
                    )}
                    <span className={`text-sm font-bold tabular-nums ${map.team1Won ? 'text-success' : 'text-text-muted'}`}>
                      {map.team1Score}
                    </span>
                    {map.team1Won && (
                      <svg className="w-4 h-4 text-success flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </div>

                  <div className="border-t border-border/50" />

                  {/* Team 2 row */}
                  <div className={`flex items-center gap-3 px-4 py-2.5 bg-surface ${map.team1Won ? 'opacity-50' : ''}`}>
                    <span className="text-sm font-semibold text-text flex-1 truncate">
                      {team2Name}
                    </span>
                    {t2HalfStr && (
                      <span className="text-xs text-text-muted tabular-nums">
                        {t2HalfStr}
                      </span>
                    )}
                    <span className={`text-sm font-bold tabular-nums ${!map.team1Won ? 'text-success' : 'text-text-muted'}`}>
                      {map.team2Score}
                    </span>
                    {!map.team1Won && (
                      <svg className="w-4 h-4 text-success flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Player Stats */}
      {normalizedStats && (
        <MatchStatsTable stats={normalizedStats} competitionId={championshipId} />
      )}
    </div>
  );
}

/** Format half scores like "(7-5; 6-8)" or "(7-5; 6-8; 3-0)" with OT */
function formatHalfScores(
  firstHalf?: number,
  secondHalf?: number,
  overtime?: number,
): string | null {
  if (firstHalf === undefined && secondHalf === undefined) return null;
  const parts: string[] = [];
  if (firstHalf !== undefined) parts.push(String(firstHalf));
  if (secondHalf !== undefined) parts.push(String(secondHalf));
  if (overtime !== undefined && overtime > 0) parts.push(String(overtime));
  if (parts.length === 0) return null;
  return `(${parts.join('; ')})`;
}
