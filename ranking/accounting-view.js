(function(root) {
  function sum(entries) {
    const result={income:0,expense:0};
    entries.forEach(e=>{result[e.type]+=e.amountCents;});
    return result;
  }
  function statement(records,filters={}) {
    const rows=[];
    for (const record of records) {
      if (record.voidedAt) continue;
      if ((filters.from&&record.date<filters.from)||(filters.to&&record.date>filters.to)) continue;
      (record.entries||[]).forEach((entry,index)=>{
        if (filters.query&&!(record.title+' '+entry.name+' '+entry.category).includes(filters.query.trim())) return;
        rows.push({record,entry,index,key:record.id+':'+index});
      });
    }
    rows.sort((a,b)=>b.record.date.localeCompare(a.record.date)||b.record.updatedAt-a.record.updatedAt||a.index-b.index);
    const total=sum(rows.filter(r=>!r.record.voidedAt).map(r=>r.entry));
    const pages=Math.max(1,Math.ceil(rows.length/20));
    const page=Math.max(1,Math.min(filters.page||1,pages));
    return {rows:rows.slice((page-1)*20,page*20),count:rows.length,total,pages,page};
  }
  function rankingSource(scope,binding) {
    if (scope?.clubId&&scope?.eventId) return {kind:'ranking',clubId:scope.clubId,eventId:scope.eventId};
    if (binding?.teamId?.startsWith('club-')&&binding.eventId) return {kind:'ranking',clubId:binding.teamId,eventId:binding.eventId};
    return {kind:'ranking'};
  }
  const api={sum,statement,rankingSource};
  root.AccountingView=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
