// Server-only LINE adapter. Local preview injects an in-memory adapter instead.
async function call(path,method='GET') {
  const response=await fetch('https://api.line.me/v2/bot/'+path,{method,headers:{Authorization:'Bearer '+process.env.LINE_CHANNEL_ACCESS_TOKEN}});
  if(!response.ok)throw new Error('LINE 服務暫時無法完成操作');
  return response.json();
}
function transport(client){return {
  linkToken:async userId=>(await call('user/'+encodeURIComponent(userId)+'/linkToken','POST')).linkToken,
  groupSummary:groupId=>call('group/'+encodeURIComponent(groupId)+'/summary'),
  reply:(token,messages)=>client.replyMessage(token,messages),
};}
module.exports={transport};
