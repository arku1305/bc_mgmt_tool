const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const bundle=process.env.BABEL_BUNDLE;
test('管理選單隱藏停用模組、僅Admin可見權限管理，選擇後收起',{skip:!bundle},()=>{
 const {babelTransform}=require(bundle);let open=true,selected;
 const jsx=(type,props)=>({type,props});
 const c={React:{useState:()=>[open,v=>open=v]},require:()=>({jsx,jsxs:jsx,Fragment:'fragment'})};
 vm.runInNewContext(babelTransform(fs.readFileSync('ranking/management-menu.jsx','utf8'),'management-menu.jsx',false,[],[]).code,c);
 const walk=n=>!n||typeof n!=='object'?[]:Array.isArray(n)?n.flatMap(walk):[n,...walk(n.props?.children)];
 const render=role=>walk(c.ManagementMenu({role,access:{ranking:false,registration:true},view:'registration',onSelect:v=>selected=v,onLogout:()=>{}}));
 const organizer=render('organizer');assert(!organizer.some(n=>n.props?.children==='排點管理'));assert(!organizer.some(n=>n.props?.children==='權限管理'));assert(organizer.some(n=>n.props?.children==='登出'));
 assert(render('platformAdmin').some(n=>n.props?.children==='權限管理'));
 organizer.find(n=>n.props?.children==='報名管理').props.onClick();assert.equal(selected,'registration');assert.equal(open,false);
});
