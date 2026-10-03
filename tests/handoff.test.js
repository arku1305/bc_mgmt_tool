const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const handoff = require('../ranking/handoff');
const { draftRoster } = require('../報名機器人/api/_handoff');
const fixed = ['固定甲'];
const session = { eventTime: '10/6(二) 20-22', walkIns: { 0: { name: '臨打乙', source: 'web', time: 100, phone: 'fake-private-value' } } };
const draft = draftRoster(session, fixed, 'team-test');
const packet = { schemaVersion: 1, event: { ...draft.event, eventId: 'event-test' }, roster: draft.roster, revision: draft.fingerprint };

test('交接資料不含電話，固定身分保留，同名拒絕確認', () => {
  assert.equal(JSON.stringify(draft).includes('fake-private-value'), false);
  assert.equal(draft.roster.find(p => p.name === '固定甲').participantType, 'fixed');
  assert.throws(() => draftRoster({ ...session, walkIns: { 0: { name: '固定甲' } } }, fixed, 'team-test'), /相同姓名/);
});
test('首次匯入不自動報到、繳費或排場，重複匯入不重複新增', () => {
  const players = handoff.apply(packet, [], null, packet.roster.map(p => p.registrationId), [], new Set());
  assert.equal(players.length, 2);
  assert.ok(players.every(p => !p.checkedIn && !p.paid));
  assert.equal(players.find(p => p.participantType === 'fixed').seasonPass, false);
  assert.deepEqual(handoff.diff(packet, players, packet.event).additions, []);
  assert.deepEqual(handoff.apply(packet, players, packet.event, [], [], new Set()), players);
});
test('再次匯入保留人工設定與手動新增；只移除勾選的人', () => {
  const players = handoff.apply(packet, [], null, packet.roster.map(p => p.registrationId), [], new Set());
  players[0].level = 10; players[0].paid = true;
  players.push({ id: 'manual', name: '手動丙', level: 7 });
  const reduced = { ...packet, roster: packet.roster.slice(0, 1) };
  const changes = handoff.diff(reduced, players, packet.event);
  assert.equal(changes.removals.length, 1);
  assert.deepEqual(handoff.apply(reduced, players, packet.event, [], [], new Set()), players);
  const next = handoff.apply(reduced, players, packet.event, [], [changes.removals[0].id], new Set());
  assert.equal(next.length, 2); assert.equal(next[0].level, 10); assert.equal(next[0].paid, true);
  assert.equal(next[1].id, 'manual');
  assert.throws(() => handoff.apply(reduced, players, packet.event, [], [changes.removals[0].id], new Set([changes.removals[0].id])), /仍在場上/);
});
test('同名排點人員須由團長明確對應，保留所有人工設定', () => {
  const person = packet.roster[0];
  const players = [{ id: 'old', name: person.name, level: 9, checkedIn: true, paid: true }];
  const changes = handoff.diff(packet, players, null);
  assert.equal(changes.conflicts.length, 1);
  const unchanged = handoff.apply(packet, players, null, [], [], new Set());
  assert.deepEqual(unchanged, players);
  const linked = handoff.apply(packet, players, null, [], [], new Set(), [person.registrationId]);
  assert.equal(linked.length, 1); assert.equal(linked[0].level, 9); assert.equal(linked[0].paid, true);
  assert.equal(linked[0].registrationId, person.registrationId);
});
test('阻擋跨活動、跨球團匯入', () => {
  assert.throws(() => handoff.diff(packet, [], { ...packet.event, eventId: 'other' }), /另一場/);
  assert.throws(() => handoff.diff(packet, [], { ...packet.event, teamId: 'other' }), /另一場/);
});

