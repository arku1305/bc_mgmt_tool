// api/signup.js — 網頁報名
const {
  getWalkIns, getSession,
  findFirstEmpty, getEffectiveMaxSlots, db,
} = require('./_lib');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { name, phone } = req.body;
  if (!name || !phone) return res.json({ success: false, message: '請填寫完整資料' });
  if (!/^09\d{8}$/.test(phone)) return res.json({ success: false, message: '手機號碼格式錯誤' });

  try {
    const session = await getSession();
    const effectiveMaxSlots = getEffectiveMaxSlots(session);
    const walkIns = await getWalkIns(effectiveMaxSlots);

    const exists = walkIns.find(v => v && (v.name === name || v.phone === phone));
    if (exists) return res.json({ success: false, message: `${name} 已經報名過了` });

    const slotIndex = findFirstEmpty(walkIns);
    if (slotIndex === -1) return res.json({ success: false, message: '名額已滿' });

    const entry = { name, phone, source: 'web', time: Date.now() };
    await db.ref(`session/walkIns/${slotIndex}`).set(entry);

    res.json({ success: true });
  } catch (e) {
    console.error('網頁報名錯誤', e);
    res.status(500).json({ success: false, message: '伺服器錯誤' });
  }
};
