const test=require('node:test'),assert=require('node:assert/strict');
const model=require('../報名機器人/lib/accounting-model');
const {service}=require('../報名機器人/lib/accounting-service');
const {ownTeam}=require('../報名機器人/lib/team-scope');
const {modulePermissions,changeOrganizer,emailKey}=require('../報名機器人/lib/access');
const clubId='club-11111111-1111-1111-1111-111111111111',eventId='event-a';
function fixture(){
 const store={clubsV2:{[clubId]:{clubId,ownerUid:'leader',name:'虛構球團',events:{[eventId]:{activityId:eventId,eventDate:'2020-01-01',eventTime:'2020-01-01 20:00',startTime:'20:00',endTime:'22:00',fixedMembers:['固定甲'],guestFee:200,walkIns:{a:{name:'臨打乙',time:1}},cancelledFixed:[]}}}},userClubsV2:{leader:{[clubId]:true}},eventSchedulesV2:{[clubId]:{[eventId]:{players:[{name:'固定甲',regular:true},{name:'人工丙',regular:false,paid:true}]}}}};
 const db={ref(path){const parts=path.split('/');const read=()=>parts.reduce((v,k)=>v?.[k],store)??null;return{once:async()=>({val:()=>structuredClone(read())}),transaction:async fn=>{const next=fn(structuredClone(read()));if(next!==undefined){let p=store;for(const key of parts.slice(0,-1))p=p[key]||={};p[parts.at(-1)]=structuredClone(next);}return{committed:next!==undefined,snapshot:{val:()=>structuredClone(read())}};}};}};
 const user={uid:'leader',teamId:ownTeam({uid:'leader'}),role:'organizer',modules:{registration:true,ranking:true,accounting:true}};
 async function call(body,actor=user){const result={status:200};const res={status(n){result.status=n;return this;},json(v){result.body=v;return this;},end(){}};await service({method:body?'POST':'GET',body},res,db,actor);return result;}
 return{store,db,user,call};
}
const source={kind:'registration',clubId,eventId};
const entry={name:'臨打乙',type:'income',category:'臨打費',amount:'200.25'};
const payload=(preview,revision)=>({action:'import',source,fingerprint:preview.fingerprint,expectedRevision:revision,confirmed:true,title:preview.title,date:preview.date,entries:[entry]});
test('金額以分計算；空白、負值、過多小數及非法分類拒絕',()=>{
 assert.equal(model.cents('0.29'),29);
 for(const v of ['',null,true,'-1','1.001','Infinity','1e3','100000001'])assert.throws(()=>model.cents(v));
 assert.throws(()=>model.normalizeEntries([{...entry,category:'場地費'}]));
 assert.throws(()=>model.date('2026-02-30'));
 const t=model.totals(model.normalizeEntries([entry,{name:'球費',type:'expense',category:'球費',amount:'20.10'}]));assert.equal(t.balanceCents,18015);
});
test('預覽不寫帳、固定不預填收款、排點與報名不同，正式確認才入帳且跨來源不重複',async()=>{
 const f=fixture(),before=JSON.stringify(f.store),read=(await f.call()).body;
 const p=(await f.call({action:'preview',source})).body;
 assert.equal(JSON.stringify(f.store),before);assert(p.entries.every(e=>e.include===true));assert.equal(p.entries.find(e=>e.participantType==='fixed').amount,0);
 const rank=(await f.call({action:'preview',source:{...source,kind:'ranking'}})).body;assert.equal(rank.id,p.id);assert(rank.entries.some(e=>e.name==='人工丙'));assert(!rank.entries.some(e=>e.name==='臨打乙'));
 assert.equal((await f.call({...payload(p,read.revision),confirmed:false})).status,422);
 const saved=await f.call(payload(p,read.revision));assert.equal(saved.status,200);assert.equal(saved.body.totals.incomeCents,20025);
 const duplicate=await f.call({...payload(rank,saved.body.revision),source:{...source,kind:'ranking'}});assert.equal(duplicate.status,409);assert.equal((await f.call()).body.records.length,1);
});
test('來源變動、舊版本與未結束活動拒絕；保留人工調整',async()=>{
 const f=fixture(),read=(await f.call()).body,p=(await f.call({action:'preview',source})).body;
 f.store.clubsV2[clubId].events[eventId].guestFee=250;
 assert.equal((await f.call(payload(p,read.revision))).status,409);
 const p2=(await f.call({action:'preview',source})).body,saved=await f.call({...payload(p2,read.revision),entries:[{...entry,amount:'180'}]});assert.equal(saved.body.totals.incomeCents,18000);
 const edit={action:'edit',id:p.id,confirmed:true,title:'修改',date:'2020-01-01',entries:[{...entry,amount:'100'}],expectedRevision:read.revision};assert.equal((await f.call(edit)).status,409);
 assert.equal((await f.call()).body.totals.incomeCents,18000);
 f.store.clubsV2[clubId].events[eventId].eventDate='2099-01-01';assert.equal((await f.call({action:'preview',source})).status,422);
});
test('帳務單獨使用、手動收支、編輯、刪除同步總帳；跨帳號及來源權限隔離',async()=>{
 const f=fixture(),accountOnly={...f.user,modules:{accounting:true,ranking:false,registration:false}},read=(await f.call(null,accountOnly)).body;
 assert.equal(read.events.length,0);assert.equal((await f.call({action:'preview',source},accountOnly)).status,403);
 const b={action:'create',title:'預繳',date:'2020-01-01',confirmed:true,expectedRevision:read.revision,entries:[{...entry,category:'固定預繳',amount:'1000'},{name:'退款',type:'expense',category:'退款',amount:'200'}]};
 const saved=(await f.call(b,accountOnly)).body;assert.equal(saved.totals.balanceCents,80000);
 assert.equal((await f.call(null,{...f.user,uid:'other',role:'platformAdmin'})).body.records.length,0);
 assert.equal((await f.call({action:'preview',source},{...f.user,uid:'other',role:'platformAdmin'})).status,403);
 assert.equal((await f.call(null,{...f.user,modules:{accounting:false}})).status,403);
 const id=saved.records[0].id;
 const removed=(await f.call({action:'delete',id,confirmed:true,expectedRevision:saved.revision})).body;assert.equal(removed.totals.balanceCents,0);assert.equal(removed.records.length,0);
 assert.equal((await f.call({...b,action:'edit',id,expectedRevision:removed.revision})).status,409);
});
test('既有團長帳務預設可用，Admin 可單獨關閉',()=>{
 assert.equal(modulePermissions(null).accounting,true);
 const state=changeOrganizer({}, {role:'platformAdmin',uid:'admin'},'leader@example.test','setModule','accounting',false,1,true);
 assert.equal(modulePermissions(state.organizers[emailKey('leader@example.test')]).accounting,false);
 assert.equal(modulePermissions(state.organizers[emailKey('leader@example.test')]).ranking,true);
});
test('獨立排點日期名稱識別及未知費用；換名單後同一場不能重複匯入',async()=>{
 const f=fixture();f.store.teamsV1={[f.user.teamId]:{ranking:{players:[{name:'獨立甲',regular:false}]}}};
 const s={kind:'ranking',date:'2020-01-01',label:'晚場'};
 const p=(await f.call({action:'preview',source:s})).body;assert.equal(p.entries[0].amount,'');
 const r=(await f.call()).body;
 const saved=await f.call({...payload(p,r.revision),source:s});assert.equal(saved.status,200);
 f.store.teamsV1[f.user.teamId].ranking.players.push({name:'獨立乙'});
 const p2=(await f.call({action:'preview',source:s})).body;assert.equal(p2.id,p.id);
 assert.equal((await f.call({...payload(p2,saved.body.revision),source:s})).status,409);
});

