const { assertOpen, addGuest, leaveFixed, restoreFixed, removeGuest, fixedMatch } = require('./registration');
function parseCommand(text) {
  const s = text.trim().replace(/＋/g, '+').replace(/－/g, '-');
  if (['名單', '查名單', '報名名單'].includes(s)) return { action: 'roster' };
  let m;
  if ((m = s.match(/^取消請假\s*(.+)$/))) return { action: 'restore', name: m[1].trim() };
  if ((m = s.match(/^(.+?)\s*參戰$/))) return { action: 'signup', name: m[1].trim(), count: 1 };
  if ((m = s.match(/^\+(\d+)\s*(.+)$/))) return { action: 'signup', name: m[2].trim(), count: +m[1] };
  if ((m = s.match(/^(.+?)\s*\+(\d+)$/))) return { action: 'signup', name: m[1].trim(), count: +m[2] };
  if ((m = s.match(/^-(\d+)\s*(.+)$/))) return { action: 'cancel', name: m[2].trim(), count: +m[1] };
  if ((m = s.match(/^取消(\d*)\s*(.+)$/))) return { action: 'cancel', name: m[2].trim(), count: m[1] ? +m[1] : 1 };
  if ((m = s.match(/^(.+?)\s*-(\d+)$/))) return { action: 'cancel', name: m[1].trim(), count: +m[2] };
  return null;
}
function applyLine(session, command, now) {
  if (!session?.activityId) throw new Error('尚未開團，請等團長建立活動');
  const next = JSON.parse(JSON.stringify(session));
  if (command.count != null && (!Number.isInteger(command.count) || command.count < 1 || command.count > 20)) throw new Error('人數須為 1 到 20');
  const member = fixedMatch(next, command.name);
  let result;
  if (command.action === 'signup') { assertOpen(next,undefined,now); result = addGuest(next, command, { now, source: 'line' }); }
  else if (command.action === 'restore') { assertOpen(next,undefined,now); result = restoreFixed(next, member); }
  else if (command.action === 'cancel') {
    if (member) { leaveFixed(next, member, now); result = { leave: true }; }
    else result = removeGuest(next, { ...command, allowGroup: true });
  } else throw new Error('不支援的指令');
  return { session: next, result };
}
module.exports = { parseCommand, applyLine };