function apiFixture(options = {}) {
  let state = structuredClone(session); const archived = {}; let writes = 0;
  const env = { RANKING_ORIGIN: 'https://ranking.example', RANKING_AUTH_PROJECT_ID: 'test-project', ROSTER_MANAGER_UIDS: 'manager', ...options.env };
  const ref = {
    async once() { return { val: () => structuredClone(state) }; },
    async transaction(update) {
      if (options.concurrentChange) state.walkIns[1] = { name: '臨打丁', source: 'line', time: 200 };
      const next = update(structuredClone(state));
      if (!next) return { committed: false };
      state = next; writes++; return { committed: true, snapshot: { val: () => state } };
    },
  };
  const db = { ref(p) { return p === 'session' ? ref : { async set(value) { archived[p] = value; writes++; } }; } };
  const admin = { apps: [], initializeApp() {
    const app = { name: 'roster-manager-auth', auth: () => ({ async verifyIdToken(token) {
      if (token === 'bad') throw new Error('invalid');
      return { uid: token === 'allowed' ? 'manager' : 'outsider' };
    } }) }; admin.apps.push(app); return app;
  } };
  const sandbox = { module: { exports: {} }, process: { env }, require(name) {
    if (name === 'firebase-admin') return admin;
    if (name === './_lib') return { db, FIXED_MEMBERS: fixed, LINE_GROUP_ID: 'fake-group' };
    if (name === './_handoff') return require('../報名機器人/api/_handoff');
    return require(name);
  } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../報名機器人/api/roster-handoff.js'), 'utf8'), sandbox);
  return {
    async call(method = 'GET', token = 'allowed', body, origin = env.RANKING_ORIGIN) {
      const result = { status: 200, headers: {} };
      const res = { setHeader(k, v) { result.headers[k] = v; }, status(n) { result.status = n; return this; }, json(value) { result.body = value; return this; }, end() { return this; } };
      await sandbox.module.exports({ method, body, headers: { ...(token ? { authorization: 'Bearer ' + token } : {}), origin } }, res);
      return result;
    }, get writes() { return writes; }, get state() { return state; }, archived,
  };
}
test('API：未設定、未登入、錯誤登入、未授權及其他網站均拒絕且不寫入', async () => {
  const fixture = apiFixture();
  assert.equal((await fixture.call('GET', '')).status, 401);
  assert.equal((await fixture.call('GET', 'bad')).status, 401);
  assert.equal((await fixture.call('GET', 'outsider')).status, 403);
  assert.equal((await fixture.call('GET', 'allowed', null, 'https://other.example')).status, 403);
  assert.equal(fixture.writes, 0);
  assert.equal((await apiFixture({ env: { ROSTER_MANAGER_UIDS: '' } }).call()).status, 503);
});
test('API：GET 不建立活動，明確確認才建立；重複確認沿用活動 ID', async () => {
  const fixture = apiFixture(); const preview = await fixture.call();
  assert.equal(preview.status, 200); assert.equal(fixture.writes, 0);
  const result = await fixture.call('POST', 'allowed', { fingerprint: preview.body.fingerprint });
  assert.equal(result.status, 200);
  assert.deepEqual(fixture.state.walkIns, session.walkIns);
  assert.equal(JSON.stringify(result.body).includes('fake-private-value'), false);
  const repeated = await fixture.call('POST', 'allowed', { fingerprint: preview.body.fingerprint });
  assert.equal(repeated.body.event.eventId, result.body.event.eventId);
  assert.equal(Object.keys(fixture.archived).length, 1);
});
test('API：過期預覽及交易期間的新報名阻擋確認，不覆蓋名單', async () => {
  const fixture = apiFixture();
  assert.equal((await fixture.call('POST', 'allowed', { fingerprint: 'stale' })).status, 409);
  assert.equal(fixture.writes, 0);
  const racing = apiFixture({ concurrentChange: true }); const preview = await racing.call();
  assert.equal((await racing.call('POST', 'allowed', { fingerprint: preview.body.fingerprint })).status, 409);
  assert.equal(racing.writes, 0); assert.equal(racing.state.walkIns[1].name, '臨打丁');
});
