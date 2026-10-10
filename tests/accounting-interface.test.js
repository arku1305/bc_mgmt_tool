const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const view=require('../ranking/accounting-view');
const bundle=process.env.BABEL_BUNDLE;
const walk=n=>!n||typeof n!=='object'?[]:Array.isArray(n)?n.flatMap(walk):[n,...walk(n.props?.children)];
function fixture(files,values=[],fetchImpl){
 let cursor=0;const state=values,effects=[];
 const jsx=(type,props)=>({type,props});
 const context={React:{useState:v=>{const i=cursor++;if(!(i in state))state[i]=typeof v==='function'?v():v;return[state[i],n=>state[i]=n];},useEffect:f=>effects.push(f)},require:()=>({jsx,jsxs:jsx,Fragment:'fragment'}),window:{ROSTER_API_URL:'http://preview.test'},firebase:{auth:()=>({currentUser:{uid:'leader',getIdToken:async()=> 'test'}})},AccountingView:view,fetch:fetchImpl,URL,URLSearchParams,encodeURIComponent,confirm:()=>true};
 const {babelTransform}=require(bundle);
 for(const [name,source] of files)vm.runInNewContext(babelTransform(source,name,false,[],[]).code,context);
 return{context,state,effects,render(name,props){cursor=0;effects.length=0;return walk(context[name](props));},reset(){state.length=0;cursor=0;effects.length=0;}};
}
test('總結餘保留全帳；明細按日期及分類篩選，20筆分頁，作廢不計入',()=>{
 const records=Array.from({length:45},(_,i)=>({id:'r'+i,title:'晚場',date:i<25?'2026-10-10':'2026-10-09',updatedAt:i,entries:[{name:'臨打'+i,type:'income',category:'臨打費',amountCents:10000}]}));
 records.push({id:'void',title:'刪除',date:'2026-10-10',updatedAt:99,voidedAt:99,entries:[{name:'作廢',type:'income',category:'臨打費',amountCents:99999}]});
 const first=view.statement(records);assert.equal(first.count,45);assert.equal(first.rows.length,20);assert.equal(first.total.income,450000);assert.equal(first.pages,3);
 const last=view.statement(records,{page:3});assert.equal(last.rows.length,5);assert.equal(last.total.income,450000);
 const filtered=view.statement(records,{from:'2026-10-10',to:'2026-10-10',query:'臨打費'});assert.equal(filtered.count,25);assert.equal(filtered.total.income,250000);
 const shown=view.statement(records,{showVoided:true});assert.equal(shown.count,45);assert.equal(shown.total.income,450000);
 assert.equal(view.statement(records,{page:9,query:'不存在'}).page,1);
});
test('目前排點來源跟隨場次；獨立排點不強迫報名，活動綁定可恢復來源',()=>{
 assert.deepEqual(view.rankingSource({clubId:'club-a',eventId:'event-a'},null),{kind:'ranking',clubId:'club-a',eventId:'event-a'});
 assert.deepEqual(view.rankingSource(null,{teamId:'club-b',eventId:'event-b'}),{kind:'ranking',clubId:'club-b',eventId:'event-b'});
 assert.deepEqual(view.rankingSource(null,null),{kind:'ranking'});
});
test('球團已結束活動直接選擇匯入排點或帳務，正確傳遞原場次；停用入口隱藏',{skip:!bundle},()=>{
 const data={name:'球團',publicToken:'share',events:[{eventId:'past',eventTime:'10/1 20:00',ended:true}],series:[]};
 const f=fixture([['club-registration-panel.jsx',fs.readFileSync('ranking/club-registration-panel.jsx','utf8')]],[[], 'club-a','',true,data]);let accounting,ranking;
 const props={onAccounting:s=>accounting=s,onImport:s=>ranking=s};
 const nodes=f.render('ClubRegistrationAdmin',props);
 nodes.find(n=>n.type==='button'&&n.props.children==='匯入帳務').props.onClick();
 assert.deepEqual(JSON.parse(JSON.stringify(accounting)),{kind:'registration',clubId:'club-a',eventId:'past'});
 nodes.find(n=>n.type==='button'&&n.props.children==='匯入排點').props.onClick();assert.equal(ranking.eventId,'past');
 assert(!f.render('ClubRegistrationAdmin',{onImport:props.onImport,canImportRanking:false}).some(n=>n.type==='button'&&String(n.props.children).includes('匯入')));
});
test('排點頁有收入匯入按鈕，一般球友及停用帳務看不到',{skip:!bundle},()=>{
 const source=fs.readFileSync('ranking/main.js','utf8');const top=source.slice(source.indexOf('function TopBar('),source.indexOf('function QRIcon('));
 const f=fixture([['top.jsx',top]]);f.context.QRIcon=()=>null;let clicked=false;
 const props={role:'admin',theme:'minimal',accent:'#8ff3b5',onAccountingImport:()=>clicked=true,eventInfo:{}};
 const nodes=f.render('TopBar',props);nodes.find(n=>n.type==='button'&&n.props.children==='匯入帳務').props.onClick();assert(clicked);
 assert(!f.render('TopBar',{...props,role:'player'}).some(n=>n.type==='button'&&n.props.children==='匯入帳務'));
 assert(!f.render('TopBar',{...props,onAccountingImport:undefined}).some(n=>n.type==='button'&&n.props.children==='匯入帳務'));
});
test('從來源開確認視窗：讀取正確活動、預覽不寫入，調整人員金額及新增後才確認入帳',{skip:!bundle},async()=>{
 const requests=[],source={kind:'registration',clubId:'club-a',eventId:'event-a'};
 const preview={id:'event-a',title:'活動',date:'2026-10-01',fingerprint:'source-v1',entries:[{name:'臨打甲',type:'income',category:'臨打費',amount:200,include:false,note:''},{name:'臨打乙',type:'income',category:'臨打費',amount:200,include:false,note:''}]};
 const fetchImpl=async(url,options)=>{const body=options.body?JSON.parse(options.body):null;requests.push(body);return{ok:true,json:async()=>body?.action==='preview'?preview:{records:[],revision:'ledger-v1',totals:{}}};};
 const f=fixture([['accounting-panel.jsx',fs.readFileSync('ranking/accounting-panel.jsx','utf8')]],[],fetchImpl);
 let saved=false,closed=false;
 f.render('AccountingImportDialog',{source,onSaved:()=>{},onClose:()=>{}});f.effects[0]();await new Promise(r=>setImmediate(r));
 assert.equal(requests.length,2);assert.deepEqual(requests[1].source,source);
 const editor=f.render('AccountingImportDialog',{source,onSaved:()=>{},onClose:()=>{}}).find(n=>n.type===f.context.AccountingEditor);
 assert(editor);f.reset();
 const props={initial:editor.props.initial,onSaved:()=>saved=true,onClose:()=>closed=true};
 let nodes=f.render('AccountingEditor',props);
 const select=()=>f.render('AccountingEditor',props);
 assert(!nodes.some(n=>n.type==='input'&&n.props.type==='checkbox'));
 nodes=select();nodes.find(n=>n.props?.['aria-label']==='明細名稱 1').props.onChange({target:{value:'修改姓名'}});
 nodes=select();nodes.find(n=>n.props?.['aria-label']==='金額 1').props.onChange({target:{value:'180'}});
 nodes=select();nodes.find(n=>n.props?.['aria-label']==='移除 臨打乙').props.onClick();
 nodes=select();nodes.find(n=>n.type==='button'&&n.props.children==='新增人員').props.onClick();
 nodes=select();nodes.find(n=>n.props?.['aria-label']==='明細名稱 2').props.onChange({target:{value:'人工丙'}});
 nodes=select();nodes.find(n=>n.props?.['aria-label']==='金額 2').props.onChange({target:{value:'100'}});
 nodes=select();assert.equal(requests.length,2);
 nodes=select();const save=nodes.find(n=>n.type==='button'&&n.props.children==='確認正式入帳');assert.equal(save.props.disabled,false);await save.props.onClick();
 assert(saved);assert(!closed);assert.equal(requests[2].expectedRevision,'ledger-v1');assert.equal(requests[2].fingerprint,'source-v1');assert.equal(requests[2].entries.length,2);assert.equal(requests[2].entries[0].name,'修改姓名');assert.equal(requests[2].entries[0].amount,'180');assert.equal(requests[2].entries[1].name,'人工丙');
});

