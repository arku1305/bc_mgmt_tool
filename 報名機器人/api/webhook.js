// api/webhook.js — LINE Bot 接收群組訊息
const line = require('@line/bot-sdk');
const {
  lineClient, LINE_GROUP_ID,
  getWalkIns, getSession, pushRosterToGroup, buildRosterMessage,
  findByName, findFirstEmpty, findFixedMemberByInput,
  getEffectiveMaxSlots, recordAbsence, db, MAX_WALK_IN_SLOTS,
} = require('./_lib');

function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const handler = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();

  const rawBody = await getRawBody(req);
  const signature = req.headers['x-line-signature'];
  const secret = process.env.LINE_CHANNEL_SECRET;

  if (!line.validateSignature(rawBody, secret, signature)) {
    console.error('[webhook] 簽名驗證失敗');
    return res.status(401).send('Invalid signature');
  }

  let body;
  try {
    body = JSON.parse(rawBody);
  } catch (e) {
    console.error('[webhook] JSON 解析失敗', e);
    return res.status(200).end();
  }

  // 先處理事件，再回應 LINE（Vercel 在回應後會終止函式）
  const events = body.events || [];
  console.log('[webhook] events:', events.length, '| LINE_GROUP_ID:', LINE_GROUP_ID);
  for (const event of events) {
    console.log('[webhook] event type:', event.type, '| groupId:', event.source?.groupId);
    if (event.type !== 'message' || event.message.type !== 'text') continue;
    if (!event.source.groupId || event.source.groupId !== LINE_GROUP_ID) continue;

    const text = event.message.text.trim();
    await handleGroupMessage(text, event.replyToken);
  }

  res.status(200).end();
};

handler.config = {
  api: {
    bodyParser: false,
  },
};

module.exports = handler;

async function handleGroupMessage(text, replyToken) {
  // 統一全形符號轉半形
  const normalized = text.replace(/＋/g, '+').replace(/－/g, '-');
  console.log('[message] text:', JSON.stringify(normalized));

  const joinMatch = normalized.match(/^(.+?)\s*參戰$/);
  const cancelLeaveMatch = normalized.match(/^取消請假\s*(.+)$/);
  const signupMatch = normalized.match(/^\+(\d+)\s*(.+)$/) || normalized.match(/^(.+?)\s*\+(\d+)$/);
  const cancelMatch = normalized.match(/^-(\d+)\s*(.+)$/) || normalized.match(/^取消(\d*)\s*(.+)$/) || normalized.match(/^(.+?)\s*-(\d+)$/);

  if (normalized === '名單' || normalized === '查名單' || normalized === '報名名單') {
    await handleShowRoster(replyToken);
  } else if (cancelLeaveMatch) {
    const name = cancelLeaveMatch[1].trim();
    await handleCancelLeave(name, replyToken);
  } else if (joinMatch) {
    const name = joinMatch[1].trim();
    await handleGroupSignup(name, 1, replyToken);
  } else if (signupMatch) {
    const isFront = normalized.match(/^\+(\d+)\s*(.+)$/);
    const count = isFront ? parseInt(isFront[1]) : parseInt(signupMatch[2]);
    const name  = isFront ? isFront[2].trim()   : signupMatch[1].trim();
    await handleGroupSignup(name, count, replyToken);
  } else if (cancelMatch) {
    // 解析取消數量和名字
    const isFront = normalized.match(/^-(\d+)\s*(.+)$/);
    const isTakeCancel = normalized.match(/^取消(\d*)\s*(.+)$/);
    let cancelCount, cancelName;
    if (isFront) {
      cancelCount = parseInt(isFront[1]);
      cancelName = isFront[2].trim();
    } else if (isTakeCancel) {
      cancelCount = parseInt(isTakeCancel[1]) || 1;
      cancelName = isTakeCancel[2].trim();
    } else {
      cancelCount = parseInt(cancelMatch[2]) || 1;
      cancelName = cancelMatch[1].trim();
    }
    await handleGroupCancel(cancelName, cancelCount, replyToken);
  } else {
    console.log('[message] 未匹配任何指令');
  }
}

