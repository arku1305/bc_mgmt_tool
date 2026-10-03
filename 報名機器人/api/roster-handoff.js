const { requireModule } = require('../lib/access');
const { managerAuth } = require('../lib/manager-auth');
const { paths } = require('../lib/team-scope');
const { db, fixedOf, LINE_GROUP_ID } = require('./_lib');
const { digest, draftRoster } = require('./_handoff');
const { randomUUID } = require('node:crypto');

module.exports = async (req, res) => {
  const user = await managerAuth(req, res, { db });
  if (!user) return;
  if (!requireModule(user, 'registration', res) || !requireModule(user, 'ranking', res)) return;
  if (!['GET', 'POST'].includes(req.method)) return res.status(405).end();
  try {
    if (req.query?.club) {
      if (process.env.REGISTRATION_V2 !== 'true') return res.status(503).json({ message: '新版活動交接尚未啟用' });
      return await require('../lib/club-handoff').handoff(req,res,db,user);
    }
    const teamId = user.teamId;
    const ref = db.ref(paths(teamId).registration + '/current');
    const session = (await ref.once('value')).val() || {};
    let draft;
    try { draft = draftRoster(session, fixedOf(session), teamId); }
    catch (error) { return res.status(409).json({ message: error.message }); }
    if (req.method === 'GET') return res.json(draft);
    if (req.body?.fingerprint !== draft.fingerprint) {
      return res.status(409).json({ message: '報名名單已更新，請重新預覽並確認' });
    }

    const candidateId = 'event-' + randomUUID();
    const confirmedAt = Date.now();
    // Transaction only adds integration metadata, retaining all current signup fields.
    const result = await ref.transaction(current => {
      if (!current) return;
      let latest;
      try { latest = draftRoster(current, fixedOf(current), teamId); } catch (_) { return; }
      if (latest.fingerprint !== draft.fingerprint) return;
      const previous = current.rosterHandoff;
      const eventId = current.activityId || (previous?.eventTime === current.eventTime ? previous.eventId : candidateId);
      return { ...current, rosterHandoff: {
        eventId, eventTime: current.eventTime, fingerprint: draft.fingerprint,
        confirmedAt, confirmedBy: user.uid,
      } };
    });
    if (!result.committed) return res.status(409).json({ message: '報名名單已更新，請重新預覽並確認' });
    const metadata = result.snapshot.val().rosterHandoff;
    const packet = {
      schemaVersion: 1, event: { ...draft.event, eventId: metadata.eventId },
      roster: draft.roster, revision: draft.fingerprint, confirmedAt,
    };
    // Archive each explicitly confirmed version; no scheduling data is changed here.
    await db.ref(`rosterHandoffs/${teamId}/${metadata.eventId}/${draft.fingerprint}`).set(packet);
    return res.json(packet);
  } catch (_) {
    return res.status(500).json({ message: '名單交接失敗，請稍後重試；排點尚未變更' });
  }
};
