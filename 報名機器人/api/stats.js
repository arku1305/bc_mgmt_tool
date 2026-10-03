// api/stats.js — 後台：本週名單 + 季繳成員請假統計
const { db, FIXED_MEMBERS, MAX_WALK_IN_SLOTS, getEffectiveMaxSlots, SEASON_START } = require('./_lib');

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).end();

  try {
    const [sessionSnap, historySnap] = await Promise.all([
      db.ref('session').once('value'),
      db.ref('absenceHistory').once('value'),
    ]);

    const session = sessionSnap.val() || {};
    const history = historySnap.val() || {};

    // 本週名單
    const cancelledFixed = session.cancelledFixed || [];
    const activeFixed = FIXED_MEMBERS.filter(m => !cancelledFixed.includes(m));
    const effectiveMaxSlots = getEffectiveMaxSlots(session);
    const walkInsData = session.walkIns || {};
    const walkIns = [];
    for (let i = 0; i < effectiveMaxSlots; i++) walkIns.push(walkInsData[i] || null);
    const webSignups = walkIns.filter(v => v && v.source === 'web');
    const taken = walkIns.filter(v => v && v.name).length;

    // 請假統計（只計算本季 SEASON_START 之後的記錄，舊季記錄保留但不列入）
    const stats = FIXED_MEMBERS.map(member => {
      const records = history[member] || {};
      const dates = Object.entries(records)
        .filter(([dateKey]) => dateKey >= SEASON_START)
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([dateKey, eventTime]) => ({ date: dateKey, eventTime }));
      return { member, count: dates.length, dates };
    });

    const html = `<!DOCTYPE html>
<html lang="zh-TW">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>羽球報名後台</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #0f1117; color: #f0f2f8; font-family: sans-serif; padding: 24px 16px 60px; max-width: 480px; margin: 0 auto; }
  h1 { color: #c8f04a; font-size: 20px; margin-bottom: 4px; }
  h2 { color: #c8f04a; font-size: 15px; margin: 24px 0 10px; letter-spacing: 1px; }
  .subtitle { color: #8890aa; font-size: 12px; margin-bottom: 6px; }
  .updated { color: #8890aa; font-size: 11px; margin-bottom: 20px; }
  .card { background: #1a1d26; border: 1px solid rgba(255,255,255,0.06); border-radius: 12px; padding: 16px 18px; margin-bottom: 10px; }
  .row { display: flex; justify-content: space-between; align-items: center; padding: 5px 0; border-bottom: 1px solid rgba(255,255,255,0.04); font-size: 13px; }
  .row:last-child { border-bottom: none; }
  .num { color: #8890aa; width: 24px; }
  .name { flex: 1; }
  .tag { font-size: 11px; padding: 2px 8px; border-radius: 100px; margin-left: 6px; }
  .tag.web { background: rgba(74,240,200,0.15); color: #4af0c8; }
  .tag.line { background: rgba(200,240,74,0.1); color: #8890aa; }
  .tag.empty { color: #3a3f50; }
  .time { font-size: 11px; color: #8890aa; }
  .summary { display: flex; gap: 12px; margin-bottom: 16px; }
  .stat-box { flex: 1; background: #1a1d26; border-radius: 10px; padding: 12px; text-align: center; }
  .stat-num { font-size: 28px; font-weight: 700; color: #c8f04a; }
  .stat-label { font-size: 11px; color: #8890aa; margin-top: 2px; }
  .stat-num.danger { color: #f04a6a; }
  .member-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
  .member-name { font-size: 14px; font-weight: 700; }
  .badge { font-size: 11px; font-weight: 700; padding: 2px 10px; border-radius: 100px; }
  .badge.has { background: #c8f04a; color: #0f1117; }
  .badge.zero { background: #22263a; color: #8890aa; }
  .dates { list-style: none; }
  .dates li { font-size: 12px; color: #8890aa; padding: 3px 0; }
  .dates li span { color: #c8f04a; margin-right: 6px; }
  .no-rec { font-size: 12px; color: #3a3f50; }
  .absent { color: #f04a6a; font-size: 12px; margin-top: 6px; }
</style>
</head>
<body>
<h1>🏸 羽球報名後台</h1>
<p class="updated">更新時間：${new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })}</p>

<div class="summary">
  <div class="stat-box">
    <div class="stat-num">${taken}</div>
    <div class="stat-label">已報名</div>
  </div>
  <div class="stat-box">
    <div class="stat-num ${effectiveMaxSlots - taken === 0 ? 'danger' : ''}">${effectiveMaxSlots - taken}</div>
    <div class="stat-label">剩餘空位</div>
  </div>
  <div class="stat-box">
    <div class="stat-num">${webSignups.length}</div>
    <div class="stat-label">網頁報名</div>
  </div>
</div>

<h2>📋 本週名單（${session.eventTime || '待定'}）</h2>
<div class="card">
  ${activeFixed.map((name, i) => `
  <div class="row">
    <span class="num">${i + 1}</span>
    <span class="name">${name}</span>
    <span class="tag line">季繳</span>
  </div>`).join('')}
  ${walkIns.map((entry, i) => `
  <div class="row">
    <span class="num">${activeFixed.length + 1 + i}</span>
    <span class="name">${entry ? entry.name : '<span style="color:#3a3f50">（空）</span>'}</span>
    ${entry ? `<span class="tag ${entry.source === 'web' ? 'web' : 'line'}">${entry.source === 'web' ? '🌐 網頁' : 'LINE'}</span>` : ''}
    ${entry && entry.source === 'web' && entry.phone ? `<span class="time">${entry.phone}</span>` : ''}
  </div>`).join('')}
  ${cancelledFixed.length > 0 ? `<p class="absent">請假：${cancelledFixed.join('、')}</p>` : ''}
</div>

<h2>📊 季繳成員請假統計</h2>
${stats.map(s => `
<div class="card">
  <div class="member-header">
    <span class="member-name">${s.member}</span>
    <span class="badge ${s.count > 0 ? 'has' : 'zero'}">請假 ${s.count} 次</span>
  </div>
  ${s.count === 0
    ? '<p class="no-rec">尚無請假記錄</p>'
    : `<ul class="dates">${s.dates.map(d => `<li><span>${d.date}</span>${d.eventTime}</li>`).join('')}</ul>`
  }
</div>`).join('')}
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(200).send(html);
  } catch (e) {
    console.error('stats 錯誤', e);
    res.status(500).json({ error: e.message });
  }
};
