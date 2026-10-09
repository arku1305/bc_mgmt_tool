const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function fixture(){
 const nodes=new Map();const node=id=>{if(!nodes.has(id))nodes.set(id,{id,value:'',style:{},classList:{toggle(){}},after(child){nodes.set(child.id,child);}});return nodes.get(id);};
 let status={eventId:'week-one',teamName:'虛構週團',eventTime:'2026-10-13 20:00–22:00',registrationOpen:true,maxSlots:16,remaining:10},sent=[],confirmed=[];
 const context={URLSearchParams,location:{search:'?team=fake&series=series-one',reload(){}},window:{location:{origin:'http://preview.test'}},document:{getElementById:id=>id==='refresh-event'?nodes.get(id):node(id),querySelectorAll:()=>[],createElement:()=>({})},setInterval(){},confirm(text){confirmed.push(text);return true;},fetch:async(url,options)=>{if(options?.method==='POST'){sent.push(JSON.parse(options.body));return{ok:true,json:async()=>({success:true})};}return{ok:true,json:async()=>status};}};
 const source=fs.readFileSync('報名機器人/index.html','utf8').match(/<script>([\s\S]*?)<\/script>/)[1];vm.runInNewContext(source,context);
 return {context,node,sent,confirmed,setStatus(value){status={...status,...value};}};
}
test('固定入口填寫時换場須重新確認，禁止送出原內容到下一場',async()=>{
 const f=fixture();await f.context.fetchStatus();f.node('signup-name').value='虛構球友';f.node('signup-phone').value='0912345678';
 f.setStatus({eventId:'week-two',eventTime:'2026-10-20 20:00–22:00'});await f.context.fetchStatus();
 assert.match(f.node('msg').textContent,/活動已換場/);assert.equal(f.node('form-signup').style.display,'none');assert.ok(f.node('refresh-event').onclick);
 await f.context.doSignup();assert.equal(f.sent.length,0);assert.equal(f.node('signup-name').value,'虛構球友');
});
test('固定入口報名確認日期，提交明確場次與系列，不在提交時自動換場',async()=>{
 const f=fixture();await f.context.fetchStatus();f.node('signup-name').value='虛構球友';f.node('signup-phone').value='0912345678';await f.context.doSignup();
 assert.match(f.confirmed[0],/2026-10-13/);assert.equal(f.sent[0].eventId,'week-one');assert.equal(f.sent[0].series,'series-one');
});
