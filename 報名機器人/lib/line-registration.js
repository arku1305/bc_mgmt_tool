const {randomBytes}=require('node:crypto');
const {parseCommand,applyLine}=require('./line-command');
const {render}=require('./line-message-renderer');
const {ended,open}=require('./activity-time');
const {stamp}=require('./club-model');
const root='lineIntegrationV2';
const read=async(db,path)=>(await db.ref(path).once('value')).val();
async function candidates(db,groupId,command,now){
  const integration=require('./line-integration'),state=await read(db,root)||{},groupKey=integration.hash(groupId),results=[];
  const group=state.groups?.[groupKey];if(!group?.active)return results;
  const seen=new Set();
  for(const publication of Object.values(state.publications||{})){
    if(publication.groupKey!==groupKey||!publication.active||!publication.deliveredAt||seen.has(publication.eventId))continue;
    if(!group.members?.[publication.uid]||!state.users?.[publication.uid]?.active||!await integration.actor(db,publication.uid))continue;
    const club=await read(db,'clubsV2/'+publication.clubId),session=club?.events?.[publication.eventId];
    const binding=session?.linePublications?.[groupKey];
    if(club?.ownerUid!==publication.uid||!session||!require('./activity-time').current(club,session,now)||ended(session,now)||!binding?.active||binding.publicationKey!==publication.key)continue;
    if(['signup','restore'].includes(command.action)&&!open(session,now))continue;
    seen.add(publication.eventId);results.push({clubId:publication.clubId,eventId:publication.eventId,publicationKey:publication.key,groupKey,session});
  }
  return results.sort((a,b)=>a.session.eventDate.localeCompare(b.session.eventDate)||a.eventId.localeCompare(b.eventId));
}
async function execute(db,event,command,target,transport,now){
  const integration=require('./line-integration'),commandId=event.webhookEventId||event.message?.id;
  if(!commandId)throw new Error('缺少訊息識別');
  const id=integration.hash(commandId),ref=db.ref('clubsV2/'+target.clubId);await ref.once('value');let result,error,duplicate;
  const transaction=await ref.transaction(club=>{
    result=null;error=null;duplicate=false;
    const session=club?.events?.[target.eventId],binding=session?.linePublications?.[target.groupKey];
    if(!session||!require('./activity-time').current(club,session,now)||!binding?.active||binding.publicationKey!==target.publicationKey||ended(session,now)){error='活動已結束或已停止群組連結，請重新查詢';return;}
    if(session.lineCommands?.[id]){duplicate=true;return;}
    try{
      let next=session;
      if(command.action==='roster')result={roster:true};
      else{const applied=applyLine(session,command,now);next=stamp(applied.session);result=applied.result;}
      next.lineCommands={...(session.lineCommands||{}),[id]:{at:now,action:command.action}};
      return {...club,events:{...club.events,[target.eventId]:next}};
    }catch(e){error=e.message;return;}
  });
  if(duplicate)return true;
  const messages=integration.textMessages;
  if(!transaction.committed){await transport.reply(event.replyToken,messages('⚠️ '+(error||'資料已更新，請重新查詢')));return true;}
  const session=transaction.snapshot.val().events[target.eventId];
  const outcome=result.roster?'本場名單':result.accepted?`報名成功 ${result.accepted} 位${result.accepted<result.requested?'（名額不足，僅接受可用空位）':''}`:result.restored?'已恢復參加':result.leave?'已登記本次請假':`已取消 ${result.removed||0} 位`;
  await transport.reply(event.replyToken,messages('✅ '+outcome+'\n\n'+render(session)));return true;
}
async function handle(db,event,transport,now=Date.now()){
  const integration=require('./line-integration'),source=event.source||{};
  if(source.type!=='group'||!source.groupId)return false;
  let command,selected,choiceKey;
  if(event.type==='postback'){
    const match=event.postback?.data?.match(/^jkchoose:([a-f0-9]{48}):([a-f0-9]{64})$/);if(!match)return false;
    choiceKey=integration.hash(match[1]);const choice=await read(db,root+'/choices/'+choiceKey);
    if(!choice||choice.usedAt||choice.expiresAt<=now||choice.groupId!==source.groupId||choice.lineId!==source.userId||!Object.hasOwn(choice.targets||{},match[2])){await transport.reply(event.replyToken,integration.textMessages('選場已過期、已使用或不是你的操作，請重新輸入指令。'));return true;}
    command=choice.command;selected=choice.targets[match[2]];
  }else if(event.type==='message'&&event.message?.type==='text'){
    const text=event.message.text.trim();
    if(/^[+＋]\s*\d+$/.test(text)){await transport.reply(event.replyToken,integration.textMessages('請加上姓名，例如「小明+1」或「小明+2」。'));return true;}
    command=parseCommand(text);if(!command)return false;
  }else return false;
  const available=await candidates(db,source.groupId,command,now);
  if(selected){
    const target=available.find(t=>t.clubId===selected.clubId&&t.eventId===selected.eventId);
    if(!target){await transport.reply(event.replyToken,integration.textMessages('這場已結束、暫停或群組連結已停止，請重新輸入指令。'));return true;}
    const ref=db.ref(root+'/choices/'+choiceKey);await ref.once('value');
    const claimed=await ref.transaction(c=>c&&!c.usedAt&&c.expiresAt>now&&c.lineId===source.userId&&c.groupId===source.groupId?{...c,usedAt:now}:undefined);
    if(!claimed.committed){await transport.reply(event.replyToken,integration.textMessages('這個選擇已處理，請重新輸入指令。'));return true;}
    return execute(db,event,command,target,transport,now);
  }
  if(!available.length){await transport.reply(event.replyToken,integration.textMessages('本群目前沒有可處理的活動，請等團長發布公告或使用本場報名連結。'));return true;}
  if(available.length===1)return execute(db,event,command,available[0],transport,now);
  if(!source.userId){await transport.reply(event.replyToken,integration.textMessages('無法辨識選場操作者，請使用團長提供的本場網頁連結。'));return true;}
  const token=randomBytes(24).toString('hex'),targets={},buttons=available.slice(0,13).map((t,i)=>{
    const key=integration.hash(t.clubId+':'+t.eventId);targets[key]={clubId:t.clubId,eventId:t.eventId};
    return {type:'action',action:{type:'postback',label:((i+1)+'. '+t.session.eventDate+' '+t.session.startTime).slice(0,20),displayText:'選擇 '+t.session.teamName+' '+t.session.eventTime,data:'jkchoose:'+token+':'+key}};
  });
  const dedupKey=integration.hash(event.webhookEventId||event.message.id),ref=db.ref(root+'/choiceRequests/'+dedupKey);await ref.once('value');
  const claim=await ref.transaction(c=>c?undefined:{at:now});if(!claim.committed)return true;
  await db.ref(root+'/choices/'+integration.hash(token)).set({command,targets,lineId:source.userId,groupId:source.groupId,expiresAt:now+5*60*1000});
  await transport.reply(event.replyToken,[{type:'text',text:'請選擇要處理的活動（5 分鐘內有效）。\n'+available.slice(0,13).map((t,i)=>(i+1)+'. '+t.session.teamName+' · '+t.session.eventTime).join('\n')+(available.length>13?'先列出前 13 場，其他場請使用本場網頁連結。':''),quickReply:{items:buttons}}]);return true;
}
module.exports={handle,candidates,execute};
