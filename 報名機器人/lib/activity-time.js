function ended(session,now=Date.now()) {
  const end=Date.parse((session?.eventDate||'')+'T'+(session?.endTime||'')+':00+08:00');
  return Number.isFinite(end) && now>=end;
}
function open(session,now=Date.now()) {return !!session?.activityId && session.registrationOpen!==false && !ended(session,now);}
module.exports={ended,open};
function current(club,session,now=Date.now()) {
  if(!session?.recurrenceId)return true;
  const series=club.series?.[session.recurrenceId];
  if(series&&session.eventDate!==series.anchorDate){const opens=Date.parse(session.eventDate+'T09:00:00+08:00')-(series.leadDays||0)*86400000;if(now<opens)return false;}
  return !Object.values(club.events||{}).some(e=>e.activityId!==session.activityId&&e.recurrenceId===session.recurrenceId&&!ended(e,now)&&(e.eventDate<session.eventDate||(e.eventDate===session.eventDate&&e.activityId<session.activityId)));
}
function available(club,session,now=Date.now()){return open(session,now)&&current(club,session,now);}
module.exports.current=current;module.exports.available=available;
