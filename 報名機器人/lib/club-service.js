const { randomUUID } = require('node:crypto');
const core = require('./registration');
const cachedTransaction = require('./cached-transaction');
const model = require('./club-model');
const { render } = require('./line-message-renderer');
const validClub = id => typeof id === 'string' && /^club-[a-f0-9-]{36}$/.test(id);
async function ownedClub(db, user, id) {
  if (!validClub(id)) return null;
  const club = (await db.ref('clubsV2/' + id).once('value')).val();
  return club?.ownerUid === user.uid && !club.deletedAt ? club : null;
}
function view(club, eventId) {
  const events = Object.values(club.events || {}).sort((a,b) => b.eventDate.localeCompare(a.eventDate));
  const stored = Object.hasOwn(club.events||{},eventId) ? club.events[eventId] : null;
  const session = stored ? {...stored,registrationOpen:require('./activity-time').available(club,stored)} : null;
  return { clubId: club.clubId, revision: core.digest(club), name: club.name, publicToken: club.publicToken,
    events: events.map(e => ({ ...core.publicActivity({...e,registrationOpen:require('./activity-time').available(club,e)}), date: e.eventDate, frequency: e.frequency })),
    series: Object.entries(club.series || {}).map(([id,s]) => ({ id, ...s })),
    defaults: club.defaults, selectedEventId: session?.activityId || '',
    ...(session ? { ...core.adminView({ team: club.defaults, current: session }), revision: core.digest(club),
      activity: { ...core.publicActivity(session), date: session.eventDate, startTime: session.startTime, endTime: session.endTime,
        waiting:!require('./activity-time').current(club,stored), fixedFee: session.fixedFee, courtCount: session.courtCount, shuttlecock: session.shuttlecock, message: session.message, frequency: session.frequency, recurrenceId: session.recurrenceId || null }, announcement: render(session) } : {}) };
}
async function service(req, res, db, user) {
  if (!['GET','POST'].includes(req.method)) return res.status(405).end();
  if (req.method === 'POST' && (!req.body || typeof req.body.action !== 'string')) return res.status(400).json({ message: '請指定操作' });
  if (req.method === 'GET' && !req.query.club) {
    const index = (await db.ref('userClubsV2/' + user.uid).once('value')).val() || {};
    const clubs = [];
    for (const id of Object.keys(index)) { const club = await ownedClub(db,user,id); if (club) clubs.push({ clubId:id,name:club.name }); }
    return res.json({ clubs });
  }
  const create = req.method === 'POST' && req.body?.action === 'createClub';
  const id = create ? 'club-' + randomUUID() : req.query.club;
  const club = create ? null : await ownedClub(db,user,id);
  if (!create && !club) return res.status(403).json({message:'無法管理此球團'});
  if (req.method === 'GET') return res.json(view(club,req.query.event));
  const ref = db.ref('clubsV2/' + id);
  const context = { uid:user.uid, clubId:id,eventId:'event-' + randomUUID(),now:Date.now(),publicToken:randomUUID() };
  let error;
  const result = await cachedTransaction(ref, value => {
    error = null;
    if (!create && (value?.ownerUid !== user.uid || value.deletedAt || core.digest(value) !== req.body.expectedRevision)) return;
    try {
      if (req.body.action === 'previewAdvance') {
        if (process.env.ISOLATED_CLUB_PREVIEW !== 'true' || !Number.isFinite(req.body.now)) throw new Error('模擬排程僅限本機測試');
        return model.advance(value,req.body.now).club;
      }
      const next = model.apply(value,req.body,context); if (create) next.publicToken = context.publicToken; return next;
    }
    catch (err) { error=err.message; return; }
  });
  if (!result.committed) return res.status(error ? 422 : 409).json({message:error || '本次操作未完成：活動名單已被其他操作變更，請重新載入後再試。'});
  const saved = result.snapshot.val();
  if (req.body.action === 'deleteClub') return res.json({ deleted: true, clubId: id });
  if (create) {
    await db.ref('userClubsV2/' + user.uid + '/' + id).set(true);
    await db.ref('publicTeamsV1/' + saved.publicToken).set({ model:2,clubId:id });
  }
  return res.json(view(saved, ['createClub','createEvent'].includes(req.body.action) ? context.eventId : req.body.eventId));
}
async function publicScope(db, value, eventId, seriesId) {
  if (!validClub(value.clubId)) return null;
  const club = (await db.ref('clubsV2/' + value.clubId).once('value')).val();
  if (!club || club.deletedAt) return null;
  if (seriesId) {
    if (typeof seriesId !== 'string' || !Object.hasOwn(club.series || {}, seriesId)) return null;
    const time = require('./activity-time');
    const current = Object.values(club.events || {}).find(e => e.recurrenceId === seriesId && !time.ended(e) && time.current(club,e));
    if (!current || (eventId && eventId !== current.activityId)) return { model:2, pendingSeries:true, registrationAllowed:false };
    eventId = current.activityId;
  }
  if (!eventId) return { model:2, clubId:club.clubId, activities:Object.values(club.events || {}).filter(e=>!require('./activity-time').ended(e)).map(e=>core.publicActivity({...e,registrationOpen:require('./activity-time').available(club,e)})) };
  if (!Object.hasOwn(club.events || {}, eventId)) return null;
  return { model:2, registrationAllowed:require('./activity-time').available(club,club.events[eventId]), registration:'clubsV2/' + club.clubId + '/events/' + eventId, ranking:'eventSchedulesV2/' + club.clubId + '/' + eventId, directSession:true };
}
module.exports = { service, ownedClub, publicScope, view };
