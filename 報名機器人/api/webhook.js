const line = require('@line/bot-sdk');
const { db, lineClient, LINE_GROUP_ID, getSession, buildRosterMessage } = require('./_lib');
const { entriesOf } = require('../lib/registration');
const { parseCommand, applyLine } = require('../lib/line-command');
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
  try {
    const raw = await getRawBody(req);
    if (!line.validateSignature(raw, process.env.LINE_CHANNEL_SECRET, req.headers['x-line-signature'])) return res.status(401).send('Invalid signature');
    const body = JSON.parse(raw);
    for (const event of body.events || []) {
      if (process.env.LINE_INTEGRATION_V2 === 'true' && process.env.REGISTRATION_V2 === 'true') {
        await require('../lib/line-integration').handleEvent(db,event,require('../lib/line-transport').transport(lineClient));
        continue;
      }
      if (event.type !== 'message' || event.message?.type !== 'text' || !LINE_GROUP_ID || event.source?.groupId !== LINE_GROUP_ID) continue;
      const command = parseCommand(event.message.text);
      if (!command) continue;
      let message;
      if (command.action === 'roster') {
        const session = await getSession();
        message = buildRosterMessage(entriesOf(session), session);
      } else {
        let error, outcome;
        const now = Date.now();
        const ref = db.ref('registrationV1/current');
        await ref.once('value');
        const transaction = await ref.transaction(session => {
          error = null; outcome = null;
          try { const applied = applyLine(session, command, now); outcome = applied.result; return applied.session; }
          catch (err) { error = err.message; return; }
        });
        if (!transaction.committed) message = '⚠️ ' + (error || '名單已更新，請重試');
        else {
          const session = transaction.snapshot.val();
          const success = outcome.accepted ? `報名成功 ${outcome.accepted} 位${outcome.accepted < outcome.requested ? '（名額不足，僅接受可用空位）' : ''}` : outcome.leave ? '已登記本次請假' : `已取消 ${outcome.removed} 位`;
          message = `✅ ${success}\n\n` + buildRosterMessage(entriesOf(session), session);
        }
      }
      // Only reply to a user's command; never actively push or broadcast.
      await lineClient.replyMessage(event.replyToken, { type: 'text', text: message });
    }
    return res.status(200).end();
  } catch (_) { return res.status(500).end(); }
};
handler.config = { api: { bodyParser: false } };
module.exports = handler;
