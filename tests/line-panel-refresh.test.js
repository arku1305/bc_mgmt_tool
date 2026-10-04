const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const bundle=process.env.BABEL_BUNDLE;
test('群組自動更新：進入、回到分頁、30秒；背景不輪詢，離開清除監聽與計時器',{skip:!bundle},async()=>{
 const effects=[],listeners={},timers=new Map();let requests=0,cleared=false;
 const document={visibilityState:'visible',addEventListener:(k,f)=>listeners[k]=f,removeEventListener:k=>delete listeners[k]};
 const window={addEventListener:(k,f)=>listeners[k]=f,removeEventListener:k=>delete listeners[k]};
 const context={require:name=>{assert.equal(name,'react/jsx-runtime');return{jsx:()=>null,jsxs:()=>null,Fragment:'fragment'};},React:{useState:v=>[v,()=>{}],useEffect:f=>effects.push(f),createElement:()=>null},window,document,location:{search:''},URLSearchParams,encodeURIComponent,
 firebase:{auth:()=>({currentUser:{getIdToken:async()=> 'fake-token'}})},fetch:async()=>{requests++;return{ok:true,json:async()=>({linked:true,groups:[],publications:[]})};},
 setInterval:(f,ms)=>{assert.equal(ms,30000);timers.set(1,f);return 1;},clearInterval:()=>{cleared=true;timers.clear();}};
 const {babelTransform}=require(bundle);vm.runInNewContext(babelTransform(fs.readFileSync('ranking/line-management-panel.jsx','utf8'),'line-management-panel.jsx',false,[],[]).code,context);
 context.LineManagementPanel({});const cleanup=effects[0]();const flush=()=>new Promise(resolve=>setImmediate(resolve));await flush();assert.equal(requests,1);
 timers.get(1)();await flush();assert.equal(requests,2);
 document.visibilityState='hidden';timers.get(1)();listeners.focus();await flush();assert.equal(requests,2);
 document.visibilityState='visible';listeners.visibilitychange();await flush();assert.equal(requests,3);
 cleanup();assert.equal(cleared,true);assert.deepEqual(Object.keys(listeners),[]);
});
