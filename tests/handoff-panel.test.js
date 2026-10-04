const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const babelPath = process.env.BABEL_BUNDLE;

// Component handler tests with a lightweight hook host; not a browser/layout test.
function fixture(writeStatus = 200, oldEvent = false) {
  const { babelTransform } = require(babelPath);
  const code = babelTransform(fs.readFileSync(path.join(__dirname, '../ranking/handoff-panel.jsx'), 'utf8'), 'handoff-panel.jsx', false, [], []).code;
  const state = [], effects = []; let cursor = 0, rendered = false;
  let applied = null, closed = false; const calls = [];
  const event = { eventId: 'event-test', teamId: 'team-test', eventTime: '10/6' };
  const roster = [{ name: '測試甲', registrationId: 'guest-a', participantType: 'guest' }];
  const draft = { event, roster, fingerprint: 'revision' };
  const packet = { schemaVersion: 1, event, roster, revision: 'revision' };
  const ranking = { ...(oldEvent ? { eventIntegration: { eventId: 'old-event', teamId: 'team-test', eventTime: '前一場' }, players: [{ id: 'old-manual', name: '舊手動球友', paid: true, level: 9 }] } : { players: [] }), court1: { team1: [], team2: [] }, currentMatch: { courts: [] }, messages: { keep: true } };
  const jsx = (type, props) => ({ type, props: props || {} });
  const context = {
    React: {
      useState(initial) { const i = cursor++; if (!(i in state)) state[i] = initial; return [state[i], value => { state[i] = value; }]; },
      useEffect(effect) { if (!rendered) effects.push(effect); },
    },
    require() { return { jsx, jsxs: jsx, Fragment: 'fragment' }; },
    window: { RosterHandoff: require('../ranking/handoff'), ROSTER_API_URL: 'https://signup.test' },
    firebase: { auth: () => ({ currentUser: { getIdToken: async () => 'fake-token' } }) },
    Date,
    rankingUrl: () => 'https://ranking.test/api/registration-admin?scope=ranking',
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

test('覆蓋前再確認；取消不寫入，確認後重建名單與場次並保留存檔',{skip:!babelPath},async()=>{
 const ui=fixture(200,true);await ui.start();await ui.click('確認名單並匯入');
 assert.match(ui.text(),/確認覆蓋排點名單/);assert.equal(ui.calls.filter(c=>c.options.method==='POST'||c.options.method==='PUT').length,0);
 await ui.click('返回');assert.equal(ui.closed,false);await ui.click('確認名單並匯入');await ui.click('確認覆蓋並匯入');
 assert.equal(ui.closed,true);assert.equal(ui.applied.players.length,1);
 const write=ui.calls.find(c=>c.options.method==='PUT'),saved=JSON.parse(write.options.body);
 assert.equal(write.options.headers['If-Match'],'test-etag');assert.equal(saved.players[0].name,'測試甲');assert.equal(saved.players[0].paid,false);assert.equal(saved.players[0].checkedIn,false);
 assert.equal(saved.players.some(p=>p.id==='old-manual'),false);assert.deepEqual(saved.roundNumbers,[1,1]);
 assert.equal(Object.values(saved.activityArchives)[0].players[0].paid,true);assert.deepEqual(saved.messages,{keep:true});
});
test('排點版本衝突或權限拒絕不覆蓋、不關閉',{skip:!babelPath},async()=>{
 for(const status of [412,403]){const ui=fixture(status);await ui.start();await ui.click('確認名單並匯入');await ui.click('確認覆蓋並匯入');assert.equal(ui.applied,null);assert.equal(ui.closed,false);assert.match(ui.text(),status===412?/排點資料已被調整/:/匯入未成功/);}
});
