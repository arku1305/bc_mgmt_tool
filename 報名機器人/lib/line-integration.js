const { randomBytes, createHash } = require('node:crypto');
const admin = require('firebase-admin');
const { resolveAccess } = require('./access');
const { ownedClub } = require('./club-service');
const { render } = require('./line-message-renderer');
const hash = value => createHash('sha256').update(value).digest('hex');
const random = () => randomBytes(24).toString('base64url');
const read = async (db,path) => (await db.ref(path).once('value')).val();
const root = 'lineIntegrationV2';
function init(state) { return { links:{},users:{},attempts:{},groups:{},publications:{},processed:{},...state }; }
async function transact(db,fn) {
  const ref=db.ref(root);await ref.once('value');let error;
  const result=await ref.transaction(value=>{error=null;try{return fn(init(value));}catch(e){error=e;return;}});
  if(!result.committed)throw error || new Error('操作已處理或資料已更新，請重新整理');
  return result.snapshot.val();
}
async function actor(db,uid) {
  let user;try{user=await admin.auth().getUser(uid);}catch(_){return null;}
  if(user.disabled)return null;
  const registry=await read(db,'accessV1') || {};
  const access=resolveAccess({...user,email_verified:user.emailVerified===true},registry,{adminEmails:(process.env.PLATFORM_ADMIN_EMAILS||'').split(',').filter(Boolean),legacyUids:(process.env.ROSTER_MANAGER_UIDS||'').split(',').filter(Boolean)});
  return access && access.modules.registration!==false ? access : null;
}
function membership(state,uid,key) {
  const group=state.groups[key],user=state.users[uid];
  return !!(group?.active && group.members?.[uid] && user?.active && state.links[user.lineKey]?.active && state.links[user.lineKey].uid===uid);
}
async function startLink(db,lineId,transport,now=Date.now()) {
  const token=await transport.linkToken(lineId),ticket=random();
  await transact(db,s=>{s.attempts[hash(ticket)]={lineId,tokenHash:hash(token),expiresAt:now+10*60*1000};return s;});
  const url=new URL(process.env.RANKING_PAGE_URL || process.env.RANKING_ORIGIN);url.searchParams.set('registration','');url.searchParams.set('lineLink',ticket);url.searchParams.set('linkToken',token);
  return '請開啟連結，登入團長 Google 帳號並確認綁定（10 分鐘內有效）。可隨時在後台或私訊「解除團長綁定」。\n'+url.toString();
}
async function prepareLink(db,user,ticket,token,now=Date.now()) {
  if(typeof ticket!=='string'||typeof token!=='string'||ticket.length>200||token.length>1000)throw new Error('綁定連結不正確');
  const nonce=random();
  await transact(db,s=>{const a=s.attempts[hash(ticket)];if(!a||a.expiresAt<=now||a.uid||a.tokenHash!==hash(token))throw new Error('綁定連結已使用或過期，請重新私訊 Bot');a.uid=user.uid;a.nonceHash=hash(nonce);return s;});
  return {url:'https://access.line.me/dialog/bot/accountLink?linkToken='+encodeURIComponent(token)+'&nonce='+encodeURIComponent(nonce)};
}
async function completeLink(db,event,now=Date.now()) {
  if(event.source?.type!=='user'||!event.source.userId||typeof event.link?.nonce!=='string')return false;
  const state=init(await read(db,root)),key=Object.keys(state.attempts).find(k=>state.attempts[k].nonceHash===hash(event.link.nonce));
  const attempt=state.attempts[key];if(!attempt||attempt.usedAt||attempt.expiresAt<=now)return false;
  const access=await actor(db,attempt.uid);if(!access)return false;
  await transact(db,s=>{
    const a=s.attempts[key];if(!a||a.usedAt||a.expiresAt<=now||a.lineId!==event.source.userId)throw new Error('綁定驗證失敗');
    a.usedAt=now;
    if(event.link.result!=='ok'){a.result='failed';return s;}
    const lineKey=hash(a.lineId),oldLine=s.links[lineKey],oldUser=s.users[a.uid];
    if((oldLine?.active&&oldLine.uid!==a.uid)||(oldUser?.active&&oldUser.lineKey!==lineKey)){a.result='conflict';return s;}
    s.links[lineKey]={uid:a.uid,active:true,verifiedAt:now};s.users[a.uid]={lineKey,active:true,verifiedAt:now};a.result='ok';return s;
  });return true;
}
async function unlink(db,uid) {await transact(db,s=>{for(const a of Object.values(s.attempts)){if(a.uid===uid&&!a.usedAt){a.usedAt=Date.now();a.result='cancelled';}}const u=s.users[uid];if(u){u.active=false;if(s.links[u.lineKey]?.uid===uid)s.links[u.lineKey].active=false;}return s;});}
async function groupJoin(db,event,user,transport,now) {
  const key=hash(event.source.groupId);let name='LINE 群組';try{name=(await transport.groupSummary(event.source.groupId)).groupName || name;}catch(_){}
  let message;
  await transact(db,s=>{
    const linked=s.users[user.uid];if(!linked?.active||linked.lineKey!==hash(event.source.userId))throw new Error('請先完成團長 LINE 綁定');
    let g=s.groups[key];if(!g){g=s.groups[key]={groupId:event.source.groupId,name,active:true,createdBy:user.uid,createdAt:now,members:{},requests:{}};}
    if(!g.active)throw new Error('Bot 已離開此群，請重新邀請後再登錄');
    if(!g.createdBy){g.createdBy=user.uid;g.createdAt=now;g.name=name;}
    if(g.createdBy===user.uid){g.members[user.uid]=true;message='已加入揪凱，可在團長後台選擇此群。';}
    else if(g.members[user.uid])message='你已可使用此群組。';
    else{g.requests[user.uid]={uid:user.uid,email:user.email||'已核准團長',status:'pending',requestedAt:now};message='已送出共用申請，請原登錄團長到後台同意。';}
    return s;
  });return message;
}
async function view(db,user,clubId,eventId) {
  const state=init(await read(db,root)),groups=[];
  for(const [key,g] of Object.entries(state.groups)) {
    if(!g.members?.[user.uid]&&g.createdBy!==user.uid&&!g.requests?.[user.uid])continue;
    groups.push({key,name:g.name,active:g.active,usable:membership(state,user.uid,key),owner:g.createdBy===user.uid,status:g.members?.[user.uid]?'approved':g.requests?.[user.uid]?.status,requests:g.createdBy===user.uid?Object.values(g.requests||{}).filter(r=>r.status==='pending').map(r=>({uid:r.uid,email:r.email})):[]});
  }
  let publications=[];
  if(clubId){const club=await ownedClub(db,user,clubId);if(!club||!Object.hasOwn(club.events||{},eventId))throw new Error('無法管理此活動');
    publications=Object.values(state.publications).filter(p=>p.uid===user.uid&&p.clubId===clubId&&p.eventId===eventId).map(p=>({key:p.key,groupKey:p.groupKey,groupName:state.groups[p.groupKey]?.name,active:p.active,status:p.status,command:'發布揪凱 '+p.code,ready:!!club.events[eventId].linePublications?.[p.groupKey]?.active,deliveredAt:p.deliveredAt||null}));}
  return {linked:!!state.users[user.uid]?.active,groups,publications};
}
async function service(req,res,db,user) {
  if(!['GET','POST'].includes(req.method))return res.status(405).end();
  try {
    if(req.method==='POST'){
      const b=req.body||{};
      if(b.action==='unlink')await unlink(db,user.uid);
      else if(user.modules.registration===false) return res.status(403).json({message:'報名管理已停止使用'});
      else if(b.action==='prepareLink')return res.json(await prepareLink(db,user,b.ticket,b.linkToken));
      else if(b.action==='review'){
        if(!['approve','reject'].includes(b.decision)||typeof b.requester!=='string'||! /^[a-f0-9]{64}$/.test(b.groupKey))throw new Error('申請格式不正確');
        const applicant=await actor(db,b.requester);if(b.decision==='approve'&&!applicant)throw new Error('申請者已失去團長權限');
        await transact(db,s=>{const g=s.groups[b.groupKey];if(g?.createdBy!==user.uid||!membership(s,user.uid,b.groupKey)||g.requests?.[b.requester]?.status!=='pending')throw new Error('無法審核此申請');if(b.decision==='approve'&&!s.users[b.requester]?.active)throw new Error('申請者尚未綁定 LINE');g.requests[b.requester].status=b.decision==='approve'?'approved':'rejected';if(b.decision==='approve')g.members[b.requester]=true;return s;});
      } else if(b.action==='publication') {
        const club=await ownedClub(db,user,b.clubId);if(!club||!Object.hasOwn(club.events||{},b.eventId)||typeof b.active!=='boolean'||! /^[a-f0-9]{64}$/.test(b.groupKey))throw new Error('活動或群組不正確');
        const key=hash(b.clubId+':'+b.eventId+':'+b.groupKey),code=randomBytes(6).toString('hex');
        const currentState=init(await read(db,root));if(!membership(currentState,user.uid,b.groupKey))throw new Error('尚未取得此群使用權');
        const ref=db.ref('clubsV2/'+b.clubId);await ref.once('value');
        const bound=await ref.transaction(c=>{if(c?.ownerUid!==user.uid||!Object.hasOwn(c.events||{},b.eventId))return;const event=c.events[b.eventId];event.linePublications={...(event.linePublications||{}),[b.groupKey]:{active:b.active,publicationKey:key}};return c;});
        if(!bound.committed)throw new Error('活動已更新，請重新整理');
        await transact(db,s=>{if(!membership(s,user.uid,b.groupKey))throw new Error('尚未取得此群使用權');const previous=s.publications[key];s.publications[key]={...previous,key,clubId:b.clubId,eventId:b.eventId,groupKey:b.groupKey,uid:user.uid,active:b.active,code:previous?.code||code,status:previous?.status||'awaitingCommand'};return s;});
      } else throw new Error('不支援的操作');
    }
    if(user.modules.registration===false)return res.status(403).json({message:'報名管理已停止使用'});
    return res.json(await view(db,user,req.query.club,req.query.event));
  }catch(e){return res.status(422).json({message:e.message});}
}
function textMessages(text) {const parts=[];while(text.length){let end=Math.min(4500,text.length);if(end<text.length && /[\uD800-\uDBFF]/.test(text[end-1]))end--;parts.push({type:'text',text:text.slice(0,end)});text=text.slice(end);}if(parts.length>5)throw new Error('公告過長，請縮短補充文字');return parts;}
async function handleEvent(db,event,transport,now=Date.now()) {
  if(event.type==='accountLink'){await completeLink(db,event,now);return true;}
  if(['join','leave'].includes(event.type)&&event.source?.type==='group'){
    if(!event.source.groupId)return true;
    const timestamp=event.timestamp || now;
    await transact(db,s=>{const key=hash(event.source.groupId);let g=s.groups[key];if(!g)g=s.groups[key]={groupId:event.source.groupId,name:'LINE 群組',members:{},requests:{},createdBy:null};if(!g.lifecycleAt || timestamp>g.lifecycleAt){g.active=event.type==='join';g.lifecycleAt=timestamp;}return s;});return true;
  }
  if(await require('./line-registration').handle(db,event,transport,now))return true;
  if(event.type!=='message'||event.message?.type!=='text')return false;
  const text=event.message.text.trim(),source=event.source||{};
  if(source.type==='user'&&source.userId){
    if(text==='綁定團長'){await transport.reply(event.replyToken,textMessages(await startLink(db,source.userId,transport,now)));return true;}
    if(text==='解除團長綁定'){const state=init(await read(db,root)),link=state.links[hash(source.userId)];if(link?.active)await unlink(db,link.uid);await transport.reply(event.replyToken,textMessages('已解除團長 LINE 綁定。'));return true;}
  }
  if(source.type!=='group'||!source.groupId|| !(text==='加入揪凱'||/^發布揪凱\s+[a-f0-9]{12}$/.test(text)))return false;
  let user,state=init(await read(db,root));
  const link=source.userId&&state.links[hash(source.userId)];if(link?.active)user=await actor(db,link.uid);
  if(!user){await transport.reply(event.replyToken,textMessages('請先私訊「綁定團長」，並確認報名管理權限。'));return true;}
  if(text==='加入揪凱'){await transport.reply(event.replyToken,textMessages(await groupJoin(db,event,user,transport,now)));return true;}
  const code=text.split(/\s+/)[1],groupKey=hash(source.groupId),publication=Object.values(state.publications).find(p=>p.code===code&&p.groupKey===groupKey&&p.uid===user.uid&&p.active);
  if(!publication||!membership(state,user.uid,groupKey)){await transport.reply(event.replyToken,textMessages('此活動尚未連結到本群，或你沒有發布權限。'));return true;}
  const club=await ownedClub(db,user,publication.clubId),session=club?.events?.[publication.eventId];
  if(!session||!require('./activity-time').available(club,session,now)){await transport.reply(event.replyToken,textMessages('此活動不存在或已暫停報名，請先到後台確認。'));return true;}
  const commandId=event.webhookEventId||event.message.id;if(!commandId)throw new Error('缺少訊息識別');
  const eventKey=hash(commandId);let claimed=false;
  await transact(db,s=>{claimed=false;const p=s.publications[publication.key];if(s.processed[eventKey])return s;if(!p?.active||!membership(s,user.uid,groupKey))throw new Error('發布權限已更新');s.processed[eventKey]={at:now,status:'sending',publicationKey:p.key};p.status='sending';p.attempt=eventKey;claimed=true;return s;});
  if(!claimed)return true;
  const url=new URL(process.env.SIGNUP_PAGE_URL||'https://badminton-signup-bot.vercel.app/');url.searchParams.set('team',club.publicToken);url.searchParams.set('event',session.activityId);
  try{
    await transport.reply(event.replyToken,textMessages(render(session)+'\n\n本場報名：'+url.toString()));
    await transact(db,s=>{s.processed[eventKey].status='sent';const p=s.publications[publication.key];if(p.attempt===eventKey){p.status='sent';p.deliveredAt=now;}return s;});
  }catch(e){await transact(db,s=>{s.processed[eventKey].status='failed';const p=s.publications[publication.key];if(p.attempt===eventKey)p.status='failed';return s;});throw e;}
  return true;
}
module.exports={hash,actor,startLink,prepareLink,completeLink,unlink,view,service,handleEvent,textMessages};
