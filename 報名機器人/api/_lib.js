// =====================================================
// 共用工具函式（所有 API 共用）
// =====================================================
const admin = require('firebase-admin');
const line = require('@line/bot-sdk');

// ======================================================
// ⚙️  設定區（填入你的資訊）
// ======================================================
const LINE_GROUP_ID = process.env.LINE_GROUP_ID;

const FIXED_MEMBERS = [
  '團長(小柯)', '副團長(柯柯)', '馬哥', '樺',
  'JJ', '翔豪', '宏',
];
const MAX_WALK_IN_SLOTS = 9;
const FIXED_MEMBER_COUNT = FIXED_MEMBERS.length;

// 本季起始日（YYYY-MM-DD）：後台請假統計只計算這天之後的記錄
// 換季時更新這裡，舊記錄會保留但不列入本季次數
const SEASON_START = '2026-10-01';

// 初始化 Firebase（避免重複初始化）
if (!admin.apps.length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_KEY);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: process.env.FIREBASE_DATABASE_URL,
  });
}
const db = admin.database();

// 初始化 LINE Client
const lineClient = new line.Client({
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
});

// =====================================================
// 工具函式
// =====================================================

// 記錄季繳成員請假歷史
async function recordAbsence(memberName, eventTime) {
  const dateKey = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  await db.ref(`absenceHistory/${memberName}/${dateKey}`).set(eventTime || '未知日期');
}

// 依輸入名字找季繳成員（支援簡稱，如「小柯」→「團長(小柯)」）
function findFixedMemberByInput(input) {
  return FIXED_MEMBERS.find(m =>
    m === input ||
    m.includes(`(${input})`) ||
    m.replace(/.*\(([^)]+)\)/, '$1') === input
  );
}

// 計算有效臨打名額（季繳成員請假時增加空位）
function getEffectiveMaxSlots(session) {
  const cancelled = (session.cancelledFixed || []).length;
  return MAX_WALK_IN_SLOTS + cancelled;
}

async function getWalkIns(maxSlots) {
  const slots = maxSlots || MAX_WALK_IN_SLOTS;
  const snap = await db.ref('session/walkIns').once('value');
  const data = snap.val() || {};
  const list = [];
  for (let i = 0; i < slots; i++) {
    list.push(data[i] || null);
  }
  return list;
}

async function getSession() {
  const snap = await db.ref('session').once('value');
  return snap.val() || {};
}

function buildRosterMessage(walkIns, session = {}) {
  const eventTime = session.eventTime || '待定';
  const cancelledFixed = session.cancelledFixed || [];
  const activeFixed = FIXED_MEMBERS.filter(m => !cancelledFixed.includes(m));
  const effectiveMaxSlots = MAX_WALK_IN_SLOTS + cancelledFixed.length;

  let msg = `🏸 2026Q4(10-12月)每週打球報名接龍\n`;
  msg += `AI排點，線上查詢\n`;
  msg += `時間：${eventTime}\n`;
  msg += `地點：新力羽球南科館第7、8場地\n`;
  msg += `費用：200｜用球：KOMBO No.1 一級天然鵝毛\n`;
  msg += `-----------------------\n`;
  msg += `📋 季繳成員\n`;
  activeFixed.forEach((name, i) => {
    msg += `${i + 1}.${name}\n`;
  });

  msg += `\n🎯 臨打報名\n`;
  const activeFixedCount = activeFixed.length;
  for (let i = 0; i < effectiveMaxSlots; i++) {
    const num = activeFixedCount + 1 + i;
    const entry = walkIns[i];
    if (entry && entry.name) {
      const tag = entry.source === 'web' ? ' 🌐' : '';
      msg += `${num}.${entry.name}${tag}\n`;
    } else {
      msg += `${num}.\n`;
    }
  }

  const taken = walkIns.filter(v => v && v.name).length;
  const remaining = effectiveMaxSlots - taken;
  msg += `\n剩餘空位：${remaining} 個`;
  if (remaining <= 0) msg += `\n❌ 名額已滿`;
  return msg;
}

async function pushRosterToGroup(walkIns, session) {
  const text = buildRosterMessage(walkIns, session);
  await lineClient.pushMessage(LINE_GROUP_ID, { type: 'text', text });
}

function findByName(walkIns, name) {
  return walkIns.findIndex(v => v && v.name === name);
}

function findFirstEmpty(walkIns) {
  return walkIns.findIndex(v => !v || !v.name);
}

function getNextTuesdayString() {
  const now = new Date();
  const twNow = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const day = twNow.getUTCDay();
  const daysUntilTuesday = (2 + 7 - day) % 7 || 7;
  const nextTuesday = new Date(twNow.getTime() + daysUntilTuesday * 24 * 60 * 60 * 1000);
  const month = nextTuesday.getUTCMonth() + 1;
  const date = nextTuesday.getUTCDate();
  return `${month}/${date}(二) 20-22`;
}

module.exports = {
  db, lineClient, LINE_GROUP_ID,
  FIXED_MEMBERS, MAX_WALK_IN_SLOTS, FIXED_MEMBER_COUNT, SEASON_START,
  getWalkIns, getSession, buildRosterMessage, pushRosterToGroup,
  findByName, findFirstEmpty, findFixedMemberByInput, getEffectiveMaxSlots,
  recordAbsence, getNextTuesdayString,
};
