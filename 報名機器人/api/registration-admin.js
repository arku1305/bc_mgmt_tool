const { requireModule } = require('../lib/access');
const { db } = require('./_lib');
const { managerAuth } = require('../lib/manager-auth');
const { digest, mutate, adminView } = require('../lib/registration');
const { paths } = require('../lib/team-scope');
const { accessService, shareToken } = require('../lib/access-service');
const { randomUUID } = require('node:crypto');
module.exports = async (req, res) => {
  const user = await managerAuth(req, res, { db });
  if (!user) return;

  try {
    if (await accessService(req, res, db, user)) return;
    if (req.query?.scope === 'accounting') return await require('../lib/accounting-service').service(req,res,db,user);
    if (req.query?.scope === 'line') {
      if (process.env.REGISTRATION_V2 !== 'true' || process.env.LINE_INTEGRATION_V2 !== 'true') return res.status(503).json({message:'LINE 新版串接尚未啟用'});
      return await require('../lib/line-integration').service(req,res,db,user);
    }
    if (!requireModule(user, 'registration', res)) return;
    if (req.query?.scope === 'clubs') {
      if (process.env.REGISTRATION_V2 !== 'true') return res.status(503).json({ message: '新版球團管理尚未啟用' });
      return await require('../lib/club-service').service(req, res, db, user);
    }
    if (!['GET', 'POST'].includes(req.method)) return res.status(405).end();
    const ref = db.ref(paths(user.teamId).registration);
    const publicToken = await shareToken(db, user.teamId);
    if (req.method === 'GET') return res.json({ ...adminView((await ref.once('value')).val() || {}), publicToken });
    if (typeof req.body?.expectedRevision !== 'string') return res.status(400).json({ message: '請先讀取目前資料再操作' });
    await ref.once('value'); // Prime transaction cache; Firebase may initially call back with null.
    const context = { uid: user.uid, now: Date.now(), eventId: 'event-' + randomUUID() };
    let validation;
    const result = await ref.transaction(value => {
      validation = null;
      if (digest(value || {}) !== req.body.expectedRevision) return;
      try { return mutate(value, req.body, context); }
      catch (error) { validation = error.message; return; }
    });
    if (!result.committed) return res.status(validation ? 422 : 409).json({ message: validation || '名單或設定已更新，請讀取最新資料後再操作' });
    return res.json({ ...adminView(result.snapshot.val()), publicToken });
  } catch (_) { return res.status(500).json({ message: '儲存失敗，請重新整理確認最新資料' }); }
};
