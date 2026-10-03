const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const core=require('../報名機器人/lib/registration');
const fields={name:'測試甲團',date:'2026-10-06',startTime:'20:00',endTime:'22:00',location:'虛構場地',totalCapacity:2,guestFee:200,fixedFee:150,fixedMembers:['固定甲'],frequency:'once',courtCount:2};
function fixture(){
 const store={}, writes=[];
 const db={ref(location){const parts=location.split('/');const read=()=>parts.reduce((v,k)=>v?.[k],store)??null;const put=value=>{let p=store;for(const key of parts.slice(0,-1))p=p[key]||=( {} );p[parts.at(-1)]=JSON.parse(JSON.stringify(value));writes.push(location);};return{once:async()=>({val:read}),set:async value=>put(value),transaction:async fn=>{const next=fn(read());if(next!==undefined)put(next);return{committed:next!==undefined,snapshot:{val:read}};}};}};
 const module={exports:{}};vm.runInNewContext(fs.readFileSync('報名機器人/lib/club-service.js','utf8'),{module,Date,process:{env:{}},require:name=>name.startsWith('.')?require(path.resolve('報名機器人/lib',name)):require(name)});
 async function call(user,query={},body){const result={status:200};const res={status(n){result.status=n;return this;},json(value){result.body=value;},end(){}};await module.exports.service({method:body?'POST':'GET',query,body},res,db,user);return result;}
 return{store,writes,db,call,...module.exports};
}
test('API 可建立本人兩團；Admin 與其他團長不能讀寫；查列表不含他團',async()=>{
 const f=fixture(),leader={uid:'leader'},admin={uid:'admin'};
 const first=await f.call(leader,{}, {action:'createClub',fields});const second=await f.call(leader,{}, {action:'createClub',fields:{...fields,name:'測試乙團'}});
 assert.equal(first.status,200);assert.notEqual(first.body.clubId,second.body.clubId);
 const list=await f.call(leader);assert.equal(list.body.clubs.length,2);
 assert.equal((await f.call(admin)).body.clubs.length,0);
 const writes=f.writes.length;
 for(const actor of [admin,{uid:'other'}]){
  assert.equal((await f.call(actor,{club:first.body.clubId})).status,403);
  assert.equal((await f.call(actor,{club:first.body.clubId},{action:'setOpen',eventId:first.body.selectedEventId,open:false,expectedRevision:first.body.revision})).status,403);
 }
 assert.equal(f.writes.length,writes);
});
test('API 過期版本不能覆寫網頁新報名，公開活動列表不洩漏私有資料',async()=>{
 const f=fixture(),leader={uid:'leader'};
 const created=(await f.call(leader,{}, {action:'createClub',fields})).body;
 const eventId=created.selectedEventId,club=f.store.clubsV2[created.clubId];
 club.events[eventId]=core.addGuest?require('../報名機器人/lib/public-command').publicCommand(club.events[eventId],'signup',{name:'網頁甲',phone:'0912345678',eventId},200):null;
 const writes=f.writes.length;
 const stale=await f.call(leader,{club:created.clubId},{action:'setOpen',eventId,open:false,expectedRevision:created.revision});
 assert.equal(stale.status,409);assert.equal(f.writes.length,writes);assert.equal(core.entriesOf(club.events[eventId]).length,1);
 const publicData=await f.publicScope(f.db,{clubId:created.clubId},null);
 assert.equal(JSON.stringify(publicData).includes('0912345678'),false);assert.equal(JSON.stringify(publicData).includes('ownerUid'),false);
 assert.equal(await f.publicScope(f.db,{clubId:created.clubId},'nonexistent'),null);
});
test('模擬排程正式服務拒絕；非法路徑不寫入；重建活動保留舊場',async()=>{
 const f=fixture(),user={uid:'leader'},created=(await f.call(user,{}, {action:'createClub',fields})).body;
 const denied=await f.call(user,{club:created.clubId},{action:'previewAdvance',expectedRevision:created.revision,now:Date.now()});assert.equal(denied.status,422);
 const bad=await f.call(user,{club:'../rankingV1'},{action:'setOpen'});assert.equal(bad.status,403);
 const next=(await f.call(user,{club:created.clubId},{action:'createEvent',fields:{date:'2026-10-10',frequency:'once'},expectedRevision:created.revision})).body;
 assert.equal(next.events.length,2);assert.ok(f.store.clubsV2[created.clubId].events[created.selectedEventId]);
});
test('活動交接與排點按場分開；其他團長和 Admin 不得存取，名單更新阻擋舊確認',async()=>{
 const f=fixture(),user={uid:'leader',teamId:require('../報名機器人/lib/team-scope').ownTeam({uid:'leader'}),modules:{registration:true,ranking:true}};
 const first=(await f.call(user,{}, {action:'createClub',fields})).body;
 const second=(await f.call(user,{club:first.clubId},{action:'createEvent',fields:{date:'2026-10-10',frequency:'once'},expectedRevision:first.revision})).body;
 const handoff=require('../報名機器人/lib/club-handoff').handoff;
 const module={exports:{}};vm.runInNewContext(fs.readFileSync('報名機器人/lib/access-service.js','utf8'),{module,Date,process:{env:{REGISTRATION_V2:'true'}},require:name=>name==='firebase-admin'?{}:name.startsWith('.')?require(path.resolve('報名機器人/lib',name)):require(name)});
 const query={club:first.clubId,event:first.selectedEventId};
 function response(){const result={status:200,headers:{}};return{result,status(n){result.status=n;return this;},setHeader(k,v){result.headers[k]=v;},json(body){result.body=body;},end(){}};}
 let res=response();await handoff({method:'GET',query},res,f.db,user);const draft=res.result.body;assert.equal(draft.roster.length,1);
 res=response();await handoff({method:'POST',query,body:{fingerprint:draft.fingerprint}},res,f.db,user);assert.equal(res.result.status,200);
 res=response();await module.exports.accessService({method:'GET',query:{...query,scope:'ranking'},headers:{}},res,f.db,user);const etag=res.result.headers.ETag;
 res=response();await module.exports.accessService({method:'PUT',query:{...query,scope:'ranking'},headers:{'if-match':etag},body:{players:[{name:'人工甲',level:9}]}},res,f.db,user);assert.equal(res.result.status,200);
 res=response();await module.exports.accessService({method:'GET',query:{...query,event:second.selectedEventId,scope:'ranking'},headers:{}},res,f.db,user);assert.equal(res.result.body,null);
 for(const actor of [{...user,uid:'other'},{...user,uid:'admin',role:'platformAdmin'}]){
  res=response();await handoff({method:'GET',query},res,f.db,actor);assert.equal(res.result.status,403);
  res=response();await module.exports.accessService({method:'PUT',query:{...query,scope:'ranking'},headers:{},body:{}},res,f.db,actor);assert.equal(res.result.status,403);
 }
 assert.equal(f.store.eventSchedulesV2[first.clubId][first.selectedEventId].players[0].level,9);
 const club=f.store.clubsV2[first.clubId];club.events[query.event]=require('../報名機器人/lib/public-command').publicCommand(club.events[query.event],'signup',{name:'新臨打',phone:'0912345678',eventId:query.event},300);
 res=response();await handoff({method:'POST',query,body:{fingerprint:draft.fingerprint}},res,f.db,user);assert.equal(res.result.status,409);
 assert.equal(await f.publicScope(f.db,{clubId:first.clubId},'constructor'),null);
});
