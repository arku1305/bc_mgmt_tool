const crypto = require('node:crypto');

function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

// Only the fields required for scheduling cross the module boundary.
function draftRoster(session, fixedMembers, teamId) {
  if (!session.eventTime || session.eventTime === '待定') throw new Error('尚未建立本次報名活動');
  const cancelled = session.cancelledFixed || [];
  const roster = fixedMembers.filter(name => !cancelled.includes(name)).map(name => ({
    registrationId: 'fixed-' + digest(name).slice(0, 24), name, participantType: 'fixed',
  }));
  const entries = Object.values(session.walkIns || {}).filter(entry => entry && entry.name);
  entries.forEach(entry => {
    roster.push({
      registrationId: entry.registrationId || 'guest-' + digest([entry.name, entry.source, entry.time]).slice(0, 24),
      name: entry.name.trim(), participantType: fixedMembers.includes(entry.name.trim()) ? 'fixed' : 'guest',
    });
  });
  const names = new Set();
  roster.forEach(person => {
    if (!person.name || names.has(person.name)) throw new Error('報名名單有相同姓名，請先整理後再確認');
    names.add(person.name);
  });
  roster.sort((a, b) => a.registrationId.localeCompare(b.registrationId));
  const event = { teamId, eventTime: session.eventTime, ...(session.activityId ? { eventId: session.activityId, teamName: session.teamName, location: session.location, guestFee: session.guestFee, fixedFee: session.fixedFee } : {}) };
  return { event, roster, fingerprint: digest({ event, roster }) };
}

module.exports = { digest, draftRoster };
