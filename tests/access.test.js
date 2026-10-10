const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeEmail, emailKey, resolveAccess, addOrganizer } = require('../報名機器人/lib/access');
const settings = { adminEmails: ['admin@example.test'], legacyUids: ['legacy-organizer'] };
const admin = { uid: 'admin', email: 'admin@example.test', email_verified: true, role: 'platformAdmin' };
test('Admin 僅接受經驗證且指定的 Email，一般團長不能自行升權', () => {
  assert.equal(resolveAccess(admin, {}, settings).role, 'platformAdmin');
  assert.equal(resolveAccess({ ...admin, email_verified: false }, {}, settings), null);
  assert.equal(resolveAccess({ uid: 'legacy-organizer' }, {}, settings).role, 'organizer');
  assert.throws(() => addOrganizer({}, { uid: 'legacy-organizer', role: 'organizer' }, 'leader@example.test', 100), /只有平台 Admin/);
});
test('Email 新增正規化且不重複；首次登入需已驗證且匹配授權 Email', () => {
  const registry = addOrganizer({}, admin, ' Leader@Example.test ', 100);
  assert.equal(registry.organizers[emailKey('leader@example.test')].email, 'leader@example.test');
  assert.throws(() => addOrganizer(registry, admin, 'LEADER@example.test', 101), /已在/);
  assert.throws(() => normalizeEmail('invalid'), /格式/);
  assert.equal(resolveAccess({ uid: 'new', email: 'leader@example.test', email_verified: true }, registry, settings).role, 'organizer');
  assert.equal(resolveAccess({ uid: 'new', email: 'leader@example.test', email_verified: false }, registry, settings), null);
  assert.equal(resolveAccess({ uid: 'new', email: 'other@example.test', email_verified: true }, registry, settings), null);
});

test('Admin 和團長皆只取得自己的資料路径，平台角色不授予他人球團存取', () => {
  const { ownTeam, paths } = require('../報名機器人/lib/team-scope');
  const a = ownTeam({ uid: 'admin', role: 'platformAdmin' });
  const b = ownTeam({ uid: 'leader', role: 'organizer' });
  assert.notEqual(a, b); assert.notEqual(paths(a).registration, paths(b).registration);
  assert.equal(ownTeam({ uid: 'legacy' }, ['legacy']), 'primary');
  assert.notEqual(ownTeam({ uid: 'second-legacy' }, ['first-legacy', 'second-legacy']), 'primary');
  assert.throws(() => paths('../primary'), /識別/);
});

test('模組可獨立停止；移除後舊 UID 不可繞過，重新新增可恢復', () => {
  const { changeOrganizer } = require('../報名機器人/lib/access');
  const user = { uid: 'legacy-organizer', email: 'leader@example.test', email_verified: true };
  let registry = addOrganizer({}, admin, user.email, 100);
  registry = changeOrganizer(registry, admin, user.email, 'setModule', 'registration', false, 101);
  assert.deepEqual(resolveAccess(user, registry, settings).modules, { registration: false, ranking: true, accounting: true });
  registry = changeOrganizer(registry, admin, user.email, 'setModule', 'ranking', false, 102);
  assert.deepEqual(resolveAccess(user, registry, settings).modules, { registration: false, ranking: false, accounting: true });
  assert.deepEqual(resolveAccess(admin, registry, settings).modules, { registration: true, ranking: true, accounting: true });
  registry = changeOrganizer(registry, admin, user.email, 'remove', null, null, 103);
  assert.equal(resolveAccess(user, registry, settings), null);
  registry = addOrganizer(registry, admin, user.email, 104);
  assert.equal(resolveAccess(user, registry, settings).modules.registration, true);
  assert.throws(() => changeOrganizer(registry, {role:'organizer'}, user.email, 'remove', null, null, 105), /只有平台/);
});