test('報名頁選單分兩列、無可見標題；固定刪除保留請假操作、連結緊接 LINE 且使用圖示', {skip:!bundle},()=>{
 const data={name:'球團',publicToken:'share',events:[{eventId:'active',ended:false}],series:[],activity:{date:'2099-10-01',eventId:'active',endTime:'22:00',registrationOpen:true},fixed:[{name:'固定甲',leaveCount:2}],guests:[{name:'臨打乙'}]};
 const f=fixture([['club-registration-panel.jsx',fs.readFileSync('ranking/club-registration-panel.jsx','utf8')]],[[], 'club-a','active',true,data]);
 f.context.window.LINE_INTEGRATION_V2=true;f.context.LineManagementPanel=()=>null;f.context.CopyIcon=()=>null;f.context.DeleteIcon=()=>null;
 const nodes=f.render('ClubRegistrationAdmin',{onImport:()=>{},onAccounting:()=>{}});
 const team=nodes.find(n=>n.type==='select'&&n.props['aria-label']==='我的球團');const activity=nodes.find(n=>n.type==='select'&&n.props['aria-label']==='活動');
 const rowTeam=nodes.find(n=>n.type==='div'&&Array.isArray(n.props.children)&&n.props.children.includes(team));const rowEvent=nodes.find(n=>n.type==='div'&&Array.isArray(n.props.children)&&n.props.children.includes(activity));assert(rowTeam&&rowEvent&&rowTeam!==rowEvent);
 const deletes=nodes.filter(n=>n.type==='button'&&String(n.props['aria-label']).startsWith('刪除'));assert.equal(deletes.length,2);assert(deletes.every(n=>n.props.children.type===f.context.DeleteIcon));
 assert.equal(nodes.find(n=>n.props?.['aria-label']==='活動成員名單').props.style.gridTemplateColumns,'repeat(2,minmax(0,1fr))');
 assert(nodes.findIndex(n=>n.type===f.context.LineManagementPanel)<nodes.findIndex(n=>n.type==='h2'&&n.props.children==='球友報名連結'));
 const copy=nodes.find(n=>n.type==='button'&&n.props['aria-label']==='複製球友報名連結');assert.equal(copy.props.children.type,f.context.CopyIcon);
 assert(nodes.some(n=>n.type==='input'&&n.props['aria-label']==='臨打姓名'));
});
