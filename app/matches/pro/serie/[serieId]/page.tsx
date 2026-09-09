import Link from 'next/link';
import {
  PSBracketMatch,
  PSStanding,
  PSTournament,
  TierBadge,
  parseBracket,
} from '../../components/bracket';
import SerieTabs, { StageData } from './SerieTabs';

interface SerieTournamentListItem {
  id: number;
  name: string;
  tier: string;
  begin_at: string | null;
  end_at: string | null;
}

/**
 * Discriminator so we can tell the difference between "PandaScore says this
 * serie doesn't exist" and "we couldn't reach PandaScore" — the UI treats
 * them differently.
 */
type FetchOutcome<T> =
  | { kind: 'ok'; data: T }
  | { kind: 'not-found' }
  | { kind: 'unavailable'; status?: number };

async function fetchSerieData(serieId: string): Promise<
  FetchOutcome<{ stages: StageData[]; tournamentsList: SerieTournamentListItem[] }>
> {
  const token = process.env.PANDASCORE_API_KEY;
  if (!token) return { kind: 'unavailable' };

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
  };

  // Bumped revalidate 60 → 300s so we hit PandaScore less often (and get
  // less rate-limit exposure on the free tier).
  const fetchJson = async (url: string): Promise<{ ok: true; data: unknown } | { ok: false; status: number }> => {
    try {
      const res = await fetch(url, { headers, next: { revalidate: 300 } });
      if (!res.ok) return { ok: false, status: res.status };
      return { ok: true, data: await res.json() };
    } catch {
      return { ok: false, status: 0 };
    }
  };

  // Fetch all tournaments in this serie
  const tourRes = await fetchJson(
    `https://api.pandascore.co/series/${serieId}/tournaments?per_page=25`,
  );
  if (!tourRes.ok) {
    // 404 = real not-found; everything else (429/500/network) = temporary
    return tourRes.status === 404
      ? { kind: 'not-found' }
      : { kind: 'unavailable', status: tourRes.status };
  }
  const tournamentsList = tourRes.data as SerieTournamentListItem[] | null;
  if (!tournamentsList || tournamentsList.length === 0) {
    return { kind: 'not-found' };
  }

  // Fetch details + brackets for each tournament in parallel
  const stagePromises = tournamentsList.map(async (t) => {
    const [detailRes, bracketsRes, standingsRes] = await Promise.all([
      fetchJson(`https://api.pandascore.co/tournaments/${t.id}`),
      fetchJson(`https://api.pandascore.co/tournaments/${t.id}/brackets`),
      fetchJson(`https://api.pandascore.co/tournaments/${t.id}/standings`),
    ]);
    return {
      detail: detailRes.ok ? (detailRes.data as PSTournament) : null,
      brackets: bracketsRes.ok ? (bracketsRes.data as PSBracketMatch[]) : null,
      standings: standingsRes.ok ? (standingsRes.data as PSStanding[]) : null,
    };
  });

  const stageResults = await Promise.all(stagePromises);

  const stages: StageData[] = [];
  for (const result of stageResults) {
    if (!result.detail) continue;
    const tournament = result.detail;
    const bracketMatches = result.brackets;
    const bracket = bracketMatches ? parseBracket(bracketMatches) : null;
    const prizePool = (tournament as { prizepool?: string }).prizepool;
    stages.push({
      tournament,
      matches: tournament.matches || [],
      bracket,
      bracketMatches: bracketMatches || undefined,
      standings: result.standings || undefined,
      prizePool: prizePool || null,
    });
  }

  if (stages.length === 0) {
    // Tournament list existed but we couldn't fetch any details — likely
    // rate limit / transient failure, not a genuine empty serie.
    return { kind: 'unavailable' };
  }

  return { kind: 'ok', data: { stages, tournamentsList } };
}

export default async function Page({ params }: { params: Promise<{ serieId: string }> }) {
  const { serieId } = await params;
  const outcome = await fetchSerieData(serieId);

  if (outcome.kind === 'not-found') {
    return (
      <div className="max-w-5xl mx-auto px-4">
        <div className="bg-surface rounded-xl border border-border p-8">
          <p className="text-live">Serie not found.</p>
          <Link href="/" className="text-accent hover:underline mt-4 inline-block">
            Back to Events
          </Link>
        </div>
      </div>
    );
  }

  if (outcome.kind === 'unavailable') {
    return (
      <div className="max-w-5xl mx-auto px-4">
        <div className="bg-surface rounded-xl border border-border p-8">
          <h1 className="text-lg font-semibold text-warning mb-2">
            Data temporarily unavailable
          </h1>
          <p className="text-text-secondary text-sm">
            Our upstream data provider is rate-limiting us right now
            {outcome.status ? ` (HTTP ${outcome.status})` : ''}. Match data will
            reappear automatically within a few minutes. This is not a real
            &quot;not found&quot; error — the serie exists.
          </p>
          <Link
            href="/"
            className="text-accent hover:underline mt-4 inline-block text-sm"
          >
            &larr; Back to Events
          </Link>
        </div>
      </div>
    );
  }

  const { stages } = outcome.data;
  const firstStage = stages[0];
  const league = firstStage.tournament.league;
  const serie = firstStage.tournament.serie;
  const tier = firstStage.tournament.tier;

  const serieName = serie?.full_name || serie?.name || '';
  const title = serieName ? `${league.name}: ${serieName}` : league.name;

  // Date range across all stages
  const beginDates = stages
    .map((s) => s.tournament.begin_at)
    .filter(Boolean) as string[];
  const endDates = stages
    .map((s) => s.tournament.end_at)
    .filter(Boolean) as string[];
  const startDate = beginDates.length > 0 ? beginDates.sort()[0] : null;
  const endDate = endDates.length > 0 ? endDates.sort().reverse()[0] : null;

  const dateRange = [
    startDate
      ? new Date(startDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      : null,
    endDate
      ? new Date(endDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      : null,
  ]
    .filter(Boolean)
    .join(' — ');

  const totalMatches = stages.reduce((sum, s) => sum + s.matches.length, 0);

  return (
    <div className="max-w-7xl mx-auto px-4">
      <Link href="/" className="text-accent hover:underline text-sm mb-4 inline-block">
        &larr; Back to Events
      </Link>

      {/* Serie Header */}
      <div className="bg-surface rounded-xl border border-border p-6 mb-6">
        <div className="flex items-center gap-4">
          {league.image_url && (
            <img
              src={league.image_url}
              alt={league.name}
              className="w-14 h-14 object-contain"
            />
          )}
          <div>
            <div className="flex items-center gap-3 mb-1">
              <h1 className="text-2xl font-bold">{title}</h1>
              <TierBadge tier={tier} />
            </div>
            <div className="flex items-center gap-3 text-sm text-text-muted">
              <span>{stages.length} stages</span>
              {dateRange && (
                <>
                  <span className="text-border">|</span>
                  <span suppressHydrationWarning>{dateRange}</span>
                </>
              )}
              <span className="text-border">|</span>
              <span>{totalMatches} matches</span>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs + Content */}
      <SerieTabs stages={stages} />
    </div>
  );
}
