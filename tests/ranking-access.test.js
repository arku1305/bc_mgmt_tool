const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { publicSchedule } = require('../報名機器人/api/_ranking');

test('公開排點不含繳費、私人訊息、報名識別或未來新增的私人欄位', () => {
  const privateData = { players: [{ id: 'a', name: '虛構甲', level: 6, games: 2, regular: true, checkedIn: true, paid: true, phone: 'private-phone', seasonPass: true, registrationId: 'private-id', futurePrivateField: 'private-secret', wantPartner: ['private-person'] }], messages: { a: 'private-message' }, history: { a: 'private-history' }, eventIntegration: { eventTime: '10/6', teamId: 'private-team', revision: 'private-revision' }, currentMatch: { courts: [{ team1: ['a'], team2: [] }] }, court1: { team1: ['a'], team2: [] }, callUp: { 0: { kind: 'go', ids: ['a'], court: 0, time: 1, privateNote: 'private-note' } } };
  const result = publicSchedule(privateData);
  assert.equal(JSON.stringify(result).includes('private-'), false);
  assert.equal(Object.hasOwn(result.players[0], 'paid'), false);
  assert.equal(Object.hasOwn(result.players[0], 'seasonPass'), false);
  assert.deepEqual(result.currentMatch.courts[0].team1, ['a']);
  assert.equal(result.players[0].checkedIn, true);
  assert.equal(result.eventIntegration.eventTime, '10/6');
  assert.equal(privateData.players[0].paid, true);
});

test('尚無資料的獨立排點區仍能公開查看空場地', () => {
  assert.deepEqual(publicSchedule(null).players, []);
  assert.deepEqual(publicSchedule(null).court1, { team1: [], team2: [] });
});

function viewApi(envOverrides = {}) {
  const env = { RANKING_ORIGIN: 'https://ranking.example', RANKING_AUTH_PROJECT_ID: 'badminton-scheduler-8a849', FIREBASE_DATABASE_URL: 'https://badminton-scheduler-8a849-default-rtdb.asia-southeast1.firebasedatabase.app', ...envOverrides };
  const paths = [];
  const context = { module: { exports: {} }, process: { env }, require(name) {
    if (name === './_lib') return { db: { ref(path) { paths.push(path); return { async once() { return { val: () => ({ players: [{ id: 'a', name: '虛構甲', paid: true }] }) }; } }; } } };
    if (name === './_ranking') return { publicSchedule };
    throw new Error('Unexpected module');
  } };
  vm.runInNewContext(fs.readFileSync('報名機器人/api/ranking-view.js', 'utf8'), context);
  return { paths, async call(method = 'GET', origin = env.RANKING_ORIGIN) {
    const result = { status: 200, headers: {} };
    const res = { setHeader(k, v) { result.headers[k] = v; }, status(n) { result.status = n; return this; }, json(data) { result.body = data; return this; }, end() {} };
    await context.module.exports({ method, headers: { origin } }, res);
    return result;
  } };
}

test('公開 API 只讀新版資料區，不容許任何寫入或錯誤資料庫設定', async () => {
  const api = viewApi();
  assert.equal((await api.call('PUT')).status, 405);
  assert.equal((await api.call('GET', 'https://other.example')).status, 403);
  assert.deepEqual(api.paths, []);
  const result = await api.call();
  assert.equal(result.status, 200);
  assert.equal(result.body.players[0].paid, undefined);
  assert.deepEqual(api.paths, ['rankingV1']);
  const wrong = viewApi({ FIREBASE_DATABASE_URL: 'https://provider.example' });
  assert.equal((await wrong.call()).status, 503);
  assert.deepEqual(wrong.paths, []);
});

test('球友瀏覽器不讀私有 Firebase，登入過團長帳號也不能透過球友模式寫入', async () => {
  const source = fs.readFileSync('ranking/main.js', 'utf8');
  const start = source.indexOf('var FIREBASE_URL');
  const end = source.indexOf('function loadData', start);
  const calls = [];
  const context = { URLSearchParams, window: { location: { search: '?player' }, __AUTH_TOKEN__: 'fake-admin-token' }, fetch: async (url, options) => { calls.push({ url, options }); return { ok: true, json: async () => publicSchedule({ players: [{ id: 'a', name: '虛構甲', paid: true }] }) }; } };
  vm.runInNewContext(source.slice(start, end), context);
  assert.equal(await context.fbPut('/players', [{ id: 'evil' }]), false);
  const players = await context.fbGet('/players');
  assert.equal(players[0].paid, undefined);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/api\/ranking-view$/);
  assert.equal(calls[0].url.includes('auth='), false);
});
