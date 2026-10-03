const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), { Readable } = require('node:stream');
const core = require('../報名機器人/lib/registration');
const command = require('../報名機器人/lib/line-command');
test('LINE webhook 實際回覆：代報列出編號，同名警告且不寫入', async () => {
  let state = core.mutate({}, { action:'setupTeam', fields:{name:'虛構測試團',date:'2026-10-06',startTime:'19:00',endTime:'21:00',location:'虛構球館',totalCapacity:6,guestFee:200,fixedFee:150,fixedMembers:[],frequency:'once'} }, {now:100,uid:'fake',eventId:'fake-event'}).current;
  const replies = []; let writes = 0;
  const ref = { once: async()=>({val:()=>state}), transaction:async callback=>{const next=callback(state);if(next!==undefined){state=next;writes++;}return{committed:next!==undefined,snapshot:{val:()=>state}};} };
  const module = {exports:{}};
  vm.runInNewContext(fs.readFileSync('報名機器人/api/webhook.js','utf8'), {module,Buffer,Date,process:{env:{LINE_CHANNEL_SECRET:'fake'}},require(name){
    if(name==='@line/bot-sdk') return {validateSignature:()=>true};
    if(name==='./_lib') return {db:{ref:()=>ref},LINE_GROUP_ID:'fake-group',lineClient:{replyMessage:async(token,message)=>replies.push(message.text)},buildRosterMessage:entries=>entries.map(entry=>entry.name).join('\n')};
    if(name==='../lib/registration')return core;
    if(name==='../lib/line-command')return command;
    throw new Error(name);
  }});
  async function send(text){const req=Readable.from([JSON.stringify({events:[{type:'message',message:{type:'text',text},source:{groupId:'fake-group'},replyToken:'fake-reply'}]})]);req.method='POST';req.headers={};const res={status(code){this.code=code;return this;},end(){},send(){}};await module.exports(req,res);assert.equal(res.code,200);}
  await send('小明+2');assert.match(replies[0],/小明1/);assert.match(replies[0],/小明2/);assert.equal(writes,1);
  await send('小明+2');assert.match(replies[1],/⚠️.*相同姓名/);assert.equal(writes,1);
  await send('小明1+1');assert.match(replies[2],/相同姓名/);assert.equal(writes,1);
});
