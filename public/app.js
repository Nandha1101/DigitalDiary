(function(){
var MOODS=['😄','🙂','😐','😔','😴'],HL=['#fff176','#a5f3b5','#ffb8d9'],K=['y','p','b','g','torn'],
STK=['🎹','🌼','🌸','☕','🍞','⭐','🌙','💌','📷','✈️','🎧','🕯️','🍂','🐱','🌈','🌻'];
var entries=[],cur=null,warn='',timer=null,armed=false,sel=null,drag=null;
var $=function(id){return document.getElementById(id)};
function esc(s){return String(s).replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}

/* storage: our own server, with MongoDB behind it */
var me=null;
function api(method,url,body){
 var o={method:method,credentials:'same-origin',headers:{}};
 if(body!==undefined){o.headers['Content-Type']='application/json';o.body=JSON.stringify(body)}
 return fetch(url,o).then(function(r){return r.json().catch(function(){return{}}).then(function(j){
  if(!r.ok){var e=new Error(j.error||'Something went wrong.');e.status=r.status;throw e}return j})})}
function open(){return api('GET','/api/me').then(function(j){me=j.user}).catch(function(){me=null})}
function all(){return me?api('GET','/api/entries').then(function(j){return j.entries}).catch(function(){return[]}):Promise.resolve([])}
function put(e){return me?api('PUT','/api/entries/'+e.id,e).then(function(){return true},function(x){if(x.status===401){me=null;authUI()}return false}):Promise.resolve(false)}
function del(id){return me?api('DELETE','/api/entries/'+id).catch(function(){}):Promise.resolve()}

/* text safety: keep only line breaks and highlight colours */
function clean(h){var d=new DOMParser().parseFromString('<body>'+h,'text/html').body;return walk(d)}
function walk(n){var o='';n.childNodes.forEach(function(c){
 if(c.nodeType===3)o+=esc(c.nodeValue);
 else if(c.nodeType===1){var t=c.tagName,i=walk(c);
  if(t==='BR')o+='<br>';
  else if(t==='DIV'||t==='P')o+=(o&&!/<br>$/.test(o)?'<br>':'')+i;
  else{var b=c.style&&c.style.backgroundColor;
   if(b&&/^(rgb\(\d+, ?\d+, ?\d+\)|#[0-9a-f]{3,8})$/i.test(b))o+='<span style="background-color:'+b+'">'+i+'</span>';else o+=i}}});return o}
function tx(h){return new DOMParser().parseFromString(h.replace(/<br>/g,' '),'text/html').body.textContent}
function norm(e){
 if(!e.items){e.items=[];if(e.body)e.items.push({i:'t0',t:'text',x:.04,y:0,w:.92,h:esc(e.body).replace(/\n/g,'<br>'),r:0});
  (e.photos||[]).forEach(function(p,k){e.items.push({i:'p'+k,t:'photo',pid:p.id,src:p.src,cap:p.cap||'',x:.05+.45*(k%2),y:280+Math.floor(k/2)*270,w:.4,r:k%2?2:-2})});
  delete e.body;delete e.photos}
 e.items.forEach(function(it){if(it.t==='text'||it.t==='note')it.h=clean(it.h||'');if(it.t==='note'&&K.indexOf(it.k)<0)it.k='y'});
 return e}

function today(){var d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')}
function dt(s,o){var p=s.split('-');return new Date(+p[0],+p[1]-1,+p[2]).toLocaleDateString(undefined,o)}
function sorted(){return entries.slice().sort(function(a,b){return a.date<b.date?1:a.date>b.date?-1:b.updated-a.updated})}
function plain(e){return e.items.map(function(i){return i.t==='photo'?(i.cap||''):i.t==='sticker'?'':tx(i.h)}).join(' ')}
function first(e){for(var i=0;i<e.items.length;i++)if(e.items[i].t==='photo')return e.items[i].src}

function renderList(){
 var q=$('q').value.trim().toLowerCase(),l=sorted().filter(function(e){return!q||(e.title+' '+plain(e)).toLowerCase().indexOf(q)>-1});
 if(!l.length){$('list').innerHTML='<div class="empty">'+(entries.length?'No entries match your search.':'No entries yet. Tap “New entry” to start your first page.')+'</div>';return}
 var last='';
 $('list').innerHTML=l.map(function(e){var m=dt(e.date,{month:'long',year:'numeric'}),h=m!==last?(last=m,'<div class="mo">'+m+'</div>'):'',f=first(e);
  return h+'<button class="item'+(cur&&cur.id===e.id?' on':'')+'" data-id="'+e.id+'"><div class="thumb" '+(f?'style="background-image:url('+esc(f)+')"':'')+'>'+(f?'':esc(e.mood||'📝'))+'</div><div><b>'+esc(e.title||'Untitled')+'</b><small>'+dt(e.date,{weekday:'short',day:'numeric',month:'short'})+'</small><span class="sn">'+esc(plain(e).trim().slice(0,50))+'</span></div></button>'}).join('');
}

function renderMain(){
 var m=$('main');
 if(!cur){m.innerHTML='<div class="welcome"><h2>Your day, your page</h2><p>Start a new entry or open an old one from the list.</p></div>';return}
 m.innerHTML='<div class="bar"><button class="btn back" id="back">Back</button><span class="wd" id="wd">'+dt(cur.date,{weekday:'long'})+'</span>'+
  '<input type="date" id="date" value="'+cur.date+'" aria-label="Date">'+
  '<div class="moods" role="group" aria-label="Mood">'+MOODS.map(function(x){return '<button data-m="'+x+'" aria-pressed="'+(cur.mood===x)+'">'+x+'</button>'}).join('')+'</div><span class="status" id="status">Saved</span></div>'+
  '<input class="title" id="title" placeholder="Give this day a title" value="'+esc(cur.title)+'">'+
  '<div class="tools" id="tools"><button class="btn" data-a="text">Text</button><button class="btn" data-a="photo">Photo</button><button class="btn" data-a="y">Sticky note</button><button class="btn" data-a="torn">Torn paper</button><button class="btn" data-a="stk">Stickers</button>'+
  '<span class="sws">Highlight '+HL.map(function(c){return '<button class="sw" data-h="'+c+'" style="background:'+c+'" aria-label="Highlight selected text"></button>'}).join('')+'<button class="sw" data-h="transparent" style="background:#fff" aria-label="Remove highlight">×</button></span></div>'+
  '<div class="tray" id="tray" hidden>'+STK.map(function(s){return '<button data-e="'+s+'" aria-label="Add sticker">'+s+'</button>'}).join('')+'</div>'+
  '<div class="cv" id="cv"></div><div class="actions"><button class="btn danger" id="del">'+(armed?'Tap again to delete':'Delete entry')+'</button></div>';
 renderCv();
}
function itHTML(it){
 var st='style="left:'+it.x*100+'%;top:'+it.y+'px;width:'+it.w*100+'%;transform:rotate('+(it.r||0)+'deg)"',b;
 if(it.t==='text')b='<i class="hd">⠿</i><div class="ed" contenteditable="true" spellcheck="false">'+it.h+'</div>';
 else if(it.t==='note')b='<i class="hd tp"></i><div class="ed" contenteditable="true" spellcheck="false">'+it.h+'</div>';
 else if(it.t==='photo')b='<i class="tp"></i><img src="'+esc(it.src)+'" alt="Diary photo"><input class="cap" value="'+esc(it.cap||'')+'" placeholder="Write about this memory">';
 else b='<span class="stk">'+esc(it.e)+'</span>';
 return '<div class="it '+it.t+(it.t==='note'?' k-'+it.k:'')+(sel===it.i?' sel':'')+'" data-i="'+it.i+'" '+st+'>'+b+'<i class="rz"></i></div>'}
function renderCv(){
 $('cv').innerHTML=cur.items.map(itHTML).join('')+'<div class="ctl" id="ctl" hidden><button data-c="l" aria-label="Rotate left">↺</button><button data-c="r" aria-label="Rotate right">↻</button><button data-c="k">Color</button><button data-c="x">Remove</button></div>';
 fit();place();
}
function find(i){return cur.items.filter(function(x){return x.i===i})[0]}
function fit(){var cv=$('cv');if(!cv)return;var m=700;cv.querySelectorAll('.it').forEach(function(e){m=Math.max(m,e.offsetTop+e.offsetHeight+160)});cv.style.height=m+'px'}
function bottom(){var m=0;document.querySelectorAll('#cv .it').forEach(function(e){m=Math.max(m,e.offsetTop+e.offsetHeight)});return m}
function place(){var c=$('ctl');if(!c)return;var el=sel&&document.querySelector('.it[data-i="'+sel+'"]');
 if(!el){c.hidden=true;return}var it=find(sel);c.hidden=false;c.querySelector('[data-c=k]').hidden=it.t!=='note';
 c.style.left=Math.max(0,el.offsetLeft)+'px';c.style.top=(el.offsetTop<48?el.offsetTop+el.offsetHeight+8:el.offsetTop-44)+'px'}
function select(id){if(sel===id)return;sel=id;document.querySelectorAll('.it').forEach(function(e){e.classList.toggle('sel',e.dataset.i===id)});place()}

function queue(){if(!cur)return;var s=$('status');if(s)s.textContent='Saving…';clearTimeout(timer);timer=setTimeout(save,500)}
function save(){
 if(!cur)return;cur.updated=Date.now();
 if(!entries.some(function(e){return e.id===cur.id}))entries.push(cur);
 put(cur).then(function(ok){var s=$('status');if(s)s.textContent=ok?(warn||'Saved'):'Not saved. Check your connection and keep this tab open.';warn=''});
 renderList();
}
function shrink(file){return new Promise(function(res){
 var r=new FileReader();
 r.onload=function(){var im=new Image();
  im.onload=function(){var s=Math.min(1,1280/Math.max(im.width,im.height)),c=document.createElement('canvas');
   c.width=Math.round(im.width*s);c.height=Math.round(im.height*s);c.getContext('2d').drawImage(im,0,0,c.width,c.height);
   c.toBlob(function(b){if(!b)return res(null);fetch('/api/photos',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'image/jpeg'},body:b}).then(function(r){return r.ok?r.json():null}).then(function(u){res(u?{id:u.id,src:u.url}:null)},function(){res(null)})},'image/jpeg',.8)};
  im.onerror=function(){res(null)};im.src=r.result};
 r.onerror=function(){res(null)};r.readAsDataURL(file)})}

function uid(){return 'i'+Date.now().toString(36)+Math.floor(Math.random()*1e4)}
function rnd(a){return Math.round((Math.random()*2-1)*a*10)/10}
function pos(){var n=cur.items.length;return{x:.08+(n%5)*.06,y:40+(n%6)*60}}
function add(it,quiet){it.i=uid();cur.items.push(it);sel=it.i;if(!quiet){renderCv();queue();var e=document.querySelector('.it[data-i="'+it.i+'"] .ed');if(e)e.focus()}return it}
function openEntry(id){save();armed=false;sel=null;cur=entries.find(function(e){return e.id===id})||null;document.body.classList.add('edit');renderMain();renderList();window.scrollTo(0,0)}
function newEntry(){
 save();armed=false;sel=null;
 cur={id:'e'+Date.now(),date:today(),mood:'',title:'',items:[{i:'t0',t:'text',x:.04,y:0,w:.92,h:'',r:0}],updated:Date.now()};
 document.body.classList.add('edit');renderMain();renderList();var e=document.querySelector('.ed');if(e)e.focus();
}

document.addEventListener('mousedown',function(ev){if(ev.target.closest&&ev.target.closest('#tools,#ctl')&&ev.target.closest('button'))ev.preventDefault()});
document.addEventListener('click',function(ev){
 var t=ev.target,d=t.dataset||{},it=t.closest&&t.closest('.item');
 if(t.id==='new')return newEntry();
 if(it)return openEntry(it.dataset.id);
 if(d.x)return acct(d.x);
 if(t.id==='back'){save();document.body.classList.remove('edit');return}
 if(!cur)return;
 if(d.m!==undefined){cur.mood=cur.mood===d.m?'':d.m;document.querySelectorAll('.moods button').forEach(function(b){b.setAttribute('aria-pressed',cur.mood===b.dataset.m)});return queue()}
 if(d.a){
  if(d.a==='photo')return $('file').click();
  if(d.a==='stk'){$('tray').hidden=!$('tray').hidden;return}
  if(d.a==='text')return add({t:'text',x:.04,y:cur.items.length?Math.ceil((bottom()+20)/34)*34:0,w:.92,h:'',r:0});
  return add(Object.assign({t:'note',k:d.a,w:.42,h:'',r:rnd(3)},pos()));
 }
 if(d.e){$('tray').hidden=true;return add(Object.assign({t:'sticker',e:d.e,w:.18,r:rnd(8)},pos()))}
 if(d.h){var a=document.activeElement;
  if(a&&a.classList&&a.classList.contains('ed')){document.execCommand('hiliteColor',false,d.h);find(a.closest('.it').dataset.i).h=clean(a.innerHTML);queue()}
  return}
 if(d.c&&sel){var s=find(sel),el=document.querySelector('.it[data-i="'+sel+'"]');
  if(d.c==='x'){cur.items=cur.items.filter(function(x){return x.i!==sel});sel=null;renderCv();return queue()}
  if(d.c==='k'){el.classList.remove('k-'+s.k);s.k=K[(K.indexOf(s.k)+1)%K.length];el.classList.add('k-'+s.k)}
  else{s.r=(s.r||0)+(d.c==='l'?-4:4);el.style.transform='rotate('+s.r+'deg)'}
  fit();place();return queue()}
 if(t.id==='del'){
  if(!armed){armed=true;t.textContent='Tap again to delete';return}
  var id=cur.id;entries=entries.filter(function(e){return e.id!==id});del(id);cur=null;armed=false;sel=null;
  document.body.classList.remove('edit');renderMain();renderList()}
});
document.addEventListener('pointerdown',function(ev){
 var cv=$('cv'),t=ev.target;if(!cv||!cv.contains(t))return;
 var el=t.closest('.it');if(!el){select(null);return}
 select(el.dataset.i);var it=find(el.dataset.i),
 mode=t.classList.contains('rz')?'rz':(t.closest('.hd')||((it.t==='photo'||it.t==='sticker')&&t.tagName!=='INPUT'))?'mv':null;
 if(!mode)return;ev.preventDefault();
 drag={m:mode,it:it,el:el,sx:ev.clientX,sy:ev.clientY,x:it.x,y:it.y,w:it.w,cw:cv.clientWidth};
});
document.addEventListener('pointermove',function(ev){
 if(!drag)return;var dx=(ev.clientX-drag.sx)/drag.cw,dy=ev.clientY-drag.sy,it=drag.it,s=drag.el.style;
 if(drag.m==='mv'){it.x=Math.min(Math.max(drag.x+dx,-.03),Math.max(1.03-it.w,-.03));it.y=Math.max(0,drag.y+dy)}
 else it.w=Math.min(Math.max(drag.w+dx,.1),1.03-it.x);
 s.left=it.x*100+'%';s.top=it.y+'px';s.width=it.w*100+'%';place();
});
document.addEventListener('pointerup',function(){
 if(!drag)return;var it=drag.it;
 if(drag.m==='mv'&&it.t==='text'){it.y=Math.round(it.y/34)*34;drag.el.style.top=it.y+'px'}
 drag=null;fit();place();queue();
});
document.addEventListener('input',function(ev){
 var t=ev.target;if(!t.classList)return;
 if(t.classList.contains('ed')){find(t.closest('.it').dataset.i).h=clean(t.innerHTML);fit();place();return queue()}
 if(t.classList.contains('cap')){find(t.closest('.it').dataset.i).cap=t.value;return queue()}
 if(t.id==='q')return renderList();
 if(!cur)return;
 if(t.id==='title')cur.title=t.value;
 else if(t.id==='date'&&t.value){cur.date=t.value;$('wd').textContent=dt(t.value,{weekday:'long'})}
 else return;
 queue();
});
document.addEventListener('paste',function(ev){var t=ev.target;if(t.classList&&t.classList.contains('ed')){ev.preventDefault();document.execCommand('insertText',false,(ev.clipboardData||window.clipboardData).getData('text'))}});
document.addEventListener('load',function(ev){if(ev.target.tagName==='IMG'){fit();place()}},true);
$('file').addEventListener('change',function(){
 var fs=Array.prototype.slice.call(this.files);this.value='';if(!cur||!fs.length)return;
 var s=$('status');if(s)s.textContent='Adding photos…';
 Promise.all(fs.map(shrink)).then(function(r){
  r.forEach(function(p){if(p)add(Object.assign({t:'photo',pid:p.id,src:p.src,cap:'',w:.42,r:rnd(3)},pos()),true)});
  if(r.some(function(p){return!p}))warn='Some photos could not be added';renderCv();queue()});
});
window.addEventListener('pagehide',save);
/* accounts */
var mode='login',cfg={invite:false};
function authUI(){
 var su=mode==='signup';
 $('auth').hidden=!!me;$('acct').hidden=!me;
 $('authTitle').textContent=su?'Create your diary':'Welcome back';
 $('authGo').textContent=su?'Create account':'Log in';
 $('authMode').textContent=su?'I already have an account':'New here? Create an account';
 $('icWrap').hidden=!(su&&cfg.invite);
 $('pw').setAttribute('autocomplete',su?'new-password':'current-password');
 if(me)$('acct').innerHTML='<span>'+esc(me.email)+'</span><button class="btn" data-x="backup">Backup</button><button class="btn" data-x="out">Log out</button><button class="btn danger" data-x="gone">Delete account</button>';
}
function reset(){me=null;mode='login';entries=[];cur=null;sel=null;document.body.classList.remove('edit');renderList();renderMain();authUI()}
function acct(x){
 if(x==='mode'){mode=mode==='login'?'signup':'login';$('autherr').textContent='';return authUI()}
 if(x==='backup')return fetch('/api/export',{credentials:'same-origin'}).then(function(r){return r.blob()}).then(function(b){var a=document.createElement('a');a.href=URL.createObjectURL(b);a.download='diary-backup.json';document.body.appendChild(a);a.click();a.remove()});
 if(x==='out')return api('POST','/api/logout').catch(function(){}).then(reset);
 if(x==='cancel')return authUI();
 if(x==='gone')$('acct').innerHTML='<span>Type your password to delete your account and everything in it. This cannot be undone.</span><input id="dpw" class="search" type="password" autocomplete="current-password" placeholder="Password"><button class="btn danger" data-x="gone2">Delete everything</button><button class="btn" data-x="cancel">Cancel</button>';
 if(x==='gone2')api('DELETE','/api/me',{password:$('dpw').value}).then(reset,function(e){$('acct').querySelector('span').textContent=e.message});
}
$('authForm').addEventListener('submit',function(ev){
 ev.preventDefault();$('autherr').textContent='';
 api('POST','/api/'+(mode==='login'?'login':'signup'),{email:$('em').value,password:$('pw').value,code:$('ic').value})
  .then(function(j){me=j.user;$('pw').value='';return all()})
  .then(function(r){entries=r.map(norm);cur=null;renderList();renderMain();authUI()})
  .catch(function(e){$('autherr').textContent=e.message});
});
function boot(){
 fetch('/api/config').then(function(r){return r.json()}).then(function(j){cfg=j;authUI()}).catch(function(){});
 open().then(all).then(function(r){entries=r.map(norm);renderList();renderMain();authUI()});
}
boot();
})();
