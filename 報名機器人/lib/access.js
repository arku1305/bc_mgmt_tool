const { createHash } = require('node:crypto');
function normalizeEmail(value) {
  if (typeof value !== 'string') throw new Error('請填寫 Email');
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Email 格式不正確');
  return email;
}
const emailKey = email => createHash('sha256').update(normalizeEmail(email)).digest('hex');
function resolveAccess(user, registry, settings) {
  const email = user.email_verified === true && user.email ? normalizeEmail(user.email) : null;
  if (email && settings.adminEmails.includes(email)) return { ...user, role: 'platformAdmin', email, modules: { registration: true, ranking: true } };
  const entry = email && registry?.organizers?.[emailKey(email)];
  if (entry?.enabled === true) return { ...user, role: 'organizer', email, modules: modulePermissions(entry) };
  if (entry) return null;
  if (settings.legacyUids.includes(user.uid)) return { ...user, role: 'organizer', email, modules: { registration: true, ranking: true }, teamId: 'primary' };
  return null;
}
function addOrganizer(registry, actor, email, now) {
  if (actor.role !== 'platformAdmin') throw new Error('只有平台 Admin 能新增團長');
  email = normalizeEmail(email);
  const key = emailKey(email);
  if (registry?.organizers?.[key] && !registry.organizers[key].removedAt) throw new Error('這個 Email 已在團長名單中');
  return { ...(registry || {}), organizers: { ...(registry?.organizers || {}), [key]: { email, enabled: true, modules: { registration: true, ranking: true }, createdAt: now, createdBy: actor.uid } } };
}
function modulePermissions(entry) {
  return { registration: entry?.enabled !== false && entry?.modules?.registration !== false, ranking: entry?.enabled !== false && entry?.modules?.ranking !== false };
}
function requireModule(user, module, res) {
  if (user.role === 'platformAdmin' || user.modules?.[module] !== false) return true;
  res.status(403).json({ message: (module === 'registration' ? '報名管理' : '排點管理') + '已停止使用，請聯絡平台 Admin' });
  return false;
}
function changeOrganizer(registry, actor, email, action, module, enabled, now, legacy = false) {
  if (actor.role !== 'platformAdmin') throw new Error('只有平台 Admin 能管理團長');
  email = normalizeEmail(email);
  const key = emailKey(email), previous = registry?.organizers?.[key];
  if (previous?.removedAt || (!previous && !legacy)) throw new Error('團長已移除或不存在，請重新整理');
  const entry = { ...(previous || { email, enabled: true }), modules: modulePermissions(previous), updatedAt: now, updatedBy: actor.uid };
  if (action === 'remove') { entry.enabled = false; entry.removedAt = now; }
  else if (action === 'setModule' && ['registration', 'ranking'].includes(module) && typeof enabled === 'boolean') { entry.enabled = true; entry.modules[module] = enabled; }
  else throw new Error('不支援的權限操作');
  return { ...(registry || {}), organizers: { ...(registry?.organizers || {}), [key]: entry } };
}
module.exports = { normalizeEmail, emailKey, resolveAccess, addOrganizer, modulePermissions, requireModule, changeOrganizer };
