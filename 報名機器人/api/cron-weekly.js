// api/cron-weekly.js — 每週五 20:00 自動執行
// Vercel Cron Jobs 會呼叫這個 API
const {
  db, pushRosterToGroup, getNextTuesdayString,
  MAX_WALK_IN_SLOTS, lineClient, LINE_GROUP_ID, buildRosterMessage,
} = require('./_lib');

// =====================================================
// ⛔ 不開團的日期（格式：M/D，例如 '4/28'）
// =====================================================
const SKIP_DATES = [
  '10/13',
];

module.exports = async (req, res) => {
  // 安全驗證：只允許 Vercel Cron 呼叫
  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const eventTime = getNextTuesdayString();

    // 檢查是否為不開團日期
    const dateOnly = eventTime.replace(/\(.*/, '').trim(); // 取出 'M/D' 部分
    if (SKIP_DATES.includes(dateOnly)) {
      console.log(`⏭️ ${eventTime} 不開團，跳過本週發布`);
      return res.json({ success: true, skipped: true, eventTime });
    }

    // 重置 Firebase（含清除請假記錄）
    await db.ref('session').set({
      eventTime,
      maxSlots: MAX_WALK_IN_SLOTS,
      walkIns: null,
      cancelledFixed: null,
    });

    // 發布空白接龍到群組
    const emptyWalkIns = Array(MAX_WALK_IN_SLOTS).fill(null);
    const session = { eventTime };
    const rosterText = buildRosterMessage(emptyWalkIns, session);
    const announcement = `🔔 本週報名開始囉！\n\n` + rosterText;

    await lineClient.pushMessage(LINE_GROUP_ID, {
      type: 'text',
      text: announcement,
    });

    console.log(`✅ 自動排程完成：${eventTime}`);
    res.json({ success: true, eventTime });
  } catch (e) {
    console.error('❌ 自動排程失敗', e);
    res.status(500).json({ error: e.message });
  }
};