test('多人活動收入只入帳一筆，逐人明細保留；編輯重算合計、刪除移出總帳，拒絕混入支出',async()=>{
 const f=fixture(),read=(await f.call()).body,p=(await f.call({action:'preview',source})).body;
 const saved=(await f.call({...payload(p,read.revision),entries:[entry,{...entry,name:'人工丙',amount:'100.10'}]})).body;
 assert.equal(saved.records[0].entries.length,1);assert.equal(saved.records[0].entries[0].name,p.title);
 assert.equal(saved.records[0].entries[0].amountCents,30035);assert.equal(saved.records[0].members.length,2);
 const edit={action:'edit',id:p.id,confirmed:true,title:'10/13 球團活動',date:p.date,expectedRevision:saved.revision,entries:[{...entry,amount:'180'}]};
 const edited=(await f.call(edit)).body;assert.equal(edited.totals.incomeCents,18000);assert.equal(edited.records[0].members.length,1);assert.equal(edited.records[0].entries[0].name,edit.title);
 assert.equal((await f.call({...edit,expectedRevision:edited.revision,entries:[{name:'球費',type:'expense',category:'球費',amount:'10'}]})).status,409);
 const removed=(await f.call({action:'delete',id:p.id,confirmed:true,expectedRevision:edited.revision})).body;
 assert.equal(removed.totals.balanceCents,0);
 assert.equal(removed.records.length,0);assert.equal((await f.call({...edit,expectedRevision:removed.revision})).status,409);
});

test('退款獨立記支出且保留預繳收入；拒絕舊作廢操作與舊帳恢復',async()=>{
 const f=fixture(),read=(await f.call()).body;
 const income=(await f.call({action:'create',title:'固定預繳',date:'2020-01-01',confirmed:true,expectedRevision:read.revision,entries:[{...entry,category:'固定預繳',amount:'1000'}]})).body;
 const refund=(await f.call({action:'create',title:'固定甲請假退款',date:'2020-01-02',confirmed:true,expectedRevision:income.revision,entries:[{name:'固定甲',type:'expense',category:'退款',amount:'150'}]})).body;
 assert.equal(refund.records.length,2);assert.equal(refund.totals.incomeCents,100000);assert.equal(refund.totals.expenseCents,15000);assert.equal(refund.totals.balanceCents,85000);
 assert.equal((await f.call({action:'void',confirmed:true,id:income.records[0].id,expectedRevision:refund.revision})).status,422);
 const key=Object.keys(f.store.accountingV1)[0];f.store.accountingV1[key].records[income.records[0].id].voidedAt=1;
 const legacy=(await f.call()).body;assert.equal(legacy.totals.incomeCents,0);
 assert.equal((await f.call({action:'edit',confirmed:true,id:income.records[0].id,expectedRevision:legacy.revision,title:'不可恢復',date:'2020-01-01',entries:[entry]})).status,409);
});
