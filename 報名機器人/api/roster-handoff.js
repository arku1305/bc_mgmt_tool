const admin = require('firebase-admin');
const { db, FIXED_MEMBERS, LINE_GROUP_ID } = require('./_lib');
const { digest, draftRoster } = require('./_handoff');
const { randomUUID } = require('node:crypto');

module.exports = async (req, res) => {
  const origin = process.env.RANKING_ORIGIN;
  if (origin && req.headers.origin === origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  }
  res.setHeader('Cache-Control', 'no-store');
  if (req.headers.origin && req.headers.origin !== origin) return res.status(403).json({ message: '此網站未獲授權串接' });
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (!['GET', 'POST'].includes(req.method)) return res.status(405).end();
  const projectId = process.env.RANKING_AUTH_PROJECT_ID;
  const allowed = (process.env.ROSTER_MANAGER_UIDS || '').split(',').map(id => id.trim()).filter(Boolean);
  if (!projectId || !origin || !allowed.length || !LINE_GROUP_ID) {
    return res.status(503).json({ message: '尚未設定名單串接授權，請完成部署設定' });
  }
  try {
    const token = (req.headers.authorization || '').match(/^Bearer (.+)$/)?.[1];
    if (!token) return res.status(401).json({ message: '請先登入團長帳號' });
    let authApp = admin.apps.find(app => app.name === 'roster-manager-auth');
    if (!authApp) authApp = admin.initializeApp({ projectId }, 'roster-manager-auth');
    let user;
    try { user = await authApp.auth().verifyIdToken(token); }
    catch (_) { return res.status(401).json({ message: '登入已失效，請重新登入' }); }
    if (!allowed.includes(user.uid)) return res.status(403).json({ message: '此帳號沒有名單串接權限' });

    const teamId = 'team-' + digest(LINE_GROUP_ID).slice(0, 24);
    const ref = db.ref('session');
    const session = (await ref.once('value')).val() || {};
    let draft;
    try { draft = draftRoster(session, FIXED_MEMBERS, teamId); }
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
      try { latest = draftRoster(current, FIXED_MEMBERS, teamId); } catch (_) { return; }
      if (latest.fingerprint !== draft.fingerprint) return;
      const previous = current.rosterHandoff;
      const eventId = previous?.eventTime === current.eventTime ? previous.eventId : candidateId;
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
