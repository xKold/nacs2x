# NACS - North American Counter-Strike

A CS2 esports statistics and event tracking platform built for the North American semi-professional scene.

**Live:** [nacs2x.vercel.app](https://nacs2x.vercel.app)

## Features

- **Events** — Dynamically aggregated from PandaScore (Fragadelphia, D2 Eagle Masters, CCT NA, Ace Masters, ESL Challenger, BLAST, and more) plus FACEIT-hosted ESEA leagues. Status updates on every refresh.
- **Live Matches** — Real-time match feed for NA teams across pro events and ESEA Advanced.
- **Brackets** — Double elimination brackets with upper/lower/grand final. Swiss stage rendering with HLTV-style round columns, W-L buckets, and advancement indicators.
- **Player Profiles** — Dual FACEIT/Pro tabs. FACEIT stats (K/D, HS%, win rate, ESEA division history). Pro stats from PandaScore (ADR, KAST, rating) and Grid.gg.
- **Team Profiles** — Rosters, match history, and tournament standings from both FACEIT and PandaScore/Grid.gg. Accessible by FACEIT ID or PandaScore team name.
- **Match Stats** — Normalized stats pipeline across three data sources (FACEIT, PandaScore, Grid.gg) with per-map breakdowns and dynamic stat columns.
- **VRS Rankings** — Official Valve Regional Standings from GitHub, with Americas/NA/SA/Europe/Asia/Global filtering. NA sidebar on main pages.
- **Prize Pools** — Displayed for events with prize data from PandaScore.

## Data Sources

| Source | What it provides |
|---|---|
| **FACEIT** | ESEA leagues, player stats, match history, championship data |
| **PandaScore** | Pro events, brackets, rosters, tournament standings, prize pools |
| **Grid.gg** | Per-player match stats (ADR, K/D/A) for events with official data feeds |
| **Valve GitHub** | Official VRS team rankings by region |

## Tech Stack

- Next.js 16 (App Router) / React 19 / TypeScript
- Tailwind CSS 4
- Neon serverless Postgres — cached team and player metadata (30–60 day TTL)
- Vercel — hosting, per-branch preview deployments, Incremental Static Regeneration

## How It Works

- **One stats schema, three providers.** Each provider has its own normalizer
  (`lib/normalizers/`) that maps its response into a shared `NormalizedMatchStats`
  type and reports which stat columns it can supply, so a single table component
  renders data from any source.
- **Postgres metadata cache.** Team logos and countries are looked up from
  PandaScore and FACEIT once, then served from Neon. Only successful lookups are
  cached, so a rate-limited response is never stored as "no data".
- **NA/SA classification.** Valve publishes one Americas ranking. Teams are split
  into North and South America using provider country data, accent-insensitive
  name matching, and an override list.
- **Failure-aware fetching.** An upstream 404 shows "not found"; a rate limit or
  server error shows "temporarily unavailable" instead.
