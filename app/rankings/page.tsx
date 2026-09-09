'use client';

import { Fragment, useEffect, useState } from 'react';
import Link from 'next/link';

interface RosterPlayer {
  nickname: string;
  country: string | null;
  faceitId: string | null;
  avatarUrl: string | null;
}

interface VRSTeam {
  rank: number;
  points: number;
  name: string;
  roster: string[];
  naRank?: number | null;
  saRank?: number | null;
  americasRank?: number | null;
  worldRank?: number | null;
  region?: 'na' | 'sa';
  country?: string | null;
  logo?: string | null;
  rosterData?: RosterPlayer[];
}

/**
 * Renders a country flag as an <img> from flagcdn.com. Windows doesn't
 * ship reliable flag emoji fonts (renders as text codes like "US"), so we
 * use rasterised flag PNGs which look identical everywhere.
 */
function FlagIcon({
  country,
  className = 'w-4 h-3',
}: {
  country: string | null | undefined;
  className?: string;
}) {
  if (!country || country.length !== 2) return null;
  const cc = country.toLowerCase();
  // eslint-disable-next-line @next/next/no-img-element
  return (
    <img
      src={`https://flagcdn.com/w40/${cc}.png`}
      srcSet={`https://flagcdn.com/w80/${cc}.png 2x`}
      alt={country.toUpperCase()}
      title={country.toUpperCase()}
      className={`${className} object-cover rounded-sm flex-shrink-0`}
      loading="lazy"
    />
  );
}

/** Team logo with initial-letter fallback when PandaScore has no image. */
function TeamLogo({ logo, name }: { logo?: string | null; name: string }) {
  if (logo) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={logo}
        alt=""
        className="w-6 h-6 rounded object-contain bg-surface-hover flex-shrink-0"
      />
    );
  }
  const initial = name.trim().charAt(0).toUpperCase() || '?';
  return (
    <span className="w-6 h-6 rounded bg-surface-hover flex items-center justify-center text-[10px] font-bold text-text-muted flex-shrink-0">
      {initial}
    </span>
  );
}

/** Large player photo card used inside the expanded roster panel. */
function PlayerCard({ player }: { player: RosterPlayer }) {
  const href = player.faceitId
    ? `/players/${player.faceitId}?view=pro`
    : `/players/lookup?nick=${encodeURIComponent(player.nickname)}`;
  const initial = player.nickname.trim().charAt(0).toUpperCase() || '?';
  return (
    <Link
      href={href}
      className="group flex flex-col items-center rounded-lg border border-border bg-surface hover:border-accent/40 hover:bg-surface-hover transition-all duration-200 p-3"
    >
      {player.avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={player.avatarUrl}
          alt={player.nickname}
          className="w-20 h-20 rounded object-cover bg-surface-hover"
        />
      ) : (
        <div className="w-20 h-20 rounded bg-surface-hover flex items-center justify-center text-2xl font-bold text-text-muted">
          {initial}
        </div>
      )}
      <div className="mt-2 flex items-center gap-1.5 text-sm font-medium text-text group-hover:text-accent transition-colors">
        <FlagIcon country={player.country} className="w-5 h-3.5" />
        <span className="truncate">{player.nickname}</span>
      </div>
    </Link>
  );
}

type DisplayRegion = 'na' | 'sa' | 'americas' | 'europe' | 'asia' | 'global';

const REGIONS: { key: DisplayRegion; label: string }[] = [
  { key: 'na', label: 'NA' },
  { key: 'sa', label: 'SA' },
  { key: 'americas', label: 'Americas' },
  { key: 'europe', label: 'Europe' },
  { key: 'asia', label: 'Asia' },
  { key: 'global', label: 'Global' },
];

function RankCell({
  value,
  emphasize,
}: {
  value: number | null | undefined;
  emphasize?: boolean;
}) {
  if (value == null) {
    return <span className="text-text-muted/50">—</span>;
  }
  const highlight =
    emphasize && value <= 3
      ? 'text-yellow-400'
      : emphasize && value <= 10
        ? 'text-accent'
        : 'text-text';
  return <span className={`font-bold ${highlight}`}>#{value}</span>;
}