async function handleShowRoster(replyToken) {
  try {
    const session = await getSession();
    const effectiveMaxSlots = getEffectiveMaxSlots(session);
    const walkIns = await getWalkIns(effectiveMaxSlots);
    const rosterText = buildRosterMessage(walkIns, session);
    await lineClient.replyMessage(replyToken, { type: 'text', text: rosterText });
  } catch (e) {
    console.error('查名單錯誤', e);
  }
}

async function handleGroupSignup(name, count, replyToken) {
  console.log('[signup] 開始處理:', name, 'x', count);
  try {
    const session = await getSession();
    const effectiveMaxSlots = getEffectiveMaxSlots(session);
    const [walkIns] = await Promise.all([getWalkIns(effectiveMaxSlots)]);

    // 計算剩餘空位
    const remaining = walkIns.filter(v => !v || !v.name).length;
    if (remaining === 0) {
      await lineClient.replyMessage(replyToken, { type: 'text', text: `❌ 名額已滿，${name} 無法報名。` });
      return;
    }

    const actualCount = Math.min(count, remaining); // 不超過剩餘空位
    const writes = [];
    let filled = 0;

    for (let i = 0; i < effectiveMaxSlots && filled < actualCount; i++) {
      if (!walkIns[i] || !walkIns[i].name) {
        const entry = { name, source: 'line', time: Date.now() };
        walkIns[i] = entry;
        writes.push(db.ref(`session/walkIns/${i}`).set(entry));
        filled++;
      }
    }

    await Promise.all(writes);

    const msg = actualCount < count
      ? `✅ ${name} 報名成功 ${actualCount} 個名額（僅剩 ${actualCount} 位）`
      : `✅ ${name} 報名成功${count > 1 ? ` ${count} 個名額` : ''}！`;

    const rosterText = buildRosterMessage(walkIns, session);
    await lineClient.replyMessage(replyToken, [
      { type: 'text', text: msg },
      { type: 'text', text: rosterText },
    ]);
  } catch (e) {
    console.error('[signup] 錯誤:', e.message, e.code);
  }
}

async function handleCancelLeave(name, replyToken) {
  try {
    const session = await getSession();
    const fixedMember = findFixedMemberByInput(name);

    if (!fixedMember) {
      await lineClient.replyMessage(replyToken, { type: 'text', text: `⚠️ 找不到季繳成員「${name}」。` });
      return;
    }

    const cancelledFixed = session.cancelledFixed || [];
    if (!cancelledFixed.includes(fixedMember)) {
      await lineClient.replyMessage(replyToken, { type: 'text', text: `⚠️ ${fixedMember} 目前不在請假名單中。` });
      return;
    }

    // 從請假名單移除
    const newCancelled = cancelledFixed.filter(m => m !== fixedMember);
    const oldEffectiveSlots = MAX_WALK_IN_SLOTS + cancelledFixed.length;
    const newEffectiveSlots = MAX_WALK_IN_SLOTS + newCancelled.length;

    // 取得目前臨打名單
    const walkIns = await getWalkIns(oldEffectiveSlots);

    // 如果該成員被重複加入臨打區，移除他
    for (let i = 0; i < walkIns.length; i++) {
      if (!walkIns[i]) continue;
      if (findFixedMemberByInput(walkIns[i].name) === fixedMember) {
        walkIns[i] = null;
      }
    }

    // 整理臨打名單（補齊空洞）
    const filled = walkIns.filter(v => v && v.name);
    const newList = [...filled, ...Array(newEffectiveSlots - filled.length).fill(null)];

    // 刪除對應本次活動的請假記錄（比對 eventTime 找正確那筆）
    const historySnap = await db.ref(`absenceHistory/${fixedMember}`).once('value');
    const historyData = historySnap.val() || {};
    const matchingKey = Object.entries(historyData).find(([, v]) => v === session.eventTime)?.[0];

    // 更新 Firebase
    const updates = { 'session/cancelledFixed': newCancelled.length > 0 ? newCancelled : null };
    for (let i = 0; i < Math.max(oldEffectiveSlots, newEffectiveSlots); i++) {
      updates[`session/walkIns/${i}`] = newList[i] || null;
    }

    const dbOps = [db.ref().update(updates)];
    if (matchingKey) dbOps.push(db.ref(`absenceHistory/${fixedMember}/${matchingKey}`).remove());

    await Promise.all(dbOps);

    session.cancelledFixed = newCancelled;
    const rosterText = buildRosterMessage(newList, session);
    await lineClient.replyMessage(replyToken, [
      { type: 'text', text: `✅ ${fixedMember} 取消請假，已恢復季繳身份。` },
      { type: 'text', text: rosterText },
    ]);
  } catch (e) {
    console.error('取消請假錯誤', e);
  }
}

