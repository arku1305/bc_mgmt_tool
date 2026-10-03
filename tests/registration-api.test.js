const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const core = require('../報名機器人/lib/registration');
const { randomUUID } = require('node:crypto');
function authFixture() {
  const env = { RANKING_ORIGIN: 'https://ranking.test', RANKING_AUTH_PROJECT_ID: 'owned-project', ROSTER_MANAGER_UIDS: 'allowed-uid' };
  const admin = { apps: [], initializeApp(options, name) { const app = { name, auth: () => ({ verifyIdToken: async token => { if (token === 'expired') throw new Error(); return { uid: token }; } }) }; this.apps.push(app); return app; } };
  const context = { module: { exports: {} }, process: { env }, require: name => name === 'firebase-admin' ? admin : require('../報名機器人/lib/' + name.replace('./', '')) };
  vm.runInNewContext(fs.readFileSync('報名機器人/lib/manager-auth.js', 'utf8'), context);
  return context.module.exports.managerAuth;
}
function response() {
  const result = { status: 200, headers: {} };
  return { result, setHeader(k, v) { result.headers[k] = v; }, status(n) { result.status = n; return this; }, json(body) { result.body = body; return this; }, end() {} };
}
test('團長後台拒絕未登入、過期 Token、其他 UID 或其他網站，只有核准團長可存取', async () => {
  const auth = authFixture();
  for (const [token, origin, status] of [[null, 'https://ranking.test', 401], ['expired', 'https://ranking.test', 401], ['other', 'https://ranking.test', 403], ['allowed-uid', 'https://other.test', 403]]) {
    const res = response(); const user = await auth({ method: 'GET', headers: { origin, ...(token ? { authorization: 'Bearer ' + token } : {}) } }, res);
    assert.equal(user, null); assert.equal(res.result.status, status);
  }
  const res = response(); assert.equal((await auth({ method: 'GET', headers: { authorization: 'Bearer allowed-uid', origin: 'https://ranking.test' } }, res)).uid, 'allowed-uid');
});
function apiFixture() {
  let state = null, writes = 0, race = null;
  const ref = { once: async () => ({ val: () => state }), async transaction(callback) {
    if (race) { state = race(state); race = null; }
    const next = callback(state);
    if (next !== undefined) { state = next; writes++; }
    return { committed: next !== undefined, snapshot: { val: () => state } };
  } };
  const context = { module: { exports: {} }, Date, require(name) {
    if (name === './_lib') return { db: { ref: path => { if (path === 'accessV1') return { once: async () => ({ val: () => null }) }; assert.equal(path, 'registrationV1'); return ref; } } };
    if (name === '../lib/manager-auth') return { managerAuth: async (req, res) => authFixture()(req, res) };
    if (name === '../lib/access') return require('../報名機器人/lib/access');
    if (name === '../lib/team-scope') return require('../報名機器人/lib/team-scope');
    if (name === '../lib/access-service') return { accessService: async () => false, shareToken: async () => 'fake-share' };
    if (name === '../lib/registration') return core;
    if (name === 'node:crypto') return { randomUUID };
    throw new Error(name);
  } };
  vm.runInNewContext(fs.readFileSync('報名機器人/api/registration-admin.js', 'utf8'), context);
  return { get state() { return state; }, get writes() { return writes; }, setRace(fn) { race = fn; }, async call(body, token = 'allowed-uid') {
    const res = response(); await context.module.exports({ method: body ? 'POST' : 'GET', body, headers: token ? { authorization: 'Bearer ' + token } : {} }, res); return res.result;
  } };
}
const fields = { name: '測試團', date: '2026-10-06', startTime: '19:00', endTime: '21:00', location: '虛構場地', totalCapacity: 2, guestFee: 200, fixedFee: 150, fixedMembers: ['固定甲'], frequency: 'once' };
test('後台建立及名單異動保護資料版本，兩個分頁不會覆蓋對方', async () => {
  const api = apiFixture(); const blank = await api.call();
  assert.equal(blank.body.team, null); assert.equal(api.writes, 0);
  const created = await api.call({ action: 'setupTeam', expectedRevision: blank.body.revision, fields });
  assert.equal(created.status, 200);
  const added = await api.call({ action: 'addGuest', name: '臨打乙', expectedRevision: created.body.revision });
  assert.equal(added.status, 200);
  const stale = await api.call({ action: 'leaveFixed', name: '固定甲', expectedRevision: created.body.revision });
  assert.equal(stale.status, 409); assert.equal(api.writes, 2); assert.deepEqual(api.state.current.cancelledFixed, []);
  assert.equal((await api.call({ action: 'addGuest', name: '臨打丙', expectedRevision: added.body.revision })).status, 422);
  assert.equal(api.writes, 2);
});
test('交易期間新的網頁報名使舊後台操作失效；未登入不寫任何資料', async () => {
  const api = apiFixture();
  assert.equal((await api.call({ action: 'setupTeam', expectedRevision: core.digest({}), fields }, null)).status, 401);
  assert.equal(api.writes, 0);
  const created = await api.call({ action: 'setupTeam', expectedRevision: core.digest({}), fields });
  api.setRace(state => core.mutate(state, { action: 'addGuest', name: '交易間乙' }, { now: 102, uid: 'fake', eventId: 'unused' }));
  assert.equal((await api.call({ action: 'setOpen', open: false, expectedRevision: created.body.revision })).status, 409);
  assert.equal(api.state.current.registrationOpen, true); assert.equal(api.state.current.walkIns[0].name, '交易間乙');
});