export default function RankingsPage() {
  const [teams, setTeams] = useState<VRSTeam[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [region, setRegion] = useState<DisplayRegion>('na');
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/rankings?region=${region}`)
      .then((res) => res.json())
      .then((data) => {
        setTeams(data.teams || []);
        setUpdatedAt(data.updatedAt);
      })
      .catch(() => setTeams([]))
      .finally(() => setLoading(false));
    setExpandedKey(null); // collapse on region switch
  }, [region]);

  const isAmericasView = region === 'na' || region === 'sa' || region === 'americas';

  // Column count for the expanded panel's colSpan
  const totalCols = isAmericasView
    ? (region === 'na' || region === 'sa' ? 6 : 5) // NA/SA: naRank/saRank + amRank + worldRank + team + points + roster = 6
    : 4; // # + team + points + roster = 4

  return (
    <div className="max-w-6xl mx-auto px-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold">Valve Regional Standings</h1>
          <p className="text-text-secondary text-sm mt-1">
            {updatedAt && (
              <span className="text-text-muted">
                Updated{' '}
                {new Date(updatedAt).toLocaleDateString('en-US', {
                  month: 'long',
                  day: 'numeric',
                  year: 'numeric',
                })}
                <span className="text-text-muted/70"> · Valve publishes VRS monthly</span>
              </span>
            )}
          </p>
        </div>

        {/* Region tabs */}
        <div className="flex items-center bg-surface rounded-lg border border-border p-0.5">
          {REGIONS.map((r) => (
            <button
              key={r.key}
              onClick={() => setRegion(r.key)}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all duration-200 ${
                region === r.key
                  ? 'bg-accent text-white shadow-lg shadow-accent/25'
                  : 'text-text-secondary hover:text-text'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {/* Rankings Table */}
      <div className="bg-surface rounded-xl border border-border overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center gap-3 py-12 text-text-secondary">
            <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
            Loading rankings...
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-hover/50 text-text-muted font-semibold text-xs uppercase tracking-wider">
                {isAmericasView && (
                  <>
                    {region === 'na' && (
                      <th className="text-center px-3 py-3 w-16">NA VRS</th>
                    )}
                    {region === 'sa' && (
                      <th className="text-center px-3 py-3 w-16">SA VRS</th>
                    )}
                    <th className="text-center px-3 py-3 w-20">AMs VRS</th>
                    <th className="text-center px-3 py-3 w-20">World VRS</th>
                  </>
                )}
                {!isAmericasView && (
                  <th className="text-center px-3 py-3 w-16">#</th>
                )}
                <th className="text-left px-4 py-3">Team</th>
                <th className="text-right px-4 py-3 w-24">Points</th>
                <th className="text-left px-4 py-3 hidden md:table-cell">Roster</th>
              </tr>
            </thead>
            <tbody>
              {teams.map((t) => {
                const rowKey = `${t.americasRank ?? t.rank}-${t.name}`;
                const isExpanded = expandedKey === rowKey;
                const rosterList = t.rosterData ?? t.roster.map((n) => ({
                  nickname: n,
                  country: null,
                  faceitId: null,
                  avatarUrl: null,
                }));
                const toggle = () => setExpandedKey(isExpanded ? null : rowKey);
                return (
                  <Fragment key={rowKey}>
                    <tr
                      onClick={toggle}
                      className={`border-b border-border/50 cursor-pointer transition-colors ${
                        isExpanded
                          ? 'bg-surface-hover/70'
                          : 'hover:bg-surface-hover/50'
                      }`}
                    >
                      {isAmericasView && (
                        <>
                          {region === 'na' && (
                            <td className="text-center px-3 py-3">
                              <RankCell value={t.naRank} emphasize />
                            </td>
                          )}
                          {region === 'sa' && (
                            <td className="text-center px-3 py-3">
                              <RankCell value={t.saRank} emphasize />
                            </td>
                          )}
                          <td className="text-center px-3 py-3">
                            <RankCell
                              value={t.americasRank}
                              emphasize={region === 'americas'}
                            />
                          </td>
                          <td className="text-center px-3 py-3">
                            <RankCell value={t.worldRank} />
                          </td>
                        </>
                      )}
                      {!isAmericasView && (
                        <td className="text-center px-3 py-3">
                          <RankCell value={t.rank} emphasize />
                        </td>
                      )}
                      <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                        <Link
                          href={`/teams/pro/${encodeURIComponent(t.name)}`}
                          className="inline-flex items-center gap-2 font-semibold text-text hover:text-accent transition-colors"
                        >
                          <TeamLogo logo={t.logo} name={t.name} />
                          <span>{t.name}</span>
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="font-mono font-bold text-text">
                          {t.points.toLocaleString()}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs hidden md:table-cell">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-text-muted truncate">
                            {rosterList.map((p) => p.nickname).join(', ')}
                          </span>
                          {/* Expand indicator */}
                          <svg
                            className={`w-4 h-4 flex-shrink-0 text-text-muted transition-transform duration-200 ${
                              isExpanded ? 'rotate-180' : ''
                            }`}
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={2}
                            aria-hidden
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                          </svg>
                        </div>
                      </td>
                    </tr>

                    {isExpanded && (
                      <tr key={`${rowKey}-expanded`} className="border-b border-border/50">
                        <td
                          colSpan={totalCols}
                          className="bg-surface-hover/40 px-4 py-5"
                        >
                          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
                            {rosterList.map((p) => (
                              <PlayerCard key={`${rowKey}-card-${p.nickname}`} player={p} />
                            ))}
                          </div>
                          <div className="mt-4 pt-3 border-t border-border/60 flex items-center justify-center gap-6 text-xs">
                            <Link
                              href={`/teams/pro/${encodeURIComponent(t.name)}`}
                              className="text-text-secondary hover:text-accent transition-colors font-semibold uppercase tracking-wider"
                            >
                              Pro Team Profile
                            </Link>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}

        {!loading && teams.length === 0 && (
          <div className="text-text-muted text-center py-8">No teams found.</div>
        )}
      </div>

      <p className="text-text-muted text-xs mt-4 text-center">
        Data from{' '}
        <a
          href="https://github.com/ValveSoftware/counter-strike_regional_standings"
          target="_blank"
          rel="noopener noreferrer"
          className="text-accent hover:underline"
        >
          Valve Counter-Strike Regional Standings
        </a>
      </p>
    </div>
  );
}
