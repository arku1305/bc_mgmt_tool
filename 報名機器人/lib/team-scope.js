const { createHash } = require('node:crypto');
function ownTeam(user, legacyUids = []) {
  return legacyUids[0] === user.uid ? 'primary' : 'team-' + createHash('sha256').update(user.uid).digest('hex').slice(0, 32);
}
function paths(teamId) {
  if (teamId === 'primary') return { registration: 'registrationV1', ranking: 'rankingV1' };
  if (!/^team-[a-f0-9]{32}$/.test(teamId)) throw new Error('球團識別不正確');
  return { registration: `teamsV1/${teamId}/registration`, ranking: `teamsV1/${teamId}/ranking` };
}
module.exports = { ownTeam, paths };
