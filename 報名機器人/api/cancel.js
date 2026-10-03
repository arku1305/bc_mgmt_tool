// api/cancel.js — 網頁取消報名
const {
  getSession, getEffectiveMaxSlots, db,
} = require('./_lib');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { name, phone } = req.body;
  if (!name || !phone) return res.json({ success: false, message: '請填寫完整資料' });

  try {
    const session = await getSession();
    const effectiveMaxSlots = getEffectiveMaxSlots(session);
    const raw = session.walkIns || {};

    // 涵蓋所有實際存在的索引（避免季繳請假時擴增的空位漏讀或殘留）
    const existingCount = Object.keys(raw).length;
    const totalSlots = Math.max(effectiveMaxSlots, existingCount);
    const walkIns = [];
    for (let i = 0; i < totalSlots; i++) walkIns.push(raw[i] || null);

    const idx = walkIns.findIndex(v => v && v.name === name && v.phone === phone);
    if (idx === -1) return res.json({ success: false, message: '姓名或電話不符，請確認報名時填寫的資料' });

    walkIns[idx] = null;
    const filled = walkIns.filter(v => v && v.name);

    // 重新壓縮名單，清掉所有舊索引避免殘留
    const updates = {};
    for (let i = 0; i < totalSlots; i++) {
      updates[`session/walkIns/${i}`] = filled[i] || null;
    }
    await db.ref().update(updates);

    res.json({ success: true });
  } catch (e) {
    console.error('取消報名錯誤', e);
    res.status(500).json({ success: false, message: '伺服器錯誤' });
  }
};
