const test=require('node:test'), assert=require('node:assert/strict');
const model=require('../報名機器人/lib/club-model'), core=require('../報名機器人/lib/registration');
const {render}=require('../報名機器人/lib/line-message-renderer');
const fields={name:'虛構週二團',date:'2026-10-06',startTime:'20:00',endTime:'22:00',location:'虛構球館',totalCapacity:4,guestFee:200,fixedFee:150,fixedMembers:['固定甲'],frequency:'weekly',untilDate:'2026-12-31',intervalWeeks:1,leadDays:3,courtCount:2,shuttlecock:'測試用球',message:'請提前取消'};
const context={uid:'leader',clubId:'club-11111111-1111-4111-8111-111111111111',eventId:'event-11111111-1111-4111-8111-111111111111',now:100};
const create=()=>model.apply(null,{action:'createClub',fields},context);
test('多場同時存在，單場覆寫不動預設與舊名單；不同 owner 不能變更',()=>{
 let club=create();club=model.apply(club,{action:'addGuest',eventId:context.eventId,name:'臨打甲'},context);
 const old=JSON.stringify(club.events[context.eventId]);
 club=model.apply(club,{action:'createEvent',fields:{date:'2026-10-10',frequency:'once',guestFee:250}}, {...context,eventId:'event-b'});
 assert.equal(Object.keys(club.events).length,2);assert.equal(JSON.stringify(club.events[context.eventId]),old);
 assert.equal(club.events['event-b'].guestFee,250);assert.equal(club.defaults.guestFee,200);
 club=model.apply(club,{action:'edit',eventId:'event-b',fields:{guestFee:300,message:'只改本場'}},context);
 assert.equal(club.events['event-b'].guestFee,300);assert.equal(club.defaults.message,'請提前取消');
 assert.throws(()=>model.apply(club,{action:'setOpen',eventId:'event-b',open:false},{...context,uid:'admin'}),/無法管理/);
});
test('每週沿用原開團時點，重跑不重複；前場名單、請假、費率保留',()=>{
 let club=create();club=model.apply(club,{action:'leaveFixed',eventId:context.eventId,name:'固定甲'},context);
 club=model.apply(club,{action:'addGuest',eventId:context.eventId,name:'臨打乙'},context);
 club=model.apply(club,{action:'edit',eventId:context.eventId,fields:{guestFee:250}},context);
 const old=JSON.stringify(club.events[context.eventId]);
 assert.equal(model.advance(club,Date.parse('2026-10-06T21:00:00+08:00')).created,0);
 assert.equal(model.advance(club,Date.parse('2026-10-09T09:00:00+08:00')).created,0);
 const next=model.advance(club,Date.parse('2026-10-10T09:00:00+08:00'));
 assert.equal(next.created,1);assert.equal(next.club.events[context.eventId].registrationOpen,false);assert.equal(JSON.stringify({...next.club.events[context.eventId],registrationOpen:true}),old);
 const event=Object.values(next.club.events).find(e=>e.eventDate==='2026-10-13');
 assert.equal(event.guestFee,200);assert.deepEqual(event.cancelledFixed,[]);assert.deepEqual(event.walkIns,{});assert.deepEqual(event.fixedMembers,['固定甲']);
 assert.equal(model.advance(next.club,Date.parse('2026-10-10T09:00:00+08:00')).created,0);
 assert.equal(Object.keys(next.club.series).length,1);
});
test('單次不續開；暫停週期不刪已建立活動，暫停單場不停止週期',()=>{
 const once=model.apply(null,{action:'createClub',fields:{...fields,frequency:'once'}},context);
 assert.equal(model.advance(once,Date.parse('2026-11-10T09:00:00+08:00')).created,0);
 let club=create();club=model.apply(club,{action:'setOpen',eventId:context.eventId,open:false},context);
 assert.equal(model.advance(club,Date.parse('2026-10-10T09:00:00+08:00')).created,1);
 club=model.apply(club,{action:'setSeries',seriesId:context.eventId,enabled:false},context);
 assert.equal(model.advance(club,Date.parse('2026-10-10T09:00:00+08:00')).created,0);assert.equal(Object.keys(club.events).length,1);
});
test('保留姓名代報、同名拒絕、固定額滿不能恢復；報名ID不因其他人取消改變',()=>{
 let club=create();club=model.apply(club,{action:'addGuest',eventId:context.eventId,name:'小明',count:2},context);
 assert.deepEqual(core.entriesOf(club.events[context.eventId]).map(p=>p.name),['小明1','小明2']);
 const id=core.entriesOf(club.events[context.eventId])[1].registrationId;
 assert.throws(()=>model.apply(club,{action:'addGuest',eventId:context.eventId,name:'小明1'},context),/相同姓名/);
 club=model.apply(club,{action:'removeGuest',eventId:context.eventId,name:'小明1'},context);
 assert.equal(core.entriesOf(club.events[context.eventId])[0].registrationId,id);
 club=model.apply(club,{action:'leaveFixed',eventId:context.eventId,name:'固定甲'},context);
 club=model.apply(club,{action:'addGuest',eventId:context.eventId,name:'乙',count:3},context);
 assert.throws(()=>model.apply(club,{action:'restoreFixed',eventId:context.eventId,name:'固定甲'},context),/名額已滿/);
});
test('公告來源是本場快照，編號與空位正確，不含電話或繳費',()=>{
 let club=create();club=model.apply(club,{action:'addGuest',eventId:context.eventId,name:'臨打甲'},context);
 const session=club.events[context.eventId];core.entriesOf(session)[0].phone='fake-private';core.entriesOf(session)[0].paid=true;
 const text=render(session);assert.match(text,/場地數：2/);assert.match(text,/測試用球/);assert.match(text,/1\. 固定甲/);assert.match(text,/2\. 臨打甲/);assert.match(text,/3\.\n4\./);assert.match(text,/剩餘空位：2/);assert.doesNotMatch(text,/fake-private|paid/);
});
test('四個選填欄位可空白；未設定金額不等於零元，續開保留空白',()=>{
 const optional={...fields,guestFee:null,fixedFee:null,shuttlecock:'',message:''};
 let club=model.apply(null,{action:'createClub',fields:optional},context);
 let event=club.events[context.eventId];assert.equal(event.guestFee,null);assert.equal(event.fixedFee,null);assert.equal(event.shuttlecock,'');
 assert.doesNotMatch(render(event),/null|臨打費用：|用球：/);
 club=model.apply(club,{action:'edit',eventId:context.eventId,fields:{guestFee:0,fixedFee:0}},context);assert.match(render(club.events[context.eventId]),/臨打費用：0 元/);
 club=model.apply(club,{action:'edit',eventId:context.eventId,fields:{guestFee:null,fixedFee:null}},context);assert.equal(club.events[context.eventId].guestFee,null);
 const next=model.advance(club,new Date('2026-10-10T01:00:00Z').getTime()).club;assert.ok(Object.values(next.events).every(e=>e.guestFee==null));
 assert.throws(()=>model.apply(null,{action:'createClub',fields:{...optional,guestFee:-1}},context),/非負/);
});
test('每週同一系列只能有一場可報名；舊場不能重新開放；單次結束也自動關閉',()=>{
 const club=create();assert.throws(()=>model.apply(club,{action:'createEvent',fields:{date:'2026-10-13',frequency:'weekly',seriesId:context.eventId}},{...context,eventId:'event-22222222'}),/已有可報名/);
 const endedAt=Date.parse('2026-10-06T22:00:00+08:00');const closed=model.advance(club,endedAt).club;assert.equal(closed.events[context.eventId].registrationOpen,false);
 assert.throws(()=>model.apply(closed,{action:'setOpen',eventId:context.eventId,open:true},{...context,now:endedAt}),/已結束/);
 const single=model.apply(null,{action:'createClub',fields:{...fields,frequency:'once'}},context);assert.equal(model.advance(single,endedAt).club.events[context.eventId].registrationOpen,false);
});
test('舊資料提前產生下一週也只允許一場；到前場結束與開放日後才切換',()=>{
 const club=create(),old=club.events[context.eventId],id='event-22222222';club.events[id]={...old,activityId:id,eventDate:'2026-10-13',recurrenceId:context.eventId};
 const time=require('../報名機器人/lib/activity-time');assert.equal(time.available(club,old,Date.parse('2026-10-04T09:00:00+08:00')),true);assert.equal(time.available(club,club.events[id],Date.parse('2026-10-04T09:00:00+08:00')),false);
 assert.equal(time.available(club,club.events[id],Date.parse('2026-10-07T09:00:00+08:00')),false);assert.equal(time.available(club,club.events[id],Date.parse('2026-10-10T09:00:00+08:00')),true);
});
test('新活動固定名單可修改、清空；省略沿用預設，不覆寫預設與舊場次',()=>{
 const club=create(),old=JSON.stringify(club.events[context.eventId]);
 const add=(fixedMembers,id)=>model.apply(club,{action:'createEvent',fields:{date:'2026-10-10',frequency:'once',...fixedMembers}},{...context,eventId:id});
 const changed=add({fixedMembers:['固定乙','固定丙']},'changed');
 assert.deepEqual(changed.events.changed.fixedMembers,['固定乙','固定丙']);
 assert.deepEqual(changed.defaults.fixedMembers,['固定甲']);assert.equal(JSON.stringify(changed.events[context.eventId]),old);
 assert.deepEqual(add({fixedMembers:[]},'empty').events.empty.fixedMembers,[]);
 assert.deepEqual(add({},'default').events.default.fixedMembers,['固定甲']);
 assert.throws(()=>add({fixedMembers:['固定乙','固定乙']},'duplicate'));
 assert.throws(()=>add({fixedMembers:['甲','乙','丙','丁','戊']},'overfull'));
});

