// Page scripts ported from jev-ultrafast 1231850a snapshot.js and browser.py (MIT, third_party/jev-ultrafast).

/** Fields never offered for typing: a password, a card, a security or one-time code, a key or token. */
const SECRET_FIELD = String.raw`/password|passwd|passcode|pwd|senha|\botp\b|one.?time|2fa|mfa|security.?code|c[oó]digo.?de.?seguran|verif\w*.?code|\bcvc\b|\bcvv\b|card.?num|cc.?num|n[uú]mero.?do.?cart|api.?key|access.?token|secret|chave.?(?:de.?)?api|chave.?pix/i`;
const SECRET_AUTOCOMPLETE = String.raw`/(?:^|\s)(?:current-password|new-password|one-time-code|cc-number|cc-csc|cc-exp(?:-month|-year)?)(?:\s|$)/i`;

/** Reads visible text and controls in one pass, keeping real DOM identity in window.__jevFast. */
export const READ_STATE = String.raw`(() => {
  if (!document.body) return null;
  const cache = window.__jevFast ||= {ids:new WeakMap(), nodes:new Map(), next:1};
  const identity = e => {
    if (!cache.ids.has(e)) cache.ids.set(e,cache.next++);
    const id=cache.ids.get(e); cache.nodes.set(id,e); return id;
  };
  for (const [id,e] of cache.nodes) if (!e.isConnected) cache.nodes.delete(id);
  const SECRET=${SECRET_FIELD}, AUTO=${SECRET_AUTOCOMPLETE};
  const secret = e => ['INPUT','TEXTAREA'].includes(e.tagName) && (AUTO.test(e.getAttribute('autocomplete')||'') ||
    SECRET.test([e.name,e.id,e.getAttribute('aria-label'),e.getAttribute('placeholder'),
      [...(e.labels||[])].map(l=>l.textContent).join(' ')].join(' ')));
  const safe = e => !['password','file','hidden'].includes(e.type) && !secret(e);
  const visible = e => !e.closest('[aria-hidden="true"],[inert]') &&
    e.checkVisibility({checkOpacity:true,checkVisibilityCSS:true});
  const name = (e,seen=new Set()) => {
    if (!e || seen.has(e)) return '';
    seen.add(e);
    const referenced=(e.getAttribute('aria-labelledby')||'').split(/\s+/)
      .map(id=>name(document.getElementById(id),seen)).filter(Boolean).join(' ');
    return referenced || e.getAttribute('aria-label') ||
      [...(e.labels||[])].map(l=>name(l,seen)).filter(Boolean).join(' ') ||
      (['button','submit','reset'].includes(e.type) ? e.value : '') || e.getAttribute('alt') ||
      (e.tagName==='INPUT' ? '' : [...e.childNodes].map(n=>n.nodeType===3 ? n.textContent :
        n.nodeType===1 && n.getAttribute('aria-hidden')!=='true' ? name(n,seen) : '').join(' ').trim()) ||
      e.getAttribute('title') || e.getAttribute('placeholder') || '';
  };
  const roles=['button','link','checkbox','radio','switch','tab','menuitem','menuitemradio',
    'option','gridcell','combobox','textbox','searchbox','spinbutton'];
  const selector='a[href],button,input,textarea,select,summary,[contenteditable="true"],'+
    roles.map(role=>'[role="'+role+'"]').join(',');
  const role = e => {
    const explicit=e.getAttribute('role');
    if (roles.includes(explicit)) return explicit;
    if (e.tagName==='BUTTON' || e.tagName==='SUMMARY') return 'button';
    if (e.tagName==='A') return 'link';
    if (e.tagName==='SELECT') return 'combobox';
    if (e.tagName==='TEXTAREA' || e.isContentEditable) return 'textbox';
    if (e.tagName==='INPUT') {
      if (['checkbox','radio'].includes(e.type)) return e.type;
      if (['button','submit','reset','image'].includes(e.type)) return 'button';
      if (e.type==='search') return 'searchbox';
      if (e.type==='number') return 'spinbutton';
      if (['text','email','url','tel','date'].includes(e.type) || !e.getAttribute('type')) return 'textbox';
    }
    return null;
  };
  const digest=s=>{let h=0;for(let i=0;i<s.length;i++)h=(h*31+s.charCodeAt(i))|0;return s.length+':'+h;};
  const inputs=()=>[...document.querySelectorAll('input,textarea,select')].filter(safe)
    .map(e=>[identity(e),e.value,e.checked,e.selectedIndex,e.disabled,e.readOnly]);
  cache.pageKey=()=>digest(JSON.stringify([performance.timeOrigin,location.href,scrollX,scrollY,innerWidth,innerHeight,inputs()]));
  cache.guard=e=>{
    if (!e?.isConnected || !visible(e)) return null;
    const scope=e.closest('form,dialog,[role="dialog"],article,li,tr,[role="row"]') || e.parentElement;
    return digest(JSON.stringify([identity(e),role(e),name(e),e.value??null,e.checked??null,e.selectedIndex??null,
      e.readOnly??null,e.matches(':disabled'),e.getAttribute('aria-disabled'),
      e.getAttribute('aria-expanded'),e.getAttribute('aria-checked'),e.getAttribute('aria-selected'),
      e.getAttribute('href'),scope?.innerText||'']));
  };
  const actions=[];
  for (const e of document.querySelectorAll(selector)) {
    if (!safe(e) || !visible(e) || e.matches(':disabled') || e.closest('[aria-disabled="true"]')) continue;
    const r=e.getBoundingClientRect(), x=r.x+r.width/2, y=r.y+r.height/2, rname=role(e);
    if (!rname || r.width<=0 || r.height<=0 || x<0 || y<0 || x>=innerWidth || y>=innerHeight) continue;
    if (rname==='gridcell' && e.querySelector('button,[role="button"]')) continue;
    const base={node:identity(e),role:rname,label:(name(e)||rname).replace(/\s+/g,' ').trim().slice(0,160),
      href:e.tagName==='A' ? e.href.slice(0,300) : undefined};
    for (const key of ['checked','selected','expanded']) {
      const value=e.getAttribute('aria-'+key);
      if (value!==null) base[key]=value;
    }
    if (['checkbox','radio'].includes(e.type)) base.checked=String(e.checked);
    if (e.tagName==='SELECT') {
      for (const o of e.options) if (!o.selected && !o.disabled && !o.closest('optgroup[disabled]'))
        actions.push({...base,kind:'select',value:o.value,
          current_value:[...e.selectedOptions].map(o=>o.label).join(', '),label:base.label+' → '+o.label});
    } else {
      const editable=!e.readOnly && e.getAttribute('aria-readonly')!=='true' &&
        (['textbox','searchbox','spinbutton'].includes(rname) ||
          (rname==='combobox' && ['INPUT','TEXTAREA'].includes(e.tagName)));
      const value='value' in e ? String(e.value) :
        e.isContentEditable || rname==='combobox' ? e.innerText.trim() : '';
      actions.push({...base,kind:editable?'fill':'click',value:value.slice(0,300)});
      if (editable) actions.push({...base,kind:'click',value:value.slice(0,300),label:'Open '+base.label});
    }
  }
  const words=[], walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
  const range=document.createRange(); let node,length=0;
  while ((node=walker.nextNode()) && length<6000) {
    const value=node.textContent.trim(), parent=node.parentElement;
    if (!value || !parent || parent.closest('script,style,noscript,template') || !visible(parent)) continue;
    range.selectNodeContents(node); const r=range.getBoundingClientRect();
    if (r.width>0 && r.height>0 && r.bottom>0 && r.top<innerHeight && r.right>0 && r.left<innerWidth) {
      words.push(value); length+=value.length;
    }
  }
  const text=words.join('\n').slice(0,6000), height=document.documentElement.scrollHeight;
  const marker=digest(JSON.stringify([performance.timeOrigin,location.href,scrollX,scrollY,innerWidth,innerHeight,
    document.title,text,actions,inputs()]));
  const omitted_actions=Math.max(0,actions.length-250);
  actions.splice(250);
  const page_key=cache.pageKey(), guards={};
  for (const a of actions) if (!(a.node in guards)) guards[a.node]=cache.guard(cache.nodes.get(a.node));
  actions.forEach((a,i)=>a.id='e'+(i+1));
  if (scrollY+innerHeight<height-2) actions.push({id:'scroll_down',kind:'scroll',label:'Scroll down',delta:560});
  if (scrollY>0) actions.push({id:'scroll_up',kind:'scroll',label:'Scroll up',delta:-560});
  actions.push({id:'wait',kind:'wait',label:'Wait for the page to update'});
  return JSON.stringify({url:location.href,title:document.title,w:innerWidth,h:innerHeight,text,
    scroll:{y:scrollY,height},actions,marker,page_key,guards,omitted_actions});
})()`;

