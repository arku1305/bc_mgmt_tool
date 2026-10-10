const { randomUUID, createHash } = require('node:crypto');
const { requireModule } = require('./access');
const { ownedClub } = require('./club-service');
const { paths } = require('./team-scope');
const { fixedOf, digest } = require('./registration');
const { draftRoster } = require('../api/_handoff');
const { ended } = require('./activity-time');
const transaction = require('./cached-transaction');
const model = require('./accounting-model');
const hash = value => createHash('sha256').update(value).digest('hex');
function fail(message, status = 422) { throw Object.assign(new Error(message), { status }); }
async function source(db, user, input) {
  if (!['registration','ranking'].includes(input?.kind)) fail('請選擇匯入來源');
  if (user.modules?.[input.kind] === false) fail('來源模組已停止使用',403);
  let event, club, schedule, roster, key;
  if (input.clubId) {
    club = await ownedClub(db,user,input.clubId);
    if (!club || !Object.hasOwn(club.events || {}, input.eventId)) fail('無法讀取此球團或活動',403);
    event = club.events[input.eventId];
    if (!ended(event)) fail('活動尚未結束，結束後才能匯入帳務');
    key = 'event-' + hash(club.clubId + '/' + input.eventId);
    if (input.kind === 'ranking') schedule = (await db.ref('eventSchedulesV2/' + club.clubId + '/' + input.eventId).once('value')).val();
    else roster = draftRoster(event,fixedOf(event),club.clubId).roster;
  } else {
    if (input.kind !== 'ranking') fail('請選擇球團與活動');
    schedule = (await db.ref(paths(user.teamId).ranking).once('value')).val();
    // Linked schedules must use their actual event, so switching sources cannot duplicate a settlement.
    if (schedule?.eventIntegration?.teamId?.startsWith('club-')) fail('此排點已連結活動，請從活動清單選取原場次');
    model.date(input.date);
    if (input.date > new Date(Date.now()+28800000).toISOString().slice(0,10)) fail('活動日期不能在未來');
    const label = typeof input.label === 'string' ? input.label.trim() : '';
    if (!label || label.length > 100) fail('獨立排點請填寫活動名稱');
    // The same date and label identify one standalone event, even if players are later changed.
    key = 'standalone-' + hash(input.date + '/' + label);
    event = { eventDate: input.date, teamName: label };
  }
  if (input.kind === 'ranking') {
    if (!Array.isArray(schedule?.players) || !schedule.players.length) fail('這場沒有可匯入的排點球員');
    roster = schedule.players.filter(Boolean).map(p => ({ name: p.name, participantType: p.participantType || (p.regular || p.seasonPass ? 'fixed' : 'guest'), paid: p.paid === true }));
  }
  const entries = roster.map(p => ({ name:p.name, type:'income', category:p.participantType === 'fixed' ? '固定預繳' : '臨打費',
    amount:p.participantType === 'fixed' ? 0 : event.guestFee ?? '', include:true,
    note:p.participantType === 'fixed' ? '固定球友：預繳款勿重複入帳' : '', participantType:p.participantType, paid:p.paid === true }));
  return { id:key, title:event.eventDate.slice(5).replace('-', '/') + ' ' + (club?.name || event.teamName || '球團') + '活動', date:event.eventDate,
    entries, fingerprint:digest({key,entries,date:event.eventDate}), source:{kind:input.kind,clubId:club?.clubId || '',eventId:input.eventId || '',date:event.eventDate,label:input.label || ''} };
}
async function service(req,res,db,user) {
  if (!requireModule(user,'accounting',res)) return;
  if (!['GET','POST'].includes(req.method)) return res.status(405).end();
  const ref = db.ref('accountingV1/' + hash(user.uid));
  try {
    if (req.method === 'GET') {
      const state = (await ref.once('value')).val();
      const index = (await db.ref('userClubsV2/' + user.uid).once('value')).val() || {};
      const events = [];
      if (user.modules?.registration !== false || user.modules?.ranking !== false) {
        for (const id of Object.keys(index)) {
          const club = await ownedClub(db,user,id);
          if (club) for (const e of Object.values(club.events || {})) if (ended(e)) events.push({ clubId:id,eventId:e.activityId,label:club.name+' · '+e.eventDate+' '+e.startTime,date:e.eventDate });
        }
      }
      return res.json({...model.view(state),events:events.sort((a,b)=>b.date.localeCompare(a.date))});
    }
    const b = req.body || {};
    if (b.action === 'preview') return res.json(await source(db,user,b.source));
    if (!['import','create','edit','delete'].includes(b.action)) fail('不支援的帳務操作');
    if (b.confirmed !== true) fail('請先確認實際收支明細');
    let context = { id:'manual-'+randomUUID(),now:Date.now(),uid:user.uid };
    if (b.action === 'import') {
      const preview = await source(db,user,b.source);
      if (preview.fingerprint !== b.fingerprint) fail('來源名單或費用已更新，請重新預覽；尚未入帳',409);
      context = {...context,id:preview.id,source:preview.source,aggregate:true};
    }
    if (['edit','delete'].includes(b.action)) {
      if (typeof b.id !== 'string' || !/^(manual|event|standalone)-[a-f0-9-]+$/.test(b.id)) fail('帳目識別不正確');
      context = {...context,id:b.id,edit:true,remove:b.action === 'delete'};
    }
    let error;
    const result = await transaction(ref, state => {
      error = null;
      try { return model.save(state,b,context); } catch(e) { error=e.message; return; }
    });
    if (!result.committed) return res.status(409).json({message:error || '帳務已更新，請重新讀取'});
    return res.json(model.view(result.snapshot.val()));
  } catch(e) { return res.status(e.status || 422).json({message:e.message || '帳務操作失敗'}); }
}
module.exports = { service, source };
