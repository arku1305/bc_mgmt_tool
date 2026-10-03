function pick(source, keys) {
  const result = {};
  if (!source || typeof source !== 'object') return result;
  for (const key of keys) if (Object.hasOwn(source, key)) result[key] = source[key];
  return result;
}
function publicSchedule(data) {
  data = data || {};
  const court = value => ({ team1: Array.isArray(value?.team1) ? value.team1.filter(v => typeof v === 'string') : [], team2: Array.isArray(value?.team2) ? value.team2.filter(v => typeof v === 'string') : [] });
  return {
    // Allowlist rather than stripping 'paid': newly added private fields stay private.
    players: (Array.isArray(data.players) ? data.players : []).filter(Boolean).map(p => pick(p, ['id', 'name', 'level', 'games', 'regular', 'checkedIn'])),
    court1: court(data.court1), court2: court(data.court2),
    currentMatch: { courts: (Array.isArray(data.currentMatch?.courts) ? data.currentMatch.courts : []).map(court) },
    roundNumbers: Array.isArray(data.roundNumbers) ? data.roundNumbers : [1, 1],
    callUp: Object.fromEntries(Object.entries(data.callUp || {}).map(([key, value]) => [key, pick(value, ['kind', 'ids', 'court', 'time'])])),
    eventIntegration: data.eventIntegration ? pick(data.eventIntegration, ['eventTime']) : null,
  };
}
module.exports = { publicSchedule };