/** The same marker READ_STATE computes, without rebuilding the action list's ids. */
export const MARKER = `(() => { const state = JSON.parse(${READ_STATE} || "null"); return state ? state.marker : null; })()`;

export function guardScript(node: number): string {
  return `(() => { const c = window.__jevFast; return c ? JSON.stringify([c.pageKey(), c.guard(c.nodes.get(${node}))]) : null; })()`;
}

/** Resolves an observed node to the point to press, after hit-testing it; sets a dropdown's value itself. */
/** An orange pointer the person sees glide to each press, with a ring as it presses. Runs inside the hit test's own
 * command, so showing it costs no round trip and no wait; pointer-events:none keeps it out of every hit test. */
const POINTER = `{
    const show=(id,css)=>{let p=document.getElementById(id);if(!p){p=document.createElement('div');p.id=id;
      p.setAttribute('aria-hidden','true');p.style.cssText=css;document.documentElement.appendChild(p);}return p;};
    const base='position:fixed;z-index:2147483647;pointer-events:none;width:20px;height:20px;margin:-10px 0 0 -10px;border-radius:50%;';
    const p=show('__nordus_pointer',base+'background:rgba(255,102,51,.35);border:2px solid #FF6633;box-shadow:0 0 14px rgba(255,102,51,.65);transition:left .22s cubic-bezier(.2,.8,.2,1),top .22s cubic-bezier(.2,.8,.2,1)');
    p.style.left=x+'px';p.style.top=y+'px';
    const ring=document.createElement('div');ring.setAttribute('aria-hidden','true');
    ring.style.cssText=base+'left:'+x+'px;top:'+y+'px;border:2px solid #FF6633;transition:transform .45s ease-out,opacity .45s ease-out';
    document.documentElement.appendChild(ring);
    requestAnimationFrame(()=>{ring.style.transform='scale(2.6)';ring.style.opacity='0';});setTimeout(()=>ring.remove(),500);
  }`;

