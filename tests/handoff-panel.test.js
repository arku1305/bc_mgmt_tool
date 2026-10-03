const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const babelPath = process.env.BABEL_BUNDLE;

// Component handler tests with a lightweight hook host; not a browser/layout test.
function fixture(writeStatus = 200) {
  const { babelTransform } = require(babelPath);
  const code = babelTransform(fs.readFileSync(path.join(__dirname, '../ranking/handoff-panel.jsx'), 'utf8'), 'handoff-panel.jsx', false, [], []).code;
  const state = [], effects = []; let cursor = 0, rendered = false;
  let applied = null, closed = false; const calls = [];
  const event = { eventId: 'event-test', teamId: 'team-test', eventTime: '10/6' };
  const roster = [{ name: '測試甲', registrationId: 'guest-a', participantType: 'guest' }];
  const draft = { event, roster, fingerprint: 'revision' };
  const packet = { schemaVersion: 1, event, roster, revision: 'revision' };
  const ranking = { players: [], court1: { team1: [], team2: [] }, currentMatch: { courts: [] }, messages: { keep: true } };
  const jsx = (type, props) => ({ type, props: props || {} });
  const context = {
    React: {
      useState(initial) { const i = cursor++; if (!(i in state)) state[i] = initial; return [state[i], value => { state[i] = value; }]; },
      useEffect(effect) { if (!rendered) effects.push(effect); },
    },
    require() { return { jsx, jsxs: jsx, Fragment: 'fragment' }; },
    window: { RosterHandoff: require('../ranking/handoff'), ROSTER_API_URL: 'https://signup.test' },
    firebase: { auth: () => ({ currentUser: { getIdToken: async () => 'fake-token' } }) },
    FIREBASE_URL: 'https://ranking.test/badminton',
    async fetch(url, options = {}) {
      calls.push({ url, options });
      const status = options.method === 'PUT' ? writeStatus : 200;
      return { ok: status === 200, status, headers: { get: () => 'test-etag' },
        json: async () => url.includes('roster-handoff') ? (options.method === 'POST' ? packet : draft) : ranking };
    },
  };
  vm.runInNewContext(code, context);
  const props = { onApplied(players, binding) { applied = { players, binding }; }, onClose() { closed = true; } };
  function render() { cursor = 0; const tree = context.ActivityHandoffPanel(props); rendered = true; return tree; }
  function flatten(node) {
    if (node == null || typeof node === 'boolean') return [];
    if (Array.isArray(node)) return node.flatMap(flatten);
    if (typeof node !== 'object') return [node];
    return [node, ...flatten(node.props.children)];
  }
  function text(node) { return flatten(node).filter(n => typeof n === 'string' || typeof n === 'number').join(''); }
  async function click(label) {
    const target = flatten(render()).find(n => n.type === 'button' && text(n) === label);
    assert.ok(target, 'button exists: ' + label); await target.props.onClick();
  }
  return {
    async start() { render(); effects.forEach(effect => effect()); await new Promise(resolve => setImmediate(resolve)); },
    click, text: () => text(render()), calls,
    get applied() { return applied; }, get closed() { return closed; },
  };
}

test('交接畫面：確認、選擇、條件寫入保留其他資料，成功後才關閉', { skip: !babelPath && '需要 BABEL_BUNDLE 指向 Babel 測試工具' }, async () => {
  const ui = fixture(); await ui.start();
  await ui.click('確認名單並預覽匯入差異');
  assert.match(ui.text(), /新增：測試甲/);
  assert.equal(ui.calls.filter(c => c.options.method === 'PUT').length, 0);
  await ui.click('套用選取的變更');
  assert.equal(ui.applied.players.length, 1); assert.equal(ui.closed, true);
  const write = ui.calls.find(c => c.options.method === 'PUT');
  assert.equal(write.options.headers['If-Match'], 'test-etag');
  const saved = JSON.parse(write.options.body);
  assert.deepEqual(saved.messages, { keep: true });
  assert.equal(saved.players[0].checkedIn, false); assert.equal(saved.eventIntegration.eventId, 'event-test');
});
test('交接畫面：排點版本衝突或拒絕寫入，不顯示成功、不關閉', { skip: !babelPath && '需要 BABEL_BUNDLE 指向 Babel 測試工具' }, async () => {
  for (const status of [412, 403]) {
    const ui = fixture(status); await ui.start();
    await ui.click('確認名單並預覽匯入差異'); await ui.click('套用選取的變更');
    assert.equal(ui.applied, null); assert.equal(ui.closed, false);
    assert.match(ui.text(), status === 412 ? /排點資料已被調整/ : /匯入未成功/);
  }
});
