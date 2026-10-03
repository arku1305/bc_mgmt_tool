const { db } = require('./_lib');
const { publicPaths } = require('../lib/access-service');
const { publicActivity, entriesOf, remainingOf, slotsOf } = require('../lib/registration');
module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).end();
  try {
    const scope = await publicPaths(db, req.query?.team, req.query?.event);
    if (scope?.activities) return res.json({ eventId: null, registrationOpen: false, activities: scope.activities, eventTime: '請選擇活動', remaining: 0 });
    const session = scope ? (await db.ref(scope.registration + (scope.directSession ? '' : '/current')).once('value')).val() || {} : {};
    if (req.query?.event && req.query.event !== session.activityId) return res.json({ eventId: null, registrationOpen: false, stale: true, eventTime: '這場活動已結束或換場', remaining: 0 });
    return res.json({ ...publicActivity(session), ...(scope?.registrationAllowed===false?{registrationOpen:false}:{}), maxSlots: slotsOf(session), taken: entriesOf(session).length, remaining: Math.max(0, remainingOf(session)) });
  } catch (_) { return res.status(500).json({ error: '讀取失敗' }); }
};
