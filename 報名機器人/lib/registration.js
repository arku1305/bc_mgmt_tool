const { createHash } = require('node:crypto');
const digest = value => createHash('sha256').update(JSON.stringify(value || {})).digest('hex');
const clone = value => JSON.parse(JSON.stringify(value || {}));
function text(value, label, limit) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > limit || /[\u0000-\u001f]/.test(value)) throw new Error(label + '格式不正確');
  return value.trim();
}
function integer(value, min, max, label) { if (!Number.isInteger(value) || value < min || value > max) throw new Error(label + '須為 ' + min + ' 到 ' + max + ' 的整數'); return value; }
function money(value, label) { if (value == null || value === '') return null; if (!Number.isFinite(value) || value < 0 || value > 100000 || Math.abs(Math.round(value * 100) - value * 100) > 1e-7) throw new Error(label + '須為非負金額，最多兩位小數'); return value; }
const entriesOf = session => Object.values(session?.walkIns || {}).filter(p => p && p.name);
const fixedOf = session => Array.isArray(session?.fixedMembers) ? session.fixedMembers : [];
const activeFixed = session => fixedOf(session).filter(name => !(session.cancelledFixed || []).includes(name));
const remainingOf = session => (session?.totalCapacity || 0) - activeFixed(session).length - entriesOf(session).length;
const slotsOf = session => Math.max(0, (session?.totalCapacity || 0) - activeFixed(session).length);
function activityFields(input, fixedCount) {
  const date = text(input.date, '活動日期', 10);
  const parsed = new Date(date + 'T00:00:00Z');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) throw new Error('請輸入有效活動日期');
  const time = value => { if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) throw new Error('活動時間格式不正確'); return value; };
  const start = time(input.startTime), end = time(input.endTime);
  if (end <= start) throw new Error('結束時間須晚於開始時間；目前支援同一天活動');
  const capacity = integer(input.totalCapacity, Math.max(1, fixedCount), 200, '總名額');
  const location = text(input.location, '場地', 120);
  const day = ['日', '一', '二', '三', '四', '五', '六'][parsed.getUTCDay()];
  return { eventDate: date, startTime: start, endTime: end, location, totalCapacity: capacity, eventTime: `${date}(${day}) ${start}–${end}` };
}
function teamFields(input) {
  const fixed = (Array.isArray(input.fixedMembers) ? input.fixedMembers : []).map(name => text(name, '固定球友姓名', 40));
  if (fixed.length > 200 || new Set(fixed).size !== fixed.length) throw new Error('固定球友名單有重複姓名或人數過多');
  const fields = activityFields(input, fixed.length);
  if (!['once', 'weekly'].includes(input.frequency)) throw new Error('請選擇單次活動或固定頻率');
  return { name: text(input.name, '球團名稱', 60), fixedMembers: fixed, ...fields,
    guestFee: money(input.guestFee, '臨打費用'), fixedFee: money(input.fixedFee, '固定球友每次活動費用'),
    recurrence: { frequency: input.frequency, intervalWeeks: input.frequency === 'weekly' ? integer(input.intervalWeeks, 1, 12, '間隔週數') : 1,
      leadDays: input.frequency === 'weekly' ? integer(input.leadDays, 0, 28, '提前開放天數') : 0 } };
}
function newActivity(team, fields, eventId, now) {
  return { ...fields, activityId: eventId, teamName: team.name, guestFee: team.guestFee, fixedFee: team.fixedFee, fixedMembers: team.fixedMembers,
    registrationOpen: true, walkIns: {}, cancelledFixed: [], createdAt: now };
}
function archiveCurrent(state, now) {
  if (!state.current?.activityId) return;
  state.archives = state.archives || {};
  state.archives[state.current.activityId] = { ...state.current, archivedAt: now, registrationOpen: false };
}
function ensureCurrent(state) { if (!state.team || !state.current?.activityId) throw new Error('請先建立球團與活動'); return state.current; }
function fixedMatch(session, name) { return fixedOf(session).find(member => member === name || member.includes('(' + name + ')')); }
function assertOpen(session, eventId, now=Date.now()) {
  if (!session?.activityId) throw new Error('尚未開放活動，請聯絡團長');
  if (eventId && eventId !== session.activityId) throw new Error('這場活動已結束或換場，請使用團長提供的新連結');
  if (session.clubId && require('./activity-time').ended(session,now)) throw new Error('活動時段已結束，已停止報名');
  if (session.registrationOpen === false) throw new Error('目前暫停報名');
}
function addGuest(session, input, context) {
  const name = text(input.name, '姓名', 40);
  const count = integer(input.count ?? 1, 1, 20, '代報人數');
  const fixed = fixedMatch(session, name);
  if (fixed) {
    if (count !== 1) throw new Error('固定球友請使用本人的請假／恢復指令；代報請填其他球友姓名');
    return restoreFixed(session, fixed);
  }
  const current = entriesOf(session);
  if (input.phone && current.some(p => p.phone === input.phone)) throw new Error('此手機號碼已報名');
  const names = count === 1 ? [name] : Array.from({ length: count }, (_, i) => name + (i + 1));
  const occupied = new Set([...fixedOf(session), ...current.map(p => p.name)]);
  if (names.some(n => occupied.has(n)) || current.some(p => p.groupName === name)) throw new Error('已經有相同姓名報名');
  // The existing LINE flow accepted the available part of a multi-person signup.
  // Keep that behavior, but use separate numbered names for each accepted person.
  const accepted = Math.min(count, Math.max(0, remainingOf(session)));
  if (!accepted) throw new Error('名額已滿，無法報名');
  names.slice(0, accepted).forEach(n => current.push({ name: n, ...(count > 1 ? { groupName: name } : {}), ...(input.phone ? { phone: input.phone } : {}), source: context.source, time: context.now }));
  session.walkIns = Object.fromEntries(current.map((p, i) => [i, p]));
  return { accepted, requested: count };
}
function leaveFixed(session, name, now) {
  if (!fixedOf(session).includes(name)) throw new Error('找不到固定球友');
  if ((session.cancelledFixed || []).includes(name)) throw new Error('這位球友已經請假');
  session.cancelledFixed = [...(session.cancelledFixed || []), name];
  session.leaveRecords = { ...(session.leaveRecords || {}), [digest(name)]: { name, time: now } };
}
function restoreFixed(session, name) {
  if (!fixedOf(session).includes(name)) throw new Error('找不到固定球友');
  if (!(session.cancelledFixed || []).includes(name)) throw new Error('已經有相同姓名報名');
  if (remainingOf(session) <= 0) throw new Error('名額已滿，固定球友也無法恢復參加');
  session.cancelledFixed = session.cancelledFixed.filter(n => n !== name);
  // Keep an audit record; a recovery does not erase leave history or issue a refund.
  if (session.leaveRecords?.[digest(name)]) session.leaveRecords[digest(name)].restored = true;
  return { accepted: 1, requested: 1, restoredFixed: true };
}
function removeGuest(session, input) {
  const current = entriesOf(session);
  const candidates = current.filter(p => (p.name === input.name || (input.allowGroup && p.groupName === input.name)) &&
    (!input.phone || p.phone === input.phone) && (input.time == null || p.time === input.time));
  if (!candidates.length) throw new Error('找不到符合的報名資料，請重新整理名單');
  const selected = candidates.slice(0, input.count ?? 1);
  session.walkIns = Object.fromEntries(current.filter(p => !selected.includes(p)).map((p, i) => [i, p]));
  return { removed: selected.length };
}
function mutate(state, command, context) {
  state = clone(state);
  if (command.action === 'setupTeam') {
    if (state.team) throw new Error('球團已建立，請重新整理');
    const team = teamFields(command.fields);
    state.team = { ...team, createdAt: context.now, createdBy: context.uid };
    state.current = newActivity(team, activityFields(command.fields, team.fixedMembers.length), context.eventId, context.now);
    return state;
  }
  const session = ensureCurrent(state);
  if (command.action === 'create') {
    const fields = activityFields(command.fields, state.team.fixedMembers.length);
    archiveCurrent(state, context.now);
    state.current = newActivity(state.team, fields, context.eventId, context.now);
  } else if (command.action === 'edit') {
    const fields = activityFields(command.fields, fixedOf(session).length);
    if (fields.totalCapacity < activeFixed(session).length + entriesOf(session).length) throw new Error('總名額不能少於目前已參加人數');
    Object.assign(session, fields);
  } else if (command.action === 'setOpen') {
    if (typeof command.open !== 'boolean') throw new Error('報名狀態格式不正確');
    session.registrationOpen = command.open;
  } else if (command.action === 'addGuest') addGuest(session, command, { ...context, source: 'manager' });
  else if (command.action === 'removeGuest') removeGuest(session, command);
  else if (command.action === 'leaveFixed') leaveFixed(session, command.name, context.now);
  else if (command.action === 'restoreFixed') restoreFixed(session, command.name);
  else throw new Error('不支援這個操作');
  return state;
}
function publicActivity(session,now=Date.now()) {
  return { eventId: session?.activityId || null, teamName: session?.teamName || '', eventTime: session?.eventTime || '尚未開團', location: session?.location || '',
    guestFee: session?.guestFee ?? null, totalCapacity: session?.totalCapacity || 0, registrationOpen: !!session?.activityId && session.registrationOpen !== false && (!session?.clubId || !require('./activity-time').ended(session,now)), ended: !!session?.clubId && require('./activity-time').ended(session,now) };
}
function adminView(state) {
  const current = state.current || {};
  const archives = Object.values(state.archives || {}).sort((a, b) => (b.archivedAt || 0) - (a.archivedAt || 0));
  const fixed = state.team?.fixedMembers || [];
  const all = [current, ...archives];
  return { revision: digest(state), team: state.team ? { name: state.team.name, location: state.team.location, guestFee: state.team.guestFee, fixedFee: state.team.fixedFee, fixedMembers: fixed, recurrence: state.team.recurrence, startTime: state.team.startTime, endTime: state.team.endTime, totalCapacity: state.team.totalCapacity } : null,
    activity: { ...publicActivity(current), date: current.eventDate || '', startTime: current.startTime || '', endTime: current.endTime || '' },
    fixed: fixedOf(current).map(name => ({ name, onLeave: (current.cancelledFixed || []).includes(name) })),
    guests: entriesOf(current).map(p => ({ name: p.name, source: p.source, time: p.time })), remaining: Math.max(0, remainingOf(current)),
    absenceStats: fixed.map(name => ({ name, count: all.filter(a => a.leaveRecords?.[digest(name)] && !a.leaveRecords[digest(name)].restored).length })),
    archives: archives.map(a => ({ eventId: a.activityId, eventTime: a.eventTime, location: a.location, fixed: activeFixed(a), guests: entriesOf(a).map(p => ({ name: p.name, source: p.source })) })) };
}
function autoAdvance(state, now, eventId) {
  if (!state.team || state.team.recurrence?.frequency !== 'weekly' || !state.current?.eventDate) return null;
  const end = new Date(state.current.eventDate + 'T' + state.current.endTime + ':00+08:00').getTime();
  if (now < end) return null; // Never replace an activity that has not finished.
  const recurrence = state.team.recurrence;
  if (!Number.isInteger(recurrence.intervalWeeks) || recurrence.intervalWeeks < 1 || recurrence.intervalWeeks > 12) return null;
  const step = recurrence.intervalWeeks * 7 * 86400000;
  const anchor = new Date(state.team.eventDate + 'T00:00:00Z').getTime();
  const currentDay = new Date(state.current.eventDate + 'T00:00:00Z').getTime();
  if (!Number.isFinite(anchor) || !Number.isFinite(currentDay)) return null;
  let next = anchor + Math.max(1, Math.floor((currentDay - anchor) / step) + 1) * step;
  // Skip expired occurrences if the scheduler was unavailable; do not create past events.
  while (new Date(new Date(next).toISOString().slice(0, 10) + 'T' + state.team.endTime + ':00+08:00').getTime() <= now) next += step;
  const date = new Date(next).toISOString().slice(0, 10);
  const opens = new Date(date + 'T09:00:00+08:00').getTime() - recurrence.leadDays * 86400000;
  if (now < opens) return null;
  return mutate(state, { action: 'create', fields: { date, startTime: state.team.startTime, endTime: state.team.endTime, location: state.team.location, totalCapacity: state.team.totalCapacity } }, { now, eventId, uid: 'scheduler' });
}
module.exports = { digest, entriesOf, fixedOf, activeFixed, remainingOf, slotsOf, activityFields, teamFields, mutate, publicActivity, adminView, assertOpen, addGuest, leaveFixed, restoreFixed, removeGuest, fixedMatch, autoAdvance };
