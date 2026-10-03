// api/status.js — 取得目前空位狀態（給網頁用）
const { getSession, getWalkIns, getEffectiveMaxSlots } = require('./_lib');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'GET') return res.status(405).end();

  try {
    const session = await getSession();
    const effectiveMaxSlots = getEffectiveMaxSlots(session);
    const walkIns = await getWalkIns(effectiveMaxSlots);
    const taken = walkIns.filter(v => v && v.name).length;
    res.json({
      eventTime: session.eventTime || '待定',
      maxSlots: effectiveMaxSlots,
      taken,
      remaining: effectiveMaxSlots - taken,
    });
  } catch (e) {
    res.status(500).json({ error: '讀取失敗' });
  }
};