test('新球團首場與新活動拒絕過去日期、今日已開始及剛好現在；台灣未來時段可建立',()=>{
 const now=Date.parse('2026-10-09T15:00:00+08:00'),ctx={...context,now};
 for(const input of [{date:'2026-10-08',startTime:'20:00',endTime:'22:00'},{date:'2026-10-09',startTime:'14:00',endTime:'16:00'},{date:'2026-10-09',startTime:'15:00',endTime:'16:00'}]){
  assert.throws(()=>model.apply(null,{action:'createClub',fields:{...fields,...input}},ctx),/活動開始時間已經過去/);
  assert.throws(()=>model.apply(create(),{action:'createEvent',fields:{...fields,...input}},ctx),/活動開始時間已經過去/);
 }
 const future={...fields,date:'2026-10-09',startTime:'16:00',endTime:'18:00'};
 assert.equal(model.apply(null,{action:'createClub',fields:future},ctx).events[ctx.eventId].startTime,'16:00');
 const midnight={...future,date:'2026-10-10',startTime:'00:15',endTime:'01:15'};
 assert.equal(model.apply(null,{action:'createClub',fields:midnight},{...ctx,now:Date.parse('2026-10-09T23:59:00+08:00')}).events[ctx.eventId].eventDate,'2026-10-10');
});

