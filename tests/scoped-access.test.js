const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const { ownTeam, paths } = require('../報名機器人/lib/team-scope');
const { digest } = require('../報名機器人/lib/registration');
const loadService = db => {
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync('報名機器人/lib/access-service.js', 'utf8'), { module, process: { env: {} }, Date, require(name) {
    if (name === 'firebase-admin') return { auth: () => ({}) };
    return name.startsWith('.') ? require(path.resolve('報名機器人/lib', name)) : require(name);
  } }); return module.exports;
};
function response() { const result = { status: 200, headers: {} }; return { result, setHeader(k,v) {result.headers[k]=v;}, status(n) { result.status=n; return this; }, json(value) { result.body=value; }, end() {} }; }
function fixture() {
  const store = { [paths(ownTeam({uid:'leader'})).ranking]: { players: [{ name: '團長私有人員', paid:true }] }, [paths(ownTeam({uid:'admin'})).ranking]: { players: [] } };
  const reads = [], writes = [];
  const db = { ref(location) { reads.push(location); return { once: async () => ({ val: () => store[location] || null }), set: async value => { writes.push(location); store[location]=value; }, transaction: async callback => { const next=callback(store[location] || null); if(next!==undefined) {writes.push(location);store[location]=next;} return {committed:next!==undefined,snapshot:{val:()=>store[location]}}; } }; } };
  return { store, db, reads, writes, ...loadService(db) };
}
test('Admin 即使提交別人 teamId，仍只讀本人排點，不能看到他人名單', async () => {
  const f=fixture(), res=response(), user={uid:'admin',role:'platformAdmin',teamId:ownTeam({uid:'admin'})};
  await f.accessService({method:'GET',query:{scope:'ranking',teamId:ownTeam({uid:'leader'})},headers:{}},res,f.db,user);
  assert.deepEqual(res.result.body.players, []);
  assert.deepEqual(f.reads, [paths(user.teamId).ranking]);
  assert.equal(JSON.stringify(res.result.body).includes('團長私有人員'),false);
});
test('團長不能讀權限頁或新增團長；拒絕時完全不讀他人資料', async () => {
  for (const method of ['GET','POST']) {
    const f=fixture(),res=response();
    await f.accessService({method,query:{scope:'permissions'},headers:{},body:{email:'new@example.test'}},res,f.db,{role:'organizer',teamId:ownTeam({uid:'leader'})});
    assert.equal(res.result.status,403); assert.deepEqual(f.reads,[]); assert.deepEqual(f.writes,[]);
  }
});
test('跨團寫入只落在本人資料，路徑穿越及過期排點版本皆阻擋', async () => {
  const f=fixture(), user={uid:'admin',role:'platformAdmin',teamId:ownTeam({uid:'admin'})};
  const other=paths(ownTeam({uid:'leader'})).ranking;
  const res=response();
  await f.accessService({method:'PUT',query:{scope:'ranking',teamId:ownTeam({uid:'leader'})},headers:{'if-match':'"'+digest(f.store[paths(user.teamId).ranking])+'"'},body:{players:[{name:'Admin本人'}]}},res,f.db,user);
  assert.equal(f.store[other].players[0].name,'團長私有人員');
  const stale=response(); await f.accessService({method:'PUT',query:{scope:'ranking'},headers:{'if-match':'"expired"'},body:{}},stale,f.db,user); assert.equal(stale.result.status,412);
  const bad=response(); await f.accessService({method:'GET',query:{scope:'ranking',path:'/../../'+other},headers:{}},bad,f.db,user); assert.equal(bad.result.status,400);
});

test('Admin 可新增未登入過的團長 Email，重複與錯誤 Email 不寫入，清單不含球團內容', async () => {
  const f=fixture(),user={uid:'admin',role:'platformAdmin',teamId:ownTeam({uid:'admin'})};
  const res=response();
  await f.accessService({method:'POST',query:{scope:'permissions'},headers:{},body:{email:' New@Example.test ',teamId:ownTeam({uid:'leader'})}},res,f.db,user);
  assert.equal(res.result.status,200); assert.equal(res.result.body.organizers[0].email,'new@example.test');
  assert.deepEqual(Object.keys(res.result.body.organizers[0]).sort(),['email','enabled','modules']);
  const before=f.writes.length;
  for(const email of ['NEW@example.test','invalid']) {
    const bad=response(); await f.accessService({method:'POST',query:{scope:'permissions'},headers:{},body:{email}},bad,f.db,user);
    assert.equal(bad.result.status,422); assert.equal(f.writes.length,before);
  }
});
test('公開查看不接受球團 ID 猜測或路徑穿越，僅接受分享代碼', async () => {
  const f=fixture(); assert.equal(await f.publicPaths(f.db,'primary'),null); assert.equal(await f.publicPaths(f.db,'../rankingV1'),null); assert.deepEqual(f.reads,[]);
  const token='11111111-1111-4111-8111-111111111111';
  f.store['publicTeamsV1/'+token]=ownTeam({uid:'leader'});
  const result=await f.publicPaths(f.db,token); assert.equal(result.ranking,paths(ownTeam({uid:'leader'})).ranking);
});

 test('排點停止時後端拒絕讀寫；移除僅改權限不動球團資料', async () => {
  const f=fixture(), user={uid:'leader',role:'organizer',teamId:ownTeam({uid:'leader'}),modules:{registration:true,ranking:false}};
  for (const method of ['GET','PUT']) {
    const res=response(); await f.accessService({method,query:{scope:'ranking'},headers:{},body:{}},res,f.db,user);
    assert.equal(res.result.status,403);
  }
  assert.deepEqual(f.reads,[]); assert.deepEqual(f.writes,[]);
  const actor={uid:'admin',role:'platformAdmin'};
  const run=async body=>{const res=response();await f.accessService({method:'POST',query:{scope:'permissions'},headers:{},body},res,f.db,actor);return res;};
  await run({email:'leader@example.test'});
  const stopped=await run({action:'setModule',email:'leader@example.test',module:'registration',enabled:false});
  assert.equal(stopped.result.body.organizers[0].modules.registration,false);
  assert.equal(stopped.result.body.organizers[0].modules.ranking,true);
  const removed=await run({action:'remove',email:'leader@example.test'});
  assert.equal(removed.result.body.organizers.length,0);
  assert.equal(f.store[paths(user.teamId).ranking].players[0].name,'團長私有人員');
  assert.ok(f.writes.every(location=>location==='accessV1'));
});
