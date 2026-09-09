'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface VRSTeam {
  rank: number;
  points: number;
  name: string;
  naRank?: number | null;
  logo?: string | null;
}

/** Team logo with initial-letter fallback (matches the rankings page). */
function TeamLogo({ logo, name }: { logo?: string | null; name: string }) {
  if (logo) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={logo}
        alt=""
        className="w-5 h-5 rounded object-contain bg-surface-hover flex-shrink-0"
      />
    );
  }
  const initial = name.trim().charAt(0).toUpperCase() || '?';
  return (
    <span className="w-5 h-5 rounded bg-surface-hover flex items-center justify-center text-[9px] font-bold text-text-muted flex-shrink-0">
      {initial}
    </span>
  );
}

export default function RankingSidebar() {
  const [teams, setTeams] = useState<VRSTeam[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Explicit region=na — API already applies proper NA/SA classification via
    // PandaScore/FACEIT country lookup, so no client-side filtering needed.
    fetch('/api/rankings?region=na')
      .then((res) => res.json())
      .then((data) => {
        const naTeams = (data.teams || []) as VRSTeam[];
        setTeams(naTeams.slice(0, 10)); // top 10
      })
      .catch(() => setTeams([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="bg-surface rounded-xl border border-border overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <h3 className="text-sm font-bold text-text">NA Rankings</h3>
        <Link
          href="/rankings"
          className="text-[11px] font-semibold text-accent hover:underline uppercase tracking-wider"
        >
          View All
        </Link>
      </div>

      {loading ? (
        <div className="px-4 py-6 flex items-center justify-center">
          <div className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin" />
        </div>
      ) : teams.length === 0 ? (
        <div className="px-4 py-6 text-text-muted text-xs text-center">No data</div>
      ) : (
        <div className="divide-y divide-border/50">
          {teams.map((t) => {
            const rank = t.naRank ?? t.rank;
            return (
              <Link
                key={`${rank}-${t.name}`}
                href={`/teams/pro/${encodeURIComponent(t.name)}`}
                className="flex items-center gap-2 px-3 py-2 hover:bg-surface-hover/50 transition-colors"
              >
                <span
                  className={`text-xs font-bold w-5 text-right flex-shrink-0 ${
                    rank <= 3
                      ? 'text-yellow-400'
                      : rank <= 10
                        ? 'text-accent'
                        : 'text-text-muted'
                  }`}
                >
                  {rank}
                </span>
                <TeamLogo logo={t.logo} name={t.name} />
                <span className="text-xs font-semibold text-text hover:text-accent transition-colors truncate flex-1">
                  {t.name}
                </span>
                <span className="text-[10px] font-mono text-text-muted flex-shrink-0">
                  {t.points}
                </span>
              </Link>
            );
          })}
        </div>
      )}

      <div className="px-4 py-2 border-t border-border">
        <p className="text-[10px] text-text-muted text-center">
          Valve Regional Standings
        </p>
      </div>
    </div>
  );
}