test('LINE 公告移除開放句，補充文字緊接資料與固定名單；暫停仍明確顯示',()=>{
 const session={activityId:'fake',teamName:'虛構團',eventDate:'2099-10-13',startTime:'20:00',endTime:'22:00',location:'虛構球館',totalCapacity:4,registrationOpen:true,fixedMembers:['固定甲'],walkIns:[],message:'請準時出席'};
 const text=render(session);assert.doesNotMatch(text,/報名開放中/);assert.match(text,/人數上限：4\n請準時出席\n📋 固定成員/);
 assert.match(render({...session,registrationOpen:false}),/暫停報名\n請準時出席/);
 assert.match(render({...session,eventDate:'2000-01-01'}),/活動已結束，停止報名/);
});

test('每週迄日必填且合法；包含迄日當場，之後不續開，舊系列保持相容',()=>{
 for(const untilDate of ['',undefined,'2026-02-30','2026-10-05'])assert.throws(()=>model.apply(null,{action:'createClub',fields:{...fields,untilDate}},context));
 let club=model.apply(null,{action:'createClub',fields:{...fields,untilDate:'2026-10-13'}},context);
 const next=model.advance(club,Date.parse('2026-10-10T09:00:00+08:00'));assert.equal(next.created,1);
 assert.equal(model.advance(next.club,Date.parse('2026-10-17T09:00:00+08:00')).created,0);
 assert.equal(model.advance(club,Date.parse('2026-12-01T09:00:00+08:00')).created,0);
 delete club.series[context.eventId].untilDate;
 assert.equal(model.advance(club,Date.parse('2026-10-17T09:00:00+08:00')).created,1);
});
test('固定成員請假次數只算本系列期間內各場；恢復不計，其他系列不混入',()=>{
 let club=model.apply(null,{action:'createClub',fields:{...fields,untilDate:'2026-10-13'}},context);
 club=model.apply(club,{action:'leaveFixed',eventId:context.eventId,name:'固定甲'},context);
 assert.equal(model.leaveCount(club,club.events[context.eventId],'固定甲'),1);
 assert.throws(()=>model.apply(club,{action:'leaveFixed',eventId:context.eventId,name:'固定甲'},context));
 club=model.advance(club,Date.parse('2026-10-10T09:00:00+08:00')).club;
 const event=Object.values(club.events).find(e=>e.eventDate==='2026-10-13');
 club=model.apply(club,{action:'leaveFixed',eventId:event.activityId,name:'固定甲'},context);
 club.events.other={...event,activityId:'other',recurrenceId:'other',cancelledFixed:['固定甲']};
 club.events.outside={...event,activityId:'outside',eventDate:'2026-10-20',cancelledFixed:['固定甲']};
 assert.equal(model.leaveCount(club,event,'固定甲'),2);
 club=model.apply(club,{action:'restoreFixed',eventId:event.activityId,name:'固定甲'},context);
 assert.equal(model.leaveCount(club,event,'固定甲'),1);
 const privateView=require('../報名機器人/lib/club-service').view(club,event.activityId);assert.equal(privateView.fixed[0].leaveCount,1);
});
