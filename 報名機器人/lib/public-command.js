const { assertOpen, addGuest, removeGuest, fixedMatch } = require('./registration');
function publicCommand(session, action, input, now) {
  if (!session?.activityId || typeof input.eventId !== 'string' || input.eventId !== session.activityId) throw new Error('活動已更新或尚未開團，請重新開啟團長提供的報名連結');
  if (typeof input.name !== 'string' || !input.name.trim() || input.name.trim().length > 40 || typeof input.phone !== 'string' || !/^09\d{8}$/.test(input.phone)) throw new Error('請填寫姓名及有效手機號碼');
  if (session.clubId && require('./activity-time').ended(session,now)) throw new Error('活動時段已結束，請聯絡團長調整名單');
  const next = JSON.parse(JSON.stringify(session));
  const person = { name: input.name.trim(), phone: input.phone };
  const fixed = fixedMatch(next, person.name);
  if (fixed) throw new Error((next.cancelledFixed || []).includes(fixed) ? '固定球友恢復參加請使用 LINE 指令或聯絡團長' : '已經有相同姓名報名；固定球友預設參加，請假請使用 LINE 指令或聯絡團長');
  if (action === 'signup') { assertOpen(next, input.eventId, now); addGuest(next, person, { now, source: 'web' }); }
  else removeGuest(next, person);
  return next;
}
module.exports = { publicCommand };
