const admin = require('firebase-admin');
const { resolveAccess } = require('./access');
const { ownTeam } = require('./team-scope');

// This allowlist is for the existing group's organizer, not platform Admin access.
async function managerAuth(req, res, options = {}) {
  const origin = process.env.RANKING_ORIGIN;
  res.setHeader('Cache-Control', 'no-store');
  if (origin && req.headers.origin === origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, If-Match, X-Firebase-ETag');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  }
  if (req.headers.origin && req.headers.origin !== origin) { res.status(403).json({ message: '此網站未獲授權' }); return null; }
  if (req.method === 'OPTIONS') { res.status(204).end(); return null; }
  const projectId = process.env.RANKING_AUTH_PROJECT_ID;
  const allowed = (process.env.ROSTER_MANAGER_UIDS || '').split(',').map(v => v.trim()).filter(Boolean);
  const adminEmails = (process.env.PLATFORM_ADMIN_EMAILS || '').split(',').map(v => v.trim().toLowerCase()).filter(Boolean);
  if (!origin || !projectId || (!allowed.length && !adminEmails.length)) { res.status(503).json({ message: '團長後台尚未完成授權設定' }); return null; }
  const token = (req.headers.authorization || '').match(/^Bearer (.+)$/)?.[1];
  if (!token) { res.status(401).json({ message: '請先登入團長帳號' }); return null; }
  let app = admin.apps.find(app => app.name === 'registration-manager-auth');
  if (!app) app = admin.initializeApp({ projectId }, 'registration-manager-auth');
  let user;
  try { user = await app.auth().verifyIdToken(token); }
  catch (_) { res.status(401).json({ message: '登入已失效，請重新登入' }); return null; }
  const registry = options.db ? (await options.db.ref('accessV1').once('value')).val() || {} : {};
  const access = resolveAccess(user, registry, { adminEmails, legacyUids: allowed });
  if (!access) { res.status(403).json({ message: '此帳號尚未獲得團長權限' }); return null; }
  return { ...access, teamId: ownTeam(user, allowed) };
}
module.exports = { managerAuth };
