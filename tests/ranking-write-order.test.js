const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function fixture(){
 const requests=[],alerts=[];
 const context={window:{location:{search:''},__AUTH_TOKEN__:'fake'},URLSearchParams,Map,Promise,encodeURIComponent,setTimeout(){},alert:x=>alerts.push(x),fetch:(url,options)=>new Promise(resolve=>requests.push({url,options,resolve}))};
 const source=fs.readFileSync('ranking/main.js','utf8');vm.runInNewContext(source.slice(source.indexOf('var FIREBASE_URL'),source.indexOf('function loadData()')),context);
 const respond=(i,data=[],ok=true)=>requests[i].resolve({ok,json:async()=>data});const flush=()=>new Promise(r=>setImmediate(r));
 return {context,requests,respond,flush,alerts};
}
test('輪詢發出後才勾選時，舊讀取不能蓋回畫面；儲存中不輪詢名單',async()=>{
 const f=fixture(),old=f.context.fbGet('/players');const save=f.context.fbPut('/players',[{id:'a',checkedIn:true}]);await f.flush();
 assert.equal(await f.context.fbGet('/players'),null);assert.equal(f.requests.length,2);
 f.respond(0,[{id:'a',checkedIn:false}]);assert.equal(await old,null);f.respond(1);assert.equal(await save,true);
 const latest=f.context.fbGet('/players');f.respond(2,[{id:'a',checkedIn:true}]);assert.equal((await latest)[0].checkedIn,true);
});
test('連續報到、繳費依點擊順序儲存，切換活動不把請求寫到下一場',async()=>{
 const f=fixture();f.context.window.__RANKING_SCOPE__={clubId:'club-a',eventId:'event-one'};
 const a=f.context.fbPut('/players',[{checkedIn:true,paid:false}]);const b=f.context.fbPut('/players',[{checkedIn:true,paid:true}]);f.context.window.__RANKING_SCOPE__={clubId:'club-a',eventId:'event-two'};
 await f.flush();assert.equal(f.requests.length,1);f.respond(0);await a;await f.flush();assert.equal(f.requests.length,2);
 assert.equal(JSON.parse(f.requests[1].options.body)[0].paid,true);assert.match(f.requests[1].url,/event-one/);f.respond(1);await b;
});
test('較早的慢速輪詢不能覆蓋較新的結果；寫入失敗明確提醒且後續仍可存',async()=>{
 const f=fixture(),old=f.context.fbGet('/players'),latest=f.context.fbGet('/players');f.respond(1,[{paid:true}]);assert.equal((await latest)[0].paid,true);f.respond(0,[{paid:false}]);assert.equal(await old,null);
 const fail=f.context.fbPut('/players',[]),next=f.context.fbPut('/players',[{paid:true}]);await f.flush();f.respond(2,[],false);assert.equal(await fail,false);await f.flush();assert.equal(f.alerts.length,1);f.respond(3);assert.equal(await next,true);
});
