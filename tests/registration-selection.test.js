const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const bundle=process.env.BABEL_BUNDLE;
function fixture(uid,saved,unavailable=false){
 const state=[],effects=[];let cursor=0;const storage=new Map(Object.entries(saved));
 const context={React:{useState:v=>{const i=cursor++;if(!(i in state))state[i]=typeof v==='function'?v():v;return[state[i],n=>state[i]=n];},useEffect:f=>effects.push(f)},require:()=>({jsx:()=>null,jsxs:()=>null,Fragment:'fragment'}),window:{ROSTER_API_URL:'https://signup.test'},firebase:{auth:()=>({currentUser:{uid,getIdToken:async()=> 'test'}})},localStorage:{getItem:k=>{if(unavailable)throw Error('blocked');return storage.get(k);},setItem:(k,v)=>{if(unavailable)throw Error('blocked');storage.set(k,v);}},fetch:async()=>({ok:true,json:async()=>({clubs:[{clubId:'club-a',name:'測試團'}]})}),URL,URLSearchParams,encodeURIComponent};
 const {babelTransform}=require(bundle);vm.runInNewContext(babelTransform(fs.readFileSync('ranking/club-registration-panel.jsx','utf8'),'club-registration-panel.jsx',false,[],[]).code,context);
 const render=()=>{cursor=0;effects.length=0;context.ClubRegistrationAdmin({onImport:()=>{}});};
 return{state,storage,render,async restore(){render();effects[1]();assert.equal(storage.get('registrationSelection:'+uid),saved['registrationSelection:'+uid]);effects[0]();await new Promise(r=>setImmediate(r));render();effects[1]();}};
}
test('切換模組重新掛載後恢復本人球團及活動，不以初始空值覆寫記錄',{skip:!bundle},async()=>{
 const saved={'registrationSelection:leader':JSON.stringify({clubId:'club-a',eventId:'event-a'})};const f=fixture('leader',saved);await f.restore();assert.equal(f.state[1],'club-a');assert.equal(f.state[2],'event-a');assert.deepEqual(JSON.parse(f.storage.get('registrationSelection:leader')),{clubId:'club-a',eventId:'event-a'});
});
test('不恢復已刪除或不屬於目前帳號的球團，也不跨帳號套用',{skip:!bundle},async()=>{
 const f=fixture('leader',{'registrationSelection:leader':JSON.stringify({clubId:'deleted',eventId:'old'})});await f.restore();assert.equal(f.state[1],'');
 const other=fixture('other',{'registrationSelection:leader':JSON.stringify({clubId:'club-a',eventId:'event-a'})});await other.restore();assert.equal(other.state[1],'');
});
test('localStorage被封鎖時仍可載入球團，不拋錯',{skip:!bundle},async()=>{const f=fixture('leader',{},true);await f.restore();assert.equal(f.state[1],'');assert.equal(f.state[3],true);});
