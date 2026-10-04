const cachedTransaction = require('../lib/cached-transaction');
const { db } = require('./_lib');
const { publicPaths } = require('../lib/access-service');
const { publicCommand } = require('../lib/public-command');
module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).end();
  try {
    let message;
    const now = Date.now();
    const scope = await publicPaths(db, req.body?.team, req.body?.eventId);
    if (!scope) return res.status(400).json({ success: false, message: '請使用團長提供的球團報名連結' });
    if (!scope.registration) return res.status(400).json({ success: false, message: '請先選擇活動' });
    const ref = db.ref(scope.registration + (scope.directSession ? '' : '/current'));
    await ref.once('value');
    const result = await cachedTransaction(ref, value => {
      message = null;
      try { return publicCommand(value, 'cancel', req.body || {}, now); }
      catch (error) { message = error.message; return; }
    });
    if (!result.committed) return res.status(409).json({ success: false, message: message || '資料已更新，請重試' });
    return res.json({ success: true });
  } catch (_) { return res.status(500).json({ success: false, message: '暫時無法處理，請重新整理確認名單' }); }
};
