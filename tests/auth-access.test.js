const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
function fixture(statuses) {
 const tokens=[], calls=[]; const context={window:{},fetch:async(url,options)=>{calls.push(options.headers.Authorization);const status=statuses.shift();return{status,ok:status===200};}};
 vm.runInNewContext(fs.readFileSync('ranking/auth-access.js','utf8'),context);
 return {api:context.window.RankingAuthAccess,tokens,calls,user:{getIdToken:async force=>{tokens.push(force);return force?'renewed':'current';}}};
}
test('401 更新憑證後重試成功',async()=>{const f=fixture([401,200]);const r=await f.api.request(f.user);assert.equal(r.response.status,200);assert.equal(r.token,'renewed');assert.deepEqual(f.calls,['Bearer current','Bearer renewed']);});
test('403 仍拒絕，不重新授權',async()=>{const f=fixture([403]);assert.equal((await f.api.request(f.user)).response.status,403);assert.equal(f.calls.length,1);});
test('持續401只重試一次，顯示登入失效而非移除權限',async()=>{const f=fixture([401,401]);assert.equal((await f.api.request(f.user)).response.status,401);assert.equal(f.calls.length,2);assert.match(f.api.errorMessage(401),/登入已失效/);assert.doesNotMatch(f.api.errorMessage(401),/權限/);});
test('每次權限確認向Firebase取得目前憑證',async()=>{const f=fixture([200,200]);await f.api.request(f.user);await f.api.request(f.user);assert.equal(f.tokens.length,2);});
