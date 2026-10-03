const { ownedClub } = require('./club-service');
const { fixedOf } = require('./registration');
const { draftRoster } = require('../api/_handoff');
async function handoff(req,res,db,user) {
  const club=await ownedClub(db,user,req.query.club), eventId=req.query.event;
  if (!club || !Object.hasOwn(club.events || {},eventId)) return res.status(403).json({message:'無法匯入此球團或活動'});
  const ref=db.ref('clubsV2/'+club.clubId+'/events/'+eventId);
  const session=(await ref.once('value')).val();
  const draft=draftRoster(session,fixedOf(session),club.clubId);
  if(req.method==='GET')return res.json(draft);
  if(req.method!=='POST')return res.status(405).end();
  if(req.body?.fingerprint!==draft.fingerprint)return res.status(409).json({message:'名單已更新，請重新預覽'});
  const now=Date.now();
  const result=await ref.transaction(current=>{
    if(!current || draftRoster(current,fixedOf(current),club.clubId).fingerprint!==draft.fingerprint)return;
    return {...current,rosterHandoff:{eventId,fingerprint:draft.fingerprint,confirmedAt:now,confirmedBy:user.uid}};
  });
  if(!result.committed)return res.status(409).json({message:'名單已更新，尚未變更排點'});
  const packet={schemaVersion:1,event:draft.event,roster:draft.roster,revision:draft.fingerprint,confirmedAt:now};
  await db.ref('rosterHandoffsV2/'+club.clubId+'/'+eventId+'/'+draft.fingerprint).set(packet);
  return res.json(packet);
}
module.exports={handoff};
