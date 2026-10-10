const core = require('./registration');
const clone = value => JSON.parse(JSON.stringify(value || {}));
function extras(input) {
  const courtCount = Number(input.courtCount ?? 2);
  if (!Number.isInteger(courtCount) || courtCount < 1 || courtCount > 20) throw new Error('場地數須為 1 到 20');
  const string = (value, limit) => {
    if (typeof value !== 'string' || value.length > limit || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) throw new Error('用球或補充文字格式不正確');
    return value.trim();
  };
  return { courtCount, shuttlecock: string(input.shuttlecock || '', 100), message: string(input.message || '', 600) };
}
function stamp(session) {
  Object.values(session.walkIns || {}).forEach(person => {
    person.registrationId ||= 'guest-' + core.digest([session.activityId, person.name, person.source, person.time]).slice(0, 24);
  });
  return session;
}
function buildEvent(club, input, context) {
  const fields = { ...club.defaults, ...input, name: club.name, intervalWeeks: 1 };
  const team = core.teamFields(fields);
  const startsAt = Date.parse(team.eventDate + 'T' + team.startTime + ':00+08:00');
  if (startsAt <= context.now) throw new Error('活動開始時間已經過去，請選擇未來的日期與時間。');
  const session = core.mutate({}, { action: 'setupTeam', fields }, context).current;
  return { ...session, ...extras(fields), clubId: club.clubId, frequency: team.recurrence.frequency, leadDays: team.recurrence.leadDays };
}
function apply(club, command, context) {
  const next = expire(clone(club),context.now);
  if (command.action === 'createClub') {
    if (club) throw new Error('球團已存在');
    const defaults = core.teamFields({ ...command.fields, intervalWeeks: 1 });
    const created = { schemaVersion: 2, clubId: context.clubId, ownerUid: context.uid, name: defaults.name,
      defaults: { ...defaults, ...extras(command.fields), frequency: defaults.recurrence.frequency, intervalWeeks: 1, leadDays: defaults.recurrence.leadDays }, events: {}, series: {}, createdAt: context.now };
    return addEvent(created, command.fields, context);
  }
  if (!club || club.deletedAt || club.ownerUid !== context.uid) throw new Error('無法管理此球團');
  if (command.action === 'deleteClub') {
    next.deletedAt = context.now; next.deletedBy = context.uid;
    Object.values(next.series || {}).forEach(series => { series.enabled = false; });
    Object.values(next.events || {}).forEach(event => { event.registrationOpen = false; });
    return next;
  }
  if (command.action === 'createEvent') return addEvent(next, command.fields || {}, context);
  if (command.action === 'setSeries') {
    if (!next.series?.[command.seriesId] || typeof command.enabled !== 'boolean') throw new Error('找不到週期系列');
    next.series[command.seriesId].enabled = command.enabled;
    return next;
  }
  const session = next.events?.[command.eventId];
  if (command.action==='setOpen' && command.open && session && require('./activity-time').ended(session,context.now)) throw new Error('活動已結束，不能重新開放報名');
  if (!session) throw new Error('找不到活動，請重新選擇');
  if(command.action==='setOpen'&&command.open&&session.recurrenceId&&Object.values(next.events).some(e=>e.activityId!==session.activityId&&e.recurrenceId===session.recurrenceId&&require('./activity-time').available(next,e,context.now)))throw new Error('此每週系列已有可報名活動');
  if (command.action === 'edit') {
    const fields = { ...session, date: session.eventDate, ...command.fields };
    const state = core.mutate({ team: next.defaults, current: session }, { action: 'edit', fields }, context);
    const fees = core.teamFields({ ...fields, name: next.name, fixedMembers: session.fixedMembers, frequency: 'once' });
    next.events[command.eventId] = { ...state.current, ...extras(fields), guestFee: fees.guestFee, fixedFee: fees.fixedFee };
  } else {
    const state = core.mutate({ team: next.defaults, current: session }, command, context);
    next.events[command.eventId] = stamp(state.current);
  }
  return next;
}
function addEvent(club, fields, context) {
  const event = buildEvent(club, fields, context);
  if (event.frequency === 'weekly') {
    const seriesId = fields.seriesId || context.eventId;
    if (!/^event-[a-f0-9-]{1,80}$/.test(seriesId)) throw new Error('週期系列識別不正確');
    const series = club.series[seriesId];
    if (series && Object.values(club.events).some(e=>e.recurrenceId===seriesId && require('./activity-time').open(e,context.now))) throw new Error('此每週系列已有可報名活動，請等本場結束');
    if (series && Object.values(club.events).some(e => e.recurrenceId === seriesId && e.eventDate === event.eventDate)) throw new Error('此週期日期已有活動');
    const untilDate = series?.untilDate || fields.untilDate;
    if (!series || untilDate) {
      if (typeof untilDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(untilDate) || !Number.isFinite(Date.parse(untilDate)) || new Date(untilDate).toISOString().slice(0,10) !== untilDate) throw new Error('請填寫有效的迄日');
      if (untilDate < event.eventDate) throw new Error('迄日不能早於活動日期');
    }
    event.recurrenceId = seriesId;
    club.series[seriesId] ||= { anchorDate: event.eventDate, untilDate, latestEventId: event.activityId, intervalWeeks: 1, leadDays: event.leadDays, startTime: event.startTime, endTime: event.endTime, enabled: true };
  }
  club.events[event.activityId] = event;
  return club;
}
function advance(club, now) {
  const next = expire(clone(club),now); let count = 0;
  if (!next || next.deletedAt) return { club: next, created: 0 };
  for (const [seriesId, series] of Object.entries(next.series || {})) {
    if (!series.enabled) continue;
    if (Object.values(next.events||{}).some(e=>e.recurrenceId===seriesId && require('./activity-time').open(e,now))) continue;
    const current = next.events[series.latestEventId];
    if (!current) continue;
    const team = { ...next.defaults, eventDate: series.anchorDate, startTime: series.startTime, endTime: series.endTime,
      recurrence: { frequency: 'weekly', intervalWeeks: series.intervalWeeks, leadDays: series.leadDays } };
    const candidate = core.autoAdvance({ team, current }, now, 'placeholder');
    if (!candidate) continue;
    const date = candidate.current.eventDate;
    if (series.untilDate && date > series.untilDate) continue;
    const existing = Object.values(next.events).find(e => e.recurrenceId === seriesId && e.eventDate === date);
    if (existing) { series.latestEventId = existing.activityId; continue; }
    const eventId = 'event-' + core.digest([next.clubId, seriesId, date]).slice(0, 32);
    next.events[eventId] = { ...candidate.current, ...extras(next.defaults), activityId: eventId, clubId: next.clubId,
      frequency: 'weekly', recurrenceId: seriesId, leadDays: series.leadDays };
    series.latestEventId = eventId; count++;
  }
  return { club: next, created: count };
}
function expire(club,now){if(club)for(const event of Object.values(club.events||{})){if(require('./activity-time').ended(event,now))event.registrationOpen=false;}return club;}
function leaveCount(club, session, name) {
  const series = club.series?.[session.recurrenceId];
  return Object.values(club.events || {}).filter(e =>
    (session.recurrenceId ? e.recurrenceId === session.recurrenceId : e.activityId === session.activityId) &&
    (!series || (e.eventDate >= series.anchorDate && (!series.untilDate || e.eventDate <= series.untilDate))) &&
    core.fixedOf(e).includes(name) && (e.cancelledFixed || []).includes(name)
  ).length;
}
module.exports = { apply, advance, stamp, expire, leaveCount };
