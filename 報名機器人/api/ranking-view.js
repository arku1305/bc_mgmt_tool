const { db } = require('./_lib');
const { publicSchedule } = require('./_ranking');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const origin = process.env.RANKING_ORIGIN;
  if (origin && req.headers.origin === origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  }
  if (req.headers.origin && req.headers.origin !== origin) return res.status(403).json({ message: '此網站未獲授權' });
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).end();
  // This endpoint must never fall back to the legacy public badminton path.
  if (!origin || process.env.RANKING_AUTH_PROJECT_ID !== 'badminton-scheduler-8a849' || !process.env.FIREBASE_DATABASE_URL?.startsWith('https://badminton-scheduler-8a849-default-rtdb.')) {
    return res.status(503).json({ message: '排點查看尚未完成設定' });
  }
  try {
    const data = (await db.ref('rankingV1').once('value')).val();
    return res.json(publicSchedule(data));
  } catch (_) { return res.status(500).json({ message: '排點暫時無法載入，請稍後重試' }); }
};
