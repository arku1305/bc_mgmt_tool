const { db } = require('./_lib');
const { autoAdvance } = require('../lib/registration');
const { paths } = require('../lib/team-scope');
const { randomUUID } = require('node:crypto');
module.exports = async (req, res) => {
  if (!process.env.CRON_SECRET || req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) return res.status(401).json({ error: 'Unauthorized' });
  if (req.method !== 'GET') return res.status(405).end();
  try {
    const now = Date.now();
    if (process.env.REGISTRATION_V2 === 'true') {
      const clubs = (await db.ref('clubsV2').once('value')).val() || {};
      let created = 0;
      for (const id of Object.keys(clubs)) {
        const ref = db.ref('clubsV2/' + id); await ref.once('value');
        let count = 0;
        const result = await ref.transaction(value => {
          count = 0;
          if (!value) return;
          const next = require('../lib/club-model').advance(value, now);
          count = next.created;
          return JSON.stringify(next.club) !== JSON.stringify(value) ? next.club : undefined;
        });
        if (result.committed) created += count;
      }
      return res.json({ success: true, created });
    }
    const teams = (await db.ref('teamSharesV1').once('value')).val() || {};
    const ids = new Set(['primary', ...Object.keys(teams)]);
    let created = 0;
    for (const id of ids) {
      const ref = db.ref(paths(id).registration);
      await ref.once('value');
      const eventId = 'event-' + randomUUID();
      const result = await ref.transaction(value => autoAdvance(value || {}, now, eventId) || undefined);
      if (result.committed) created++;
    }
    return res.json({ success: true, created });
  } catch (_) { return res.status(500).json({ error: '排程暫時無法完成' }); }
};
