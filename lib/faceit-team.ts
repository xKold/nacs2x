// FACEIT tournament brackets use placeholder faction_id values like "bye"
// for empty bracket slots. These aren't real teams — linking to them or
// looking them up burns API quota and produces broken pages.
const PLACEHOLDER_TEAM_IDS = new Set(['bye', 'tbd']);

export function isRealFaceitTeamId(
  id: string | null | undefined,
): id is string {
  return !!id && !PLACEHOLDER_TEAM_IDS.has(id.toLowerCase());
}