async function handleGroupCancel(name, count, replyToken) {
  try {
    const session = await getSession();

    // 檢查是否為季繳成員請假
    const fixedMember = findFixedMemberByInput(name);
    if (fixedMember) {
      const cancelledFixed = session.cancelledFixed || [];
      if (cancelledFixed.includes(fixedMember)) {
        await lineClient.replyMessage(replyToken, { type: 'text', text: `⚠️ ${fixedMember} 已經在請假名單中了。` });
        return;
      }
      const newCancelled = [...cancelledFixed, fixedMember];
      const effectiveMaxSlots = MAX_WALK_IN_SLOTS + newCancelled.length;
      const walkIns = await getWalkIns(effectiveMaxSlots);
      await Promise.all([
        db.ref('session/cancelledFixed').set(newCancelled),
        recordAbsence(fixedMember, session.eventTime),
      ]);
      session.cancelledFixed = newCancelled;
      const leaveRosterText = buildRosterMessage(walkIns, session);
      await lineClient.replyMessage(replyToken, [
        { type: 'text', text: `✅ ${fixedMember} 請假成功，臨打名額增加為 ${effectiveMaxSlots} 個。` },
        { type: 'text', text: leaveRosterText },
      ]);
      return;
    }

    // 臨打成員取消
    const effectiveMaxSlots = getEffectiveMaxSlots(session);
    const walkIns = await getWalkIns(effectiveMaxSlots);

    // 找出所有同名記錄
    const allIdx = walkIns.reduce((acc, v, i) => {
      if (v && v.name === name) acc.push(i);
      return acc;
    }, []);

    if (allIdx.length === 0) {
      await lineClient.replyMessage(replyToken, { type: 'text', text: `⚠️ 找不到 ${name} 的報名紀錄。` });
      return;
    }

    // 取消指定數量（不超過實際筆數）
    const removeCount = Math.min(count, allIdx.length);
    for (let i = 0; i < removeCount; i++) walkIns[allIdx[i]] = null;

    const filled = walkIns.filter(v => v && v.name);
    const newList = [...filled, ...Array(effectiveMaxSlots - filled.length).fill(null)];

    const updates = {};
    for (let i = 0; i < effectiveMaxSlots; i++) {
      updates[`session/walkIns/${i}`] = newList[i] || null;
    }
    const msg = removeCount < count
      ? `✅ ${name} 已取消 ${removeCount} 個名額（原本只有 ${allIdx.length} 筆）`
      : `✅ ${name} 已取消 ${removeCount} 個名額。`;
    const cancelRosterText = buildRosterMessage(newList, session);
    await Promise.all([
      db.ref().update(updates),
      lineClient.replyMessage(replyToken, [
        { type: 'text', text: msg },
        { type: 'text', text: cancelRosterText },
      ]),
    ]);
  } catch (e) {
    console.error('群組取消錯誤', e);
  }
}
