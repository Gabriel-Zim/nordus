import { escapeHtml as e } from "./util";

const REPO_PATH = `${["Avery", "Zorg"].join("-")}/nordus`;
const INSTALL_COMMAND = `curl -fsSL https://raw.githubusercontent.com/${REPO_PATH}/main/install.sh | bash`;
const REPO = `https://github.com/${REPO_PATH}`;

const STYLE = `
:root{--bg:#0a0a0a;--card:#111112;--card2:#161618;--line:#232326;--line2:#2e2e33;--fg:#e8edf4;--soft:#9aa7ba;--dim:#64748b;--accent:#ff6633;--ok:#3ecf8e;--bad:#f87171;
--font:"Plus Jakarta Sans",system-ui,-apple-system,"Segoe UI",sans-serif;--mono:"JetBrains Mono",ui-monospace,Menlo,Consolas,monospace}
*{box-sizing:border-box}html,body{margin:0;min-height:100%}
body{background:var(--bg);color:var(--fg);font:15.5px/1.55 var(--font);-webkit-font-smoothing:antialiased;min-height:100vh;display:flex;flex-direction:column;position:relative;overflow-x:hidden}
body::before{content:"";position:fixed;inset:0;pointer-events:none;z-index:0;
 background:radial-gradient(900px 520px at 0% 0%,rgba(255,102,51,.20),transparent 60%),radial-gradient(800px 600px at 100% 100%,rgba(255,102,51,.13),transparent 60%),
 linear-gradient(rgba(255,255,255,.028) 1px,transparent 1px) 0 0/44px 44px,linear-gradient(90deg,rgba(255,255,255,.028) 1px,transparent 1px) 0 0/44px 44px}
a{color:inherit}
.topo{position:relative;z-index:1;display:flex;align-items:center;justify-content:space-between;gap:16px;padding:22px 28px}
.marca{display:flex;align-items:center;gap:12px;text-decoration:none;font-weight:700;font-size:17px}
.marca img{width:34px;height:34px;border-radius:9px;border:1px solid var(--line2)}
.marca span{font:500 10.5px var(--mono);letter-spacing:.14em;text-transform:uppercase;color:var(--soft);border:1px solid var(--line2);border-radius:999px;padding:4px 9px}
.quem{display:flex;align-items:center;gap:10px;font-size:13.5px;color:var(--soft)}
.quem img,.quem i{width:28px;height:28px;border-radius:50%;display:grid;place-items:center;background:var(--card2);border:1px solid var(--line2);font-style:normal;color:var(--fg);font-weight:700;font-size:12px}
.palco{position:relative;z-index:1;flex:1;display:flex;align-items:center;justify-content:center;padding:24px 20px 56px}
.cartao{width:100%;max-width:520px;background:linear-gradient(180deg,rgba(22,22,24,.92),rgba(15,15,16,.92));border:1px solid var(--line2);border-radius:20px;padding:34px;box-shadow:0 30px 80px rgba(0,0,0,.55);backdrop-filter:blur(10px);animation:sobe .45s ease both}
.cartao.largo{max-width:760px}.cartao.largo.dividido{max-width:980px}
@keyframes sobe{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
.rotulo{font:500 11.5px var(--mono);letter-spacing:.14em;text-transform:uppercase;color:var(--accent)}
.rotulo::before{content:"•";margin-right:9px}
h1{font-size:30px;line-height:1.12;letter-spacing:-.02em;margin:12px 0 10px;font-weight:800}
h2{font-size:17px;margin:0 0 6px;font-weight:700}
p{color:var(--soft);margin:0 0 14px}.pequeno{font-size:13px;color:var(--dim)}
.botao{display:flex;align-items:center;justify-content:center;gap:10px;width:100%;border:0;border-radius:12px;padding:14px 18px;font:700 15px var(--font);cursor:pointer;text-decoration:none;background:var(--accent);color:#0a0a0a;transition:filter .15s,transform .15s}
.botao:hover{filter:brightness(1.08)}.botao:active{transform:translateY(1px)}
.botao.google{background:#f4f4f5;color:#111;font-weight:600}
.botao.fantasma{background:transparent;color:var(--fg);border:1px solid var(--line2);font-weight:600}
.botao[aria-disabled=true],.botao:disabled{opacity:.45;pointer-events:none}
.botao svg{flex:none}
.pilha{display:grid;gap:10px;margin-top:22px}
.etapas{display:flex;align-items:center;gap:8px;margin-bottom:26px}
.etapa{display:flex;align-items:center;gap:8px;font:500 11px var(--mono);letter-spacing:.1em;text-transform:uppercase;color:var(--dim)}
.etapa b{width:22px;height:22px;border-radius:50%;display:grid;place-items:center;border:1px solid var(--line2);font-weight:600;font-size:11px}
.etapa.feita{color:var(--soft)}.etapa.feita b{background:rgba(62,207,142,.12);border-color:rgba(62,207,142,.45);color:var(--ok)}
.etapa.agora{color:var(--fg)}.etapa.agora b{border-color:var(--accent);color:var(--accent);box-shadow:0 0 0 4px rgba(255,102,51,.12)}
.traco{flex:1;height:1px;background:var(--line2);min-width:14px}
.maquina{display:flex;align-items:center;gap:14px;padding:14px;border:1px solid var(--line);background:rgba(10,10,10,.5);border-radius:14px;margin:18px 0 22px}
.maquina img{width:46px;height:46px}
.maquina b{display:block;font-size:15px}.maquina small{color:var(--dim);font-size:12.5px}
.chip{margin-left:auto;text-align:right;font:600 15px var(--mono);letter-spacing:.08em;color:var(--fg)}
.chip small{display:block;font:500 10px var(--mono);letter-spacing:.12em;text-transform:uppercase;color:var(--dim)}
.campo{display:flex;align-items:center;border:1px solid var(--line2);border-radius:12px;background:#0b0b0c;transition:border-color .15s,box-shadow .15s}
.campo:focus-within{border-color:var(--accent);box-shadow:0 0 0 4px rgba(255,102,51,.12)}
.campo input{flex:1;min-width:0;background:transparent;border:0;color:var(--fg);font:500 17px var(--mono);padding:15px 4px 15px 16px;outline:none}
.campo span{color:var(--dim);font:500 17px var(--mono);padding-right:16px}
.aviso{min-height:22px;margin:9px 2px 0;font-size:13.5px;color:var(--dim);display:flex;align-items:center;gap:7px}
.aviso.ok{color:var(--ok)}.aviso.ruim{color:var(--bad)}
.erro{border:1px solid rgba(248,113,113,.35);background:rgba(248,113,113,.07);color:#fecaca;border-radius:12px;padding:12px 14px;font-size:14px;margin:0 0 16px}
.robo{display:block;width:120px;height:120px;margin:4px auto 6px;filter:drop-shadow(0 14px 30px rgba(255,102,51,.18))}
.centro{text-align:center}
.estado{display:inline-flex;align-items:center;gap:9px;font:500 12px var(--mono);letter-spacing:.08em;text-transform:uppercase;padding:8px 13px;border-radius:999px;border:1px solid var(--line2);color:var(--soft);margin:6px 0 4px}
.estado i{width:8px;height:8px;border-radius:50%;background:var(--dim)}
.estado.esperando i{background:var(--accent);animation:pulsa 1.2s ease-in-out infinite}
.estado.on{color:var(--ok);border-color:rgba(62,207,142,.4)}.estado.on i{background:var(--ok);box-shadow:0 0 12px var(--ok)}
@keyframes pulsa{50%{opacity:.25}}
.endereco{font:600 18px var(--mono);color:var(--fg);word-break:break-all;margin:6px 0 16px}
.passos{display:grid;gap:14px;margin-top:24px;padding-top:22px;border-top:1px solid var(--line)}
.passo{display:grid;grid-template-columns:30px minmax(0,1fr);gap:12px}.passo>div{min-width:0}
.passo>b{width:30px;height:30px;border-radius:50%;display:grid;place-items:center;border:1px solid #5a2a16;color:var(--accent);font:500 12px var(--mono)}
.passo h2{font-size:15px;margin:3px 0 2px}.passo p{font-size:13.5px;margin:0}
.cmd{min-width:0;display:flex;align-items:center;gap:8px;margin-top:8px;background:#0b0b0c;border:1px solid var(--line);border-radius:10px;padding:9px 9px 9px 12px}
.cmd code{flex:1;min-width:0;overflow-x:auto;white-space:nowrap;font:12.5px var(--mono);color:var(--fg);scrollbar-width:none}
.copiar{flex:none;background:var(--card2);border:1px solid var(--line2);color:var(--soft);border-radius:8px;font:500 12px var(--font);padding:6px 10px;cursor:pointer}
.ou{display:flex;align-items:center;gap:12px;color:var(--dim);font-size:12.5px;margin:22px 0 4px}.ou::before,.ou::after{content:"";flex:1;height:1px;background:var(--line2)}
.dividido{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,.9fr);gap:0;padding:0;overflow:hidden}
.dividido .lado{padding:38px 36px;min-width:0}
.arte{position:relative;min-height:520px;background:url(/img/hero.jpg) center 20%/cover no-repeat}
.arte::after{content:"";position:absolute;inset:0;background:linear-gradient(90deg,rgba(17,17,18,1) 0%,rgba(17,17,18,.25) 30%,rgba(10,10,10,0) 60%),linear-gradient(0deg,rgba(10,10,10,.65),transparent 40%)}
.arte span{position:absolute;left:24px;right:24px;bottom:22px;z-index:1;font:500 11px var(--mono);letter-spacing:.14em;text-transform:uppercase;color:var(--soft)}
.lista{display:grid;gap:12px;margin-top:20px}
.servidor{display:grid;grid-template-columns:52px 1fr auto;gap:14px;align-items:center;padding:14px 14px 14px 12px;border:1px solid var(--line);border-radius:14px;background:rgba(10,10,10,.45);transition:border-color .15s}
.servidor:hover{border-color:var(--line2)}
.servidor img{width:52px;height:52px}
.servidor b{display:block;font:600 15px var(--mono);word-break:break-all}
.servidor small{display:flex;align-items:center;gap:8px;color:var(--dim);font-size:12.5px;margin-top:3px}
.ponto{width:7px;height:7px;border-radius:50%;background:var(--dim);display:inline-block}.ponto.on{background:var(--ok);box-shadow:0 0 8px var(--ok)}
.acoes{display:flex;align-items:center;gap:8px}
.acoes .botao{width:auto;padding:9px 14px;font-size:13.5px}
.remover{background:none;border:0;color:var(--dim);font:500 12.5px var(--font);cursor:pointer;padding:6px}.remover:hover{color:var(--bad)}
.vazio{text-align:center;padding:26px 10px 6px}.vazio img{width:96px;height:96px;opacity:.9}
.rodape{position:relative;z-index:1;text-align:center;font-size:12.5px;color:var(--dim);padding:0 20px 26px}
.rodape a{color:var(--soft)}
.avatar{width:64px;height:64px;border-radius:50%;margin:0 auto 4px;display:grid;place-items:center;background:var(--card2);border:1px solid var(--line2);font-weight:800;font-size:24px;overflow:hidden}
.avatar img{width:100%;height:100%}
.para{display:inline-flex;align-items:center;gap:8px;font:600 14px var(--mono);border:1px solid var(--line2);background:#0b0b0c;border-radius:999px;padding:7px 14px;margin:4px 0 2px}
.para img{width:20px;height:20px}
@media (max-width:820px){.dividido{grid-template-columns:1fr}.arte{min-height:220px;order:-1}.arte::after{background:linear-gradient(0deg,rgba(17,17,18,1),rgba(17,17,18,.1) 60%)}.dividido .lado{padding:28px 24px}}
@media (max-width:520px){.quem span{display:none}.arte span{display:none}.cartao{padding:24px}.topo{padding:16px}h1{font-size:25px}.servidor{grid-template-columns:44px 1fr}.servidor img{width:44px;height:44px}.acoes{grid-column:1/-1}.acoes .botao{flex:1}.etapa span{display:none}.chip{display:none}}
@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
`;

