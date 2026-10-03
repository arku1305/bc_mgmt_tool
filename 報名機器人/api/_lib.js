const admin = require('firebase-admin');
const line = require('@line/bot-sdk');
const { fixedOf, activeFixed, entriesOf, slotsOf, remainingOf, fixedMatch } = require('../lib/registration');
const LINE_GROUP_ID = process.env.LINE_GROUP_ID;
if (!admin.apps.some(app => app.name === '[DEFAULT]')) {
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_KEY)), databaseURL: process.env.FIREBASE_DATABASE_URL });
}
const db = admin.database();
const lineClient = new line.Client({ channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN, channelSecret: process.env.LINE_CHANNEL_SECRET });
async function getSession() { return (await db.ref('registrationV1/current').once('value')).val() || {}; }
async function getWalkIns() { return entriesOf(await getSession()); }
function buildRosterMessage(walkIns, session = {}) {
  if (!session.activityId) return '尚未開團，請等團長建立活動。';
  let msg = `🏸 ${session.teamName}\n時間：${session.eventTime}\n地點：${session.location}\n臨打費用：${session.guestFee} 元\n${session.registrationOpen === false ? '目前暫停報名' : '報名開放中'}\n\n📋 固定球友\n`;
  activeFixed(session).forEach((name, i) => { msg += `${i + 1}.${name}\n`; });
  msg += '\n🎯 臨打報名\n';
  walkIns.filter(p => p && p.name).forEach((p, i) => { msg += `${i + 1}.${p.name}\n`; });
  msg += `\n剩餘空位：${Math.max(0, remainingOf(session))} 個`;
  return msg;
}
module.exports = { db, lineClient, LINE_GROUP_ID, getSession, getWalkIns, buildRosterMessage,
  getEffectiveMaxSlots: slotsOf, findFixedMemberByInput: (name, session) => fixedMatch(session, name), fixedOf };
