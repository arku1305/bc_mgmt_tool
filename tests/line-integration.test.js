const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const core=require('../報名機器人/lib/registration'),model=require('../報名機器人/lib/club-model');
function fixture(coldCache=false){
 const listeners=new Set();
 const store={},writes=[],cache={},users={leader:{uid:'leader',email:'leader@example.test',emailVerified:true},second:{uid:'second',email:'second@example.test',emailVerified:true},admin:{uid:'admin',email:'admin@example.test',emailVerified:true}};
 const db={ref(location){const parts=location.split('/');const read=()=>parts.reduce((v,k)=>v?.[k],store)??null;const put=value=>{let p=store;for(const k of parts.slice(0,-1))p=p[k]||={};p[parts.at(-1)]=structuredClone(value);writes.push(location);};return{on:(_event,fn)=>listeners.add(fn),off:(_event,fn)=>listeners.delete(fn),once:async()=>({val:()=>structuredClone(read())}),set:async v=>put(v),transaction:async fn=>{const next=fn(coldCache&&!listeners.size?null:structuredClone(read()));if(next!==undefined)put(next);return{committed:next!==undefined,snapshot:{val:()=>structuredClone(read())}};}};}};
 const env={ROSTER_MANAGER_UIDS:'leader,second',PLATFORM_ADMIN_EMAILS:'admin@example.test',RANKING_ORIGIN:'https://example.test/manage',SIGNUP_PAGE_URL:'https://example.test/signup'};
 function load(file){file=path.resolve(file);if(!path.extname(file))file+='.js';if(cache[file])return cache[file];const module={exports:{}};vm.runInNewContext(fs.readFileSync(file,'utf8'),{module,Date,URL,process:{env},require:n=>n==='firebase-admin'?{auth:()=>({getUser:async uid=>users[uid]})}:n.startsWith('.')?load(path.resolve(path.dirname(file),n)):require(n)});return cache[file]=module.exports;}
 const service=load('報名機器人/lib/line-integration.js'),replies=[];let fail=false;
 const transport={linkToken:async id=>'fake-token-'+id,groupSummary:async()=>({groupName:'虛構群 A'}),reply:async(token,messages)=>{if(fail)throw new Error('fake transport failed');replies.push(messages.map(m=>m.text).join('\n'));}};
 async function link(uid,id='line-'+uid,now=100){const text=await service.startLink(db,id,transport,now),url=new URL(text.split('\n').at(-1));const result=await service.prepareLink(db,users[uid],url.searchParams.get('lineLink'),url.searchParams.get('linkToken'),now+1);const event={type:'accountLink',source:{type:'user',userId:id},link:{result:'ok',nonce:new URL(result.url).searchParams.get('nonce')}};await service.completeLink(db,event,now+2);return event;}
 const event=(uid,text,id='command-'+Math.random(),group='group-a')=>({type:'message',webhookEventId:id,source:{type:'group',groupId:group,userId:'line-'+uid},message:{type:'text',text},replyToken:'fake'});
 async function api(user,body,query={}){const result={status:200};const res={status(n){result.status=n;return this;},json(v){result.body=v;},end(){}};await service.service({method:body?'POST':'GET',body,query},res,db,{...users[user],modules:{registration:true}});return result;}
 function club(uid='leader'){const id='club-11111111-1111-4111-8111-111111111111',eventId='event-11111111-1111-4111-8111-111111111111';const c=model.apply(null,{action:'createClub',fields:{name:'虛構團',date:'2026-10-10',startTime:'20:00',endTime:'22:00',location:'虛構場',totalCapacity:4,guestFee:null,fixedFee:null,fixedMembers:['固定甲'],frequency:'once',courtCount:2}}, {uid,clubId:id,eventId,now:1});c.publicToken='11111111-1111-4111-8111-111111111111';store.clubsV2={[id]:c};return {clubId:id,eventId};}
 return{...service,store,writes,db,users,transport,replies,link,event,api,club,listeners,setFail:v=>fail=v};
}
test('冷啟動不把有效綁定誤判過期；成功與拒絕後都釋放監聽',async()=>{
 const f=fixture(true);await f.link('leader');assert.equal((await f.view(f.db,f.users.leader)).linked,true);assert.equal(f.listeners.size,0);
 await assert.rejects(()=>f.prepareLink(f.db,f.users.second,'missing','fake-token',200),/使用或過期/);assert.equal(f.listeners.size,0);
});
test('官方綁定：nonce 單次、到期、來源不符、failed、不允許跨帳號覆寫',async()=>{
 const f=fixture();const e=await f.link('leader');assert.equal((await f.view(f.db,f.users.leader)).linked,true);
 const before=f.writes.length;assert.equal(await f.completeLink(f.db,e,104),false);assert.equal(f.writes.length,before);
 await f.link('second','line-leader');assert.equal((await f.view(f.db,f.users.second)).linked,false);assert.equal(f.store.lineIntegrationV2.links[f.hash('line-leader')].uid,'leader');
 const text=await f.startLink(f.db,'line-new',f.transport,200),u=new URL(text.split('\n').at(-1));
 await assert.rejects(()=>f.prepareLink(f.db,f.users.second,u.searchParams.get('lineLink'),'wrong',201),/使用或過期/);
 const p=await f.prepareLink(f.db,f.users.second,u.searchParams.get('lineLink'),u.searchParams.get('linkToken'),201),nonce=new URL(p.url).searchParams.get('nonce');
 await assert.rejects(()=>f.completeLink(f.db,{source:{type:'user',userId:'attacker'},link:{result:'ok',nonce}},202),/驗證失敗/);
 await f.completeLink(f.db,{source:{type:'user',userId:'line-new'},link:{result:'failed',nonce}},203);assert.equal((await f.view(f.db,f.users.second)).linked,false);
 const expired=await f.startLink(f.db,'line-other',f.transport,300),eu=new URL(expired.split('\n').at(-1));await assert.rejects(()=>f.prepareLink(f.db,f.users.second,eu.searchParams.get('lineLink'),eu.searchParams.get('linkToken'),600301),/使用或過期/);
});
test('第二團長須原登錄者同意；Admin 不可代審或看私有活動，群清單不含 LINE ID',async()=>{
 const f=fixture();await f.link('leader');await f.link('second');await f.handleEvent(f.db,f.event('leader','加入揪凱'),f.transport,200);await f.handleEvent(f.db,f.event('second','加入揪凱'),f.transport,201);
 const key=f.hash('group-a');assert.equal((await f.view(f.db,f.users.second)).groups[0].usable,false);
 assert.equal((await f.api('admin',{action:'review',groupKey:key,requester:'second',decision:'approve'})).status,422);
 assert.equal((await f.api('leader',{action:'review',groupKey:key,requester:'second',decision:'approve'})).status,200);
 assert.equal((await f.view(f.db,f.users.second)).groups[0].usable,true);
 const scope=f.club();assert.equal((await f.api('admin',null,{club:scope.clubId,event:scope.eventId})).status,422);
 assert.doesNotMatch(JSON.stringify(await f.view(f.db,f.users.leader)),/line-leader|lineId|tokenHash|nonce/);
});
test('公告限本人活動與本群；只 reply、重送不重複、暫停與離群阻擋；送出失败不記成功',async()=>{
 const f=fixture();await f.link('leader');await f.link('second');await f.handleEvent(f.db,f.event('leader','加入揪凱'),f.transport,200);const scope=f.club(),groupKey=f.hash('group-a');
 const created=await f.api('leader',{action:'publication',...scope,groupKey,active:true},{club:scope.clubId,event:scope.eventId});assert.equal(created.body.publications[0].status,'awaitingCommand');const cmd=created.body.publications[0].command;
 const count=f.replies.length;await f.handleEvent(f.db,f.event('leader',cmd,'pub-1'),f.transport,300);assert.equal(f.replies.length,count+1);assert.match(f.replies.at(-1),/固定甲/);assert.match(f.replies.at(-1),/本場報名：https:\/\/example.test\/signup\?team=/);
 await f.handleEvent(f.db,f.event('leader',cmd,'pub-1'),f.transport,301);assert.equal(f.replies.length,count+1);
 await f.handleEvent(f.db,f.event('second',cmd,'pub-2'),f.transport,302);assert.match(f.replies.at(-1),/沒有發布權限/);
 await f.handleEvent(f.db,f.event('leader',cmd,'pub-3','group-b'),f.transport,303);assert.match(f.replies.at(-1),/沒有發布權限/);
 f.store.clubsV2[scope.clubId].events[scope.eventId].registrationOpen=false;await f.handleEvent(f.db,f.event('leader',cmd,'pub-4'),f.transport,304);assert.match(f.replies.at(-1),/暫停報名/);
 f.store.clubsV2[scope.clubId].events[scope.eventId].registrationOpen=true;f.setFail(true);await assert.rejects(()=>f.handleEvent(f.db,f.event('leader',cmd,'pub-5'),f.transport,305));assert.equal(Object.values(f.store.lineIntegrationV2.publications)[0].status,'failed');f.setFail(false);
 await f.handleEvent(f.db,{type:'leave',source:{type:'group',groupId:'group-a'}},f.transport,306);assert.equal((await f.view(f.db,f.users.leader)).groups[0].usable,false);
});
test('停用、解除連結立即阻擋群指令；群內姓名報名留到第三階段',async()=>{
 const f=fixture();await f.link('leader');await f.handleEvent(f.db,f.event('leader','加入揪凱'),f.transport,200);
 f.users.leader.disabled=true;await f.handleEvent(f.db,f.event('leader','加入揪凱'),f.transport,201);assert.match(f.replies.at(-1),/權限/);f.users.leader.disabled=false;
 f.store.accessV1={organizers:{[require('../報名機器人/lib/access').emailKey('leader@example.test')]:{enabled:true,modules:{registration:false}}}};
 await f.handleEvent(f.db,f.event('leader','加入揪凱'),f.transport,202);assert.match(f.replies.at(-1),/權限/);
 await f.handleEvent(f.db,{type:'message',source:{type:'user',userId:'line-leader'},message:{type:'text',text:'解除團長綁定'},replyToken:'fake'},f.transport,203);assert.equal((await f.view(f.db,f.users.leader)).linked,false);
 assert.equal(await f.handleEvent(f.db,f.event('leader','小明+2'),f.transport,204),true);assert.match(f.replies.at(-1),/沒有可處理/);
});
test('同場可連結兩群，撤下單群不影響另一群；訊息長度分段且不切斷代理字元',async()=>{
 const f=fixture();await f.link('leader');await f.handleEvent(f.db,f.event('leader','加入揪凱','a','group-a'),f.transport,200);await f.handleEvent(f.db,f.event('leader','加入揪凱','b','group-b'),f.transport,201);
 const scope=f.club();for(const group of ['group-a','group-b'])assert.equal((await f.api('leader',{action:'publication',...scope,groupKey:f.hash(group),active:true})).status,200);
 assert.equal((await f.view(f.db,f.users.leader,scope.clubId,scope.eventId)).publications.length,2);
 await f.api('leader',{action:'publication',...scope,groupKey:f.hash('group-a'),active:false});const view=await f.view(f.db,f.users.leader,scope.clubId,scope.eventId);assert.equal(view.publications.find(p=>p.groupKey===f.hash('group-b')).active,true);
 const message='甲'.repeat(4499)+'😀'+'乙'.repeat(100);const parts=f.textMessages(message);assert.equal(parts.map(p=>p.text).join(''),message);assert.ok(parts.every(p=>p.text.length<=4500));
});
test('新版 webhook 必須先驗證原始簽章，未知群訊息不落回舊名單',async()=>{
 const {Readable}=require('node:stream'),{createHmac}=require('node:crypto');let calls=0;const module={exports:{}};
 vm.runInNewContext(fs.readFileSync('報名機器人/api/webhook.js','utf8'),{module,Buffer,Date,process:{env:{LINE_CHANNEL_SECRET:'fake-test-secret',REGISTRATION_V2:'true',LINE_INTEGRATION_V2:'true'}},require(n){if(n==='@line/bot-sdk')return{validateSignature:(raw,secret,signature)=>signature===createHmac('sha256',secret).update(raw).digest('base64')};if(n==='./_lib')return{db:{},lineClient:{}};if(n==='../lib/line-integration')return{handleEvent:async()=>{calls++;return false;}};if(n==='../lib/line-transport')return{transport:()=>({})};return require(path.resolve('報名機器人/api',n));}});
 const raw=JSON.stringify({events:[{type:'message',source:{type:'group',groupId:'unknown'},message:{type:'text',text:'小明+2'}}]});
 async function send(signature){const req=Readable.from([raw]);req.method='POST';req.headers={'x-line-signature':signature};let code=200;const res={status(n){code=n;return this;},end(){},send(){}};await module.exports(req,res);return code;}
 assert.equal(await send('wrong'),401);assert.equal(calls,0);assert.equal(await send(createHmac('sha256','fake-test-secret').update(raw).digest('base64')),200);assert.equal(calls,1);
});
test('Bot 入群不授權邀請者；舊 join 重送不得把已離群群組重新啟用',async()=>{
 const f=fixture();await f.handleEvent(f.db,{type:'join',timestamp:100,source:{type:'group',groupId:'group-a'}},f.transport,100);
 assert.deepEqual(Object.keys(f.store.lineIntegrationV2.groups[f.hash('group-a')].members),[]);
 await f.link('leader');await f.handleEvent(f.db,f.event('leader','加入揪凱'),f.transport,200);assert.equal((await f.view(f.db,f.users.leader)).groups[0].owner,true);
 await f.handleEvent(f.db,{type:'leave',timestamp:300,source:{type:'group',groupId:'group-a'}},f.transport,300);
 await f.handleEvent(f.db,{type:'join',timestamp:100,source:{type:'group',groupId:'group-a'}},f.transport,400);assert.equal((await f.view(f.db,f.users.leader)).groups[0].active,false);
});
test('解除連結同時撤銷尚未回呼的 nonce，延遲回呼不得重新綁定',async()=>{
 const f=fixture();await f.link('leader');const text=await f.startLink(f.db,'line-leader',f.transport,200),url=new URL(text.split('\n').at(-1));
 const p=await f.prepareLink(f.db,f.users.leader,url.searchParams.get('lineLink'),url.searchParams.get('linkToken'),201);
 await f.unlink(f.db,'leader');assert.equal(await f.completeLink(f.db,{source:{type:'user',userId:'line-leader'},link:{result:'ok',nonce:new URL(p.url).searchParams.get('nonce')}},202),false);
 assert.equal((await f.view(f.db,f.users.leader)).linked,false);
});
async function preparePublished(f,scope,now=300){await f.link('leader');await f.handleEvent(f.db,f.event('leader','加入揪凱'),f.transport,200);const groupKey=f.hash('group-a');await f.api('leader',{action:'publication',...scope,groupKey,active:true});const v=await f.view(f.db,f.users.leader,scope.clubId,scope.eventId);await f.handleEvent(f.db,f.event('leader',v.publications[0].command),f.transport,now);}
test('一般球友不用綁定可報名代報、同名警告、取消、固定請假與額滿恢复；重送不重複',async()=>{
 const f=fixture(),scope=f.club();await preparePublished(f,scope);const event=f.store.clubsV2[scope.clubId].events[scope.eventId];event.totalCapacity=3;
 await f.handleEvent(f.db,f.event('guest','小明+2','guest-1'),f.transport,400);assert.deepEqual(core.entriesOf(f.store.clubsV2[scope.clubId].events[scope.eventId]).map(p=>p.name),['小明1','小明2']);const count=f.replies.length;
 await f.handleEvent(f.db,f.event('guest','小明+2','guest-1'),f.transport,401);assert.equal(f.replies.length,count);
 await f.handleEvent(f.db,f.event('guest','小明1+1','dup-name'),f.transport,402);assert.match(f.replies.at(-1),/相同姓名/);
 await f.handleEvent(f.db,f.event('guest','固定甲-1','leave'),f.transport,403);await f.handleEvent(f.db,f.event('other','填位甲+1','fill'),f.transport,404);
 await f.handleEvent(f.db,f.event('guest','取消請假 固定甲','restore-full'),f.transport,405);assert.match(f.replies.at(-1),/名額已滿/);
 await f.handleEvent(f.db,f.event('other','小明1-1','cancel'),f.transport,406);await f.handleEvent(f.db,f.event('guest','取消請假 固定甲','restore'),f.transport,407);assert.deepEqual(f.store.clubsV2[scope.clubId].events[scope.eventId].cancelledFixed,[]);
 await f.handleEvent(f.db,f.event('guest','+1','bare'),f.transport,408);assert.match(f.replies.at(-1),/請加上姓名/);
});
test('多場選擇保留原指令；只有原發話者、原群、有效單次 token 能執行；過期及暫停不誤報',async()=>{
 const f=fixture(),first=f.club();await preparePublished(f,first);const club=f.store.clubsV2[first.clubId],id='event-22222222-2222-4222-8222-222222222222';
 f.store.clubsV2[first.clubId]=model.apply(club,{action:'createEvent',fields:{date:'2026-10-11',frequency:'once'}},{uid:'leader',eventId:id,now:100});const second={clubId:first.clubId,eventId:id};await preparePublished(f,second,301);
 const messages=[],transport={...f.transport,reply:async(_,parts)=>messages.push(...parts)};
 await f.handleEvent(f.db,f.event('guest','代報+2','pick-1'),transport,400);const choice=messages.at(-1).quickReply.items[1].action.data;
 const post=(uid,data=choice,group='group-a')=>({type:'postback',webhookEventId:'post-'+uid+Math.random(),source:{type:'group',groupId:group,userId:'line-'+uid},postback:{data},replyToken:'fake'});
 await f.handleEvent(f.db,post('other'),transport,401);assert.match(messages.at(-1).text,/不是你的操作/);
 await f.handleEvent(f.db,post('guest',choice,'group-b'),transport,402);assert.match(messages.at(-1).text,/不是你的操作/);
 await f.handleEvent(f.db,post('guest'),transport,403);assert.equal(core.entriesOf(f.store.clubsV2[first.clubId].events[first.eventId]).length,0);assert.deepEqual(core.entriesOf(f.store.clubsV2[first.clubId].events[id]).map(p=>p.name),['代報1','代報2']);
 await f.handleEvent(f.db,post('guest'),transport,404);assert.match(messages.at(-1).text,/已使用/);
 await f.handleEvent(f.db,f.event('guest','晚到+1','pick-2'),transport,500);const exp=messages.at(-1).quickReply.items[0].action.data;await f.handleEvent(f.db,post('guest',exp),transport,301000);assert.match(messages.at(-1).text,/過期/);
 await f.handleEvent(f.db,f.event('guest','暫停測試+1','pick-3'),transport,600);const paused=messages.at(-1).quickReply.items[0].action.data;f.store.clubsV2[first.clubId].events[first.eventId].registrationOpen=false;await f.handleEvent(f.db,post('guest',paused),transport,601);assert.match(messages.at(-1).text,/暫停/);
});
test('最後名額 LINE／網頁共用同一活動交易，不超收；查名單不洩漏手機及付款',async()=>{
 const f=fixture(),scope=f.club();await preparePublished(f,scope);f.store.clubsV2[scope.clubId].events[scope.eventId].totalCapacity=2;
 const ref=f.db.ref('clubsV2/'+scope.clubId+'/events/'+scope.eventId),web=require('../報名機器人/lib/public-command');
 await Promise.all([f.handleEvent(f.db,f.event('guest','群友甲+1','race'),f.transport,400),ref.transaction(s=>{try{return web.publicCommand(s,'signup',{name:'網頁甲',phone:'0912345678',eventId:scope.eventId},400);}catch(_){return;}})]);
 const session=f.store.clubsV2[scope.clubId].events[scope.eventId];assert.equal(core.entriesOf(session).length,1);session.internalPayment={paid:true};
 await f.handleEvent(f.db,f.event('guest','查名單','roster'),f.transport,401);assert.doesNotMatch(f.replies.at(-1),/0912345678|internalPayment|paid|publicationKey/);
});
test('時段結束瞬間網頁與 LINE 都停止；歷史名單和人工排點不刪除',async()=>{
 const f=fixture(),scope=f.club();await preparePublished(f,scope);const now=Date.parse('2026-10-10T22:00:00+08:00'),s=f.store.clubsV2[scope.clubId].events[scope.eventId];
 await f.handleEvent(f.db,f.event('guest','過期甲+1','expired'),f.transport,now);assert.match(f.replies.at(-1),/沒有可處理/);
 assert.throws(()=>require('../報名機器人/lib/public-command').publicCommand(s,'signup',{name:'網頁甲',phone:'0912345678',eventId:scope.eventId},now),/時段已結束/);
 assert.equal(core.publicActivity(s,now).registrationOpen,false);assert.equal(core.publicActivity(s,now-1).registrationOpen,true);
 const before=JSON.stringify(s.fixedMembers);const next=model.advance(f.store.clubsV2[scope.clubId],now);assert.equal(next.created,0);assert.equal(next.club.events[scope.eventId].registrationOpen,false);assert.equal(JSON.stringify(next.club.events[scope.eventId].fixedMembers),before);
});