const GOOGLE_ICON = `<svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>`;

const COPY_SCRIPT = `<script>document.addEventListener("click",function(ev){var b=ev.target.closest&&ev.target.closest(".copiar");if(!b)return;var t=b.parentElement.querySelector("code").textContent;navigator.clipboard.writeText(t).then(function(){b.textContent="Copiado";setTimeout(function(){b.textContent="Copiar"},1600)})});</script>`;

export interface Viewer { email: string; name: string | null; picture: string | null }

function initial(viewer: Viewer): string {
  return e((viewer.name ?? viewer.email).trim().charAt(0).toUpperCase() || "?");
}

function face(viewer: Viewer): string {
  return viewer.picture ? `<img src="${e(viewer.picture)}" alt="" referrerpolicy="no-referrer">` : `<i>${initial(viewer)}</i>`;
}

/** The same robot for the same address, so a server keeps its face in every list. */
export function robotFor(name: string): string {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return `/img/robo-${String((hash % 12) + 1).padStart(2, "0")}.png`;
}

export function page(title: string, body: string, options: { status?: number; viewer?: Viewer | null } = {}): Response {
  const viewer = options.viewer;
  const top = `<header class="topo"><a class="marca" href="/"><img src="/img/icon.png" alt="">Nordus<span>Conta</span></a>${
    viewer ? `<form class="quem" method="post" action="/sair">${face(viewer)}<span>${e(viewer.email)}</span><button class="remover" title="Sair">Sair</button></form>` : ""}</header>`;
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${e(title)} | Nordus</title><meta name="robots" content="noindex"><link rel="icon" href="/img/icon.png"><meta name="theme-color" content="#0a0a0a">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@500;600&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>${STYLE}</style></head><body>${top}<main class="palco">${body}</main>
<footer class="rodape">Nordus é <a href="${REPO}">código aberto</a>. Seus bots, conversas e chaves ficam no seu servidor; esta conta guarda só o seu e-mail e os endereços que você escolheu.</footer>
</body></html>`;
  return new Response(html, {
    status: options.status ?? 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "content-security-policy": "default-src 'none'; script-src 'unsafe-inline'; connect-src 'self'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: https://lh3.googleusercontent.com; form-action 'self' https://accounts.google.com https://*.nordus.ai; frame-ancestors 'none'; base-uri 'none'",
      "referrer-policy": "same-origin",
      "x-content-type-options": "nosniff",
    },
  });
}

function googleButton(href: string, label = "Entrar com Google"): string {
  return `<a class="botao google" href="${e(href)}">${GOOGLE_ICON}${e(label)}</a>`;
}

function steps(current: 1 | 2 | 3): string {
  const names = ["Entrar", "Endereço", "No ar"];
  return `<div class="etapas" aria-label="Etapa ${current} de 3">${names.map((name, index) => {
    const n = index + 1;
    const state = n < current ? "feita" : n === current ? "agora" : "";
    return `${index ? `<i class="traco"></i>` : ""}<div class="etapa ${state}"><b>${n < current ? "✓" : n}</b><span>${name}</span></div>`;
  }).join("")}</div>`;
}

function command(): string {
  return `<div class="cmd"><code>${e(INSTALL_COMMAND)}</code><button type="button" class="copiar">Copiar</button></div>`;
}

const HOW = `<div class="passos">
<div class="passo"><b>1</b><div><h2>Instale numa VPS, num Mac ou num Linux</h2><p>Um comando. Ou peça ao Claude: “instale o Nordus seguindo o README de ${REPO.replace("https://", "")}”.</p>${command()}</div></div>
<div class="passo"><b>2</b><div><h2>Conecte com o Google</h2><p>O instalador mostra um link para esta página. Você entra e escolhe o nome.</p></div></div>
<div class="passo"><b>3</b><div><h2>Use de qualquer lugar</h2><p>Seu Nordus abre em <strong style="color:var(--fg);font-family:var(--mono);font-weight:600">seu-nome.nordus.ai</strong>, com HTTPS e sem abrir portas.</p></div></div>
</div>`;

export function homeSignedOut(loginHref: string): Response {
  return page("Sua conta", `<section class="cartao largo dividido">
<div class="lado"><span class="rotulo">Sua conta Nordus</span>
<h1>Seus funcionários de IA, num endereço só seu.</h1>
<p>Instale o Nordus onde quiser e entre nele de qualquer lugar, com o Google. Sem domínio para comprar, sem portas para abrir.</p>
<div class="pilha">${googleButton(loginHref)}</div>
${HOW}</div>
<div class="arte"><span>Código aberto · No seu servidor · Suas assinaturas de IA</span></div>
</section>${COPY_SCRIPT}`);
}

export interface ServerView { id: string; name: string; host: string; machine: string; platform: string; online: boolean | null }

const PLATFORM: Record<string, string> = { darwin: "Mac", windows: "Windows", linux: "Linux" };

export function homeSignedIn(viewer: Viewer, servers: ServerView[], max: number): Response {
  const first = (viewer.name ?? "").split(" ")[0];
  const list = servers.length
    ? `<div class="lista">${servers.map((server) => `<div class="servidor" data-id="${e(server.id)}">
<img src="${robotFor(server.name)}" alt="">
<div><b>${e(server.host)}</b><small><i class="ponto${server.online ? " on" : ""}"></i>${server.online === null ? "sem resposta" : server.online ? "no ar" : "desligado"} · ${e(server.machine)}${PLATFORM[server.platform] ? ` · ${PLATFORM[server.platform]}` : ""}</small></div>
<div class="acoes"><a class="botao" href="https://${e(server.host)}/auth/google">Entrar</a>
<form method="post" action="/remover" onsubmit="return confirm('Remover ${e(server.host)}? O endereço para de funcionar e o Nordus continua instalado, só sem endereço público.')"><input type="hidden" name="id" value="${e(server.id)}"><button class="remover">Remover</button></form></div>
</div>`).join("")}</div>`
    : `<div class="vazio"><img src="/img/robo-03.png" alt=""><h2>Nenhum Nordus conectado ainda</h2><p>Instale num computador ou numa VPS. No fim, o instalador traz você de volta para cá.</p></div>`;
  return page("Seus Nordus", `<section class="cartao largo">
<span class="rotulo">${first ? `Olá, ${e(first)}` : "Sua conta"}</span>
<h1>Seus Nordus</h1>
<p>${servers.length ? `Clique em Entrar para abrir com o Google. Até ${max} endereços por conta.` : "Cada Nordus que você conectar aparece aqui, com o endereço e se está no ar."}</p>
${list}
<div class="passos" style="margin-top:28px"><div class="passo"><b>+</b><div><h2>${servers.length ? "Conectar mais um" : "Instalar"}</h2><p>Rode no servidor ou no computador. Ele mostra um link para esta página.</p>${command()}</div></div></div>
</section>${COPY_SCRIPT}`, { viewer });
}

export function activatePage(input: { code: string; machine: string; platform: string; viewer: Viewer; name: string; error?: string }): Response {
  const script = `<script>(function(){var i=document.querySelector("input[name=nome]"),a=document.getElementById("aviso"),b=document.getElementById("conectar"),t,seq=0;
function set(cls,txt,ok){a.className="aviso "+cls;a.textContent=txt;b.disabled=!ok}
function check(){var v=i.value.trim().toLowerCase();if(i.value!==v)i.value=v;if(!v){set("","",false);return}var n=++seq;set("","Conferindo…",false);
fetch("/api/nome?n="+encodeURIComponent(v)).then(function(r){return r.json()}).then(function(j){if(n!==seq)return;
if(j.ok)set("ok","✓ "+v+".nordus.ai está livre"+(j.seu?" (já é seu)":""),true);else set("ruim","✕ "+j.motivo,false)}).catch(function(){set("","",true)})}
i.addEventListener("input",function(){clearTimeout(t);t=setTimeout(check,280)});check();
document.querySelector("form").addEventListener("submit",function(){b.disabled=true;b.textContent="Criando o endereço…"})})();</script>`;
  return page("Escolha o endereço", `<section class="cartao">${steps(2)}
<span class="rotulo">Conectar um Nordus</span>
<h1>Escolha o endereço</h1>
<p>É por ele que você e o seu time vão abrir este Nordus, de qualquer lugar.</p>
<div class="maquina"><img src="${robotFor(input.name)}" alt=""><div><b>${e(input.machine)}</b><small>${PLATFORM[input.platform] ?? "Servidor"} · pedindo para conectar</small></div>
<div class="chip"><small>Confira o código</small>${e(input.code)}</div></div>
${input.error ? `<div class="erro">${e(input.error)}</div>` : ""}
<form method="post" action="/ativar"><input type="hidden" name="codigo" value="${e(input.code)}">
<label class="campo"><input name="nome" value="${e(input.name)}" autocomplete="off" autocapitalize="none" spellcheck="false" maxlength="32" required aria-label="Nome do endereço" autofocus><span>.nordus.ai</span></label>
<div class="aviso" id="aviso" aria-live="polite"></div>
<div class="pilha"><button class="botao" id="conectar">Conectar</button></div></form>
<p class="pequeno" style="margin-top:16px">Você entra nele com o Google como <b style="color:var(--soft)">${e(input.viewer.email)}</b>, com acesso total. Depois dá para convidar outras pessoas. O código ${e(input.code)} tem que ser o mesmo que aparece na tela do instalador.</p>
</section>${script}`, { viewer: input.viewer });
}

export function activatedPage(input: { id: string; name: string; host: string; machine: string; viewer: Viewer }): Response {
  const script = `<script>(function(){var s=document.getElementById("estado"),b=document.getElementById("entrar"),h=document.getElementById("dica"),tries=0;
function tick(){fetch("/api/estado?id=${e(input.id)}").then(function(r){return r.json()}).then(function(j){if(j.online){s.className="estado on";s.lastChild.textContent="No ar";b.removeAttribute("aria-disabled");h.textContent="Pronto. Entre com o Google e comece a montar o seu time de robôs.";document.title="No ar | Nordus";return}
if(++tries>40)h.textContent="Está demorando. Confira a tela do instalador: ela mostra o que falta.";setTimeout(tick,3000)}).catch(function(){setTimeout(tick,4000)})}tick()})();</script>`;
  return page("Ligando", `<section class="cartao centro">${steps(3)}
<img class="robo" src="${robotFor(input.name)}" alt="">
<span class="estado esperando" id="estado"><i></i><span>Ligando o seu Nordus</span></span>
<h1 style="margin-top:14px">“${e(input.machine)}” agora tem endereço</h1>
<div class="endereco">${e(input.host)}</div>
<p id="dica">O instalador já recebeu o endereço e está ligando o servidor. Leva menos de um minuto.</p>
<div class="pilha"><a class="botao" id="entrar" aria-disabled="true" href="https://${e(input.host)}/auth/google">Entrar em ${e(input.host)}</a>
<a class="botao fantasma" href="/">Ver todos os meus Nordus</a></div>
</section>${script}`, { viewer: input.viewer });
}

export function authorizePage(input: { host: string; name: string; viewer: Viewer; continueToken: string; switchHref: string }): Response {
  const who = input.viewer.name ?? input.viewer.email;
  return page("Entrar", `<section class="cartao centro">
<div class="avatar">${input.viewer.picture ? `<img src="${e(input.viewer.picture)}" alt="" referrerpolicy="no-referrer">` : initial(input.viewer)}</div>
<span class="rotulo">Entrar</span>
<h1>Olá${input.viewer.name ? `, ${e(input.viewer.name.split(" ")[0]!)}` : ""}</h1>
<p>Você vai entrar em</p>
<div class="para"><img src="${robotFor(input.name)}" alt="">${e(input.host)}</div>
<form method="post" action="/oauth/continuar" class="pilha"><input type="hidden" name="t" value="${e(input.continueToken)}">
<button class="botao">Continuar como ${e(who)}</button>${googleButton(input.switchHref, "Usar outra conta Google")}</form>
<p class="pequeno" style="margin-top:16px">${e(input.viewer.email)}. Quem decide se você pode entrar é o dono deste Nordus.</p>
</section>`, { viewer: input.viewer });
}

export function errorPage(title: string, message: string, status = 400): Response {
  return page(title, `<section class="cartao centro"><img class="robo" src="/img/robo-08.png" alt="" style="width:96px;height:96px;opacity:.85">
<span class="rotulo">Algo não deu certo</span><h1>${e(title)}</h1><p>${e(message)}</p><div class="pilha"><a class="botao fantasma" href="/">Ir para a minha conta</a></div></section>`, { status });
}