export function targetScript(action: { node: number; kind: string; value?: string; pointer?: boolean }): string {
  return `((action) => {
  const e=window.__jevFast?.nodes.get(action.node);
  if (!e?.isConnected || e.matches(':disabled') || e.closest('[aria-disabled="true"],[inert]') ||
      !e.checkVisibility({checkOpacity:true,checkVisibilityCSS:true})) return null;
  if (action.kind==='fill' && (e.readOnly || e.getAttribute('aria-readonly')==='true')) return null;
  let r=e.getBoundingClientRect();
  if (r.y<0 || r.y+r.height>innerHeight) { e.scrollIntoView({block:'center',behavior:'instant'}); r=e.getBoundingClientRect(); }
  const x=r.x+r.width/2, y=r.y+r.height/2;
  if (!r.width || !r.height || x<0 || y<0 || x>=innerWidth || y>=innerHeight) return null;
  const hit=document.elementFromPoint(x,y);
  if (!hit || !(e.contains(hit) || hit.contains(e))) return null;
  if (action.kind==='select') {
    if (e.tagName!=='SELECT' || ![...e.options].some(o=>o.value===action.value &&
        !o.disabled && !o.closest('optgroup[disabled]'))) return null;
    e.value=action.value;
    e.dispatchEvent(new Event('input',{bubbles:true}));
    e.dispatchEvent(new Event('change',{bubbles:true}));
  }
  ${action.pointer && action.kind !== "select" ? POINTER : ""}
  return JSON.stringify({x,y});
})(${JSON.stringify({ node: action.node, kind: action.kind, value: action.value ?? "" })})`;
}

/** Selects whatever the clicked field holds, so the inserted text replaces it. */
export function selectAllScript(node: number): string {
  return `(() => {
  const e=window.__jevFast?.nodes.get(${node});
  if (!e?.isConnected) return false;
  if (document.activeElement!==e) e.focus();
  if (typeof e.select==='function') { e.select(); return true; }
  if (e.isContentEditable) { const r=document.createRange(); r.selectNodeContents(e); const s=getSelection(); s.removeAllRanges(); s.addRange(r); return true; }
  return false;
})()`;
}

/** Waits two frames after input, or for a combobox's suggestions to show (up to 200 ms). */
export function settleScript(action: { node?: number; kind: string }): string {
  return `((action) => new Promise(resolve => {
  const field=window.__jevFast?.nodes.get(action.node);
  const autocomplete=action.kind==='fill' && field?.getAttribute('role')==='combobox';
  let frames=0, stopped=false;
  const finish=()=>{stopped=true;resolve(1)};
  setTimeout(finish,autocomplete ? 200 : 50);
  const ready=()=>{
    if (stopped) return;
    const ids=(field?.getAttribute('aria-controls')||field?.getAttribute('aria-owns')||'').split(/\\s+/).filter(Boolean);
    const roots=ids.length ? ids.map(id=>document.getElementById(id)).filter(Boolean) : [document];
    const options=roots.flatMap(root=>[...root.querySelectorAll('[role="option"]')]);
    if (++frames>=2 && (!autocomplete || options.some(e=>{
      const r=e.getBoundingClientRect();
      return r.width && r.height && r.bottom>0 && r.top<innerHeight && e.checkVisibility({checkOpacity:true,checkVisibilityCSS:true});
    }))) finish();
    else requestAnimationFrame(ready);
  };
  requestAnimationFrame(ready);
}))(${JSON.stringify({ node: action.node ?? 0, kind: action.kind })})`;
}

export const READY_STATE = "document.readyState";

/** The whole page's readable text for the bot, not only the visible part. */
export const READ_PAGE_TEXT = `(() => JSON.stringify({ url: location.href, title: document.title,
  text: (document.body ? document.body.innerText : '').replace(/\\n{3,}/g, '\\n\\n').slice(0, 20000) }))()`;
