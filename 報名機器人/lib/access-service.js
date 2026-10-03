const admin = require('firebase-admin');
const { randomUUID } = require('node:crypto');
const { addOrganizer, normalizeEmail, emailKey, modulePermissions, requireModule, changeOrganizer } = require('./access');
const { paths } = require('./team-scope');
const { digest } = require('./registration');
async function shareToken(db, teamId) {
  const ref = db.ref(`teamSharesV1/${teamId}`);
  await ref.once('value');
  const result = await ref.transaction(value => value || { token: randomUUID() });
  const token = result.snapshot.val().token;
  await db.ref(`publicTeamsV1/${token}`).set(teamId);
  return token;
}
async function publicPaths(db, token, eventId) {
  if (typeof token !== 'string' || !/^[a-f0-9-]{36}$/.test(token)) return null;
  const id = (await db.ref(`publicTeamsV1/${token}`).once('value')).val();
  if (id?.model === 2) {
    if (process.env.REGISTRATION_V2 !== 'true') return null;
    return require('./club-service').publicScope(db, id, eventId);
  }
  return id ? paths(id) : null;
}
async function directory(db) {
  const registry = (await db.ref('accessV1').once('value')).val() || {};
  const people = Object.values(registry.organizers || {}).filter(p => !p.removedAt).map(p => ({ email: p.email, enabled: p.enabled, modules: modulePermissions(p) }));
  const legacy = (process.env.ROSTER_MANAGER_UIDS || '').split(',').map(s => s.trim()).filter(Boolean);
  for (const uid of legacy) {
    const user = await admin.auth().getUser(uid);
    if (user.email && !registry.organizers?.[emailKey(user.email)]) people.push({ email: user.email.toLowerCase(), enabled: true, modules: modulePermissions(null) });
  }
  return { organizers: people.sort((a, b) => a.email.localeCompare(b.email)) };
}
async function accessService(req, res, db, user) {
  const scope = req.query?.scope;
  if (scope === 'access') {
    if (req.method !== 'GET') { res.status(405).end(); return true; }
    res.json({ role: user.role, modules: user.modules || modulePermissions(null), publicToken: await shareToken(db, user.teamId) }); return true;
  }
  if (scope === 'permissions') {
    if (user.role !== 'platformAdmin') { res.status(403).json({ message: '只有平台 Admin 能管理團長權限' }); return true; }
    if (req.method === 'POST') {
      let email;
      try { email = normalizeEmail(req.body?.email); } catch (err) { res.status(422).json({ message: err.message }); return true; }
      const admins = (process.env.PLATFORM_ADMIN_EMAILS || '').split(',').map(s => s.trim().toLowerCase());
      const action = req.body?.action || 'add';
      const listed = (await directory(db)).organizers.some(p => p.email === email);
      if (admins.includes(email) || (action === 'add' && listed)) { res.status(422).json({ message: '這個 Email 已具有 Admin 或團長權限' }); return true; }
      const ref = db.ref('accessV1'); await ref.once('value');
      let message;
      const result = await ref.transaction(state => {
        message = null;
        try { return action === 'add' ? addOrganizer(state || {}, user, email, Date.now()) : changeOrganizer(state || {}, user, email, action, req.body.module, req.body.enabled, Date.now(), listed); }
        catch (err) { message = err.message; return; }
      });
      if (!result.committed) { res.status(422).json({ message: message || '新增失敗' }); return true; }
    } else if (req.method !== 'GET') { res.status(405).end(); return true; }
    res.json(await directory(db)); return true;
  }
  if (scope === 'ranking') {
    if (!requireModule(user, 'ranking', res)) return true;
    if (!['GET', 'PUT'].includes(req.method)) { res.status(405).end(); return true; }
    const path = req.query?.path || '';
    if (typeof path !== 'string' || !/^(\/([A-Za-z0-9_-]+))*$/.test(path) || path.startsWith('/activityArchives')) { res.status(400).json({ message: '不支援的資料路徑' }); return true; }
    let root = paths(user.teamId).ranking;
    if (req.query?.club) {
      if (process.env.REGISTRATION_V2 !== 'true') { res.status(503).json({ message: '新版活動排點尚未啟用' }); return true; }
      const club = await require('./club-service').ownedClub(db,user,req.query.club);
      if (!club || !Object.hasOwn(club.events || {},req.query.event)) { res.status(403).json({message:'無法管理此球團或活動排點'}); return true; }
      root = 'eventSchedulesV2/' + club.clubId + '/' + req.query.event;
    }
    const ref = db.ref(root + path);
    const value = (await ref.once('value')).val();
    if (req.method === 'GET') { res.setHeader('ETag', '"' + digest(value) + '"'); res.setHeader('Access-Control-Expose-Headers', 'ETag'); res.json(value); return true; }
    const expected = req.headers['if-match'];
    if (expected) {
      const result = await ref.transaction(current => expected === '"' + digest(current) + '"' ? req.body : undefined);
      if (!result.committed) { res.status(412).json({ message: '排點資料已更新' }); return true; }
    } else await ref.set(req.body);
    res.json(req.body); return true;
  }
  return false;
}
module.exports = { accessService, shareToken, publicPaths };
