# Anexo HTML embutido na conversa

Um robô que anexa um arquivo `.html` com `attach_file` vê a página aparecer dentro da conversa, em um iframe isolado, e não só como link de download. Serve para quadros, painéis e cartões clicáveis (por exemplo "Ideia 1/2/3" que expandem).

## Como o robô anexa

`attach_file` com o caminho do arquivo, como qualquer outro anexo:

```
attach_file({ path: "quadro-ideias.html" })
```

- `.html` e `.htm` são aceitos (o arquivo guardado sempre termina em `.html`).
- Teto de 10 MB por página (`HTML_MAX_BYTES`). O teto geral de anexos não muda.
- Só o robô anexa HTML. O envio de arquivo pelo usuário (`POST /api/files`) continua recusando HTML.

## Padrão de imagens: HTML autocontido

A página não pode buscar nada por conta própria. Use:

- imagens em `data:` base64, de preferência JPEG ou WebP redimensionadas para cerca de 1080 px de largura e qualidade perto de 80, para caber no teto de 10 MB; ou
- URLs `https:` públicas (`img-src` e `media-src` aceitam `https:`).

CSS e JS ficam inline. Fabrikam: Google Fonts (`fonts.googleapis.com` e `fonts.gstatic.com`) ou `data:`.

## O que é bloqueado

A página roda com `sandbox` (origem opaca) e um CSP restritivo:

- sem `fetch`/XHR/WebSocket (`connect-src 'none'`);
- sem formulários (`form-action 'none'`) e sem `<base>`;
- sem scripts externos (`script-src 'unsafe-inline'`);
- sem cookies, `localStorage` ou acesso à API do app (origem opaca);
- links com `target="_blank"` abrem em aba nova, sem `opener`.

Exemplo completo: [`docs/exemplos/quadro-ideias.html`](exemplos/quadro-ideias.html).

## Como o app serve a página

`GET /api/threads/:t/messages/:m/file?html=1&name=<nome gerado>.html`, só para um anexo `file` `.html` da mesma mensagem de robô (403 se a mensagem não o anexou, 404 se não existe, 415 se o arquivo não é HTML). Cabeçalhos: `content-security-policy` com `sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox`, `x-content-type-options: nosniff`, `referrer-policy: no-referrer`, `cross-origin-resource-policy: same-origin`, `cache-control: private, no-store`, sem `x-frame-options`. O iframe nunca leva `allow-same-origin`.

A rota de download (`POST`), se servir HTML, manda `content-disposition: attachment` e `content-security-policy: sandbox`.

## Ponte entre a página e o app

A página fala com o app só por `window.parent.postMessage(msg, "*")`. O app ouve apenas mensagens cujo `event.source` é o iframe daquele cartão (não confia em `event.origin`, que é `"null"`). Toda mensagem leva `versao: 1`.

### Responder (texto para a caixa de mensagem)

```js
window.parent.postMessage({ tipo: "nordus:responder", versao: 1, texto: "..." }, "*");
```

`texto`: string não vazia, até 20000 caracteres (acima disso o app avisa e recusa). O app NUNCA envia sozinho: coloca o texto no rascunho da conversa (depois de uma linha em branco, se já houver texto), foca a caixa, fecha a tela cheia se estiver aberta e mostra "Suas alterações do quadro estão na caixa. Revise e envie." Mensagens idênticas em menos de 1 s são ignoradas.

### Rascunho do quadro

```js
window.parent.postMessage({ tipo: "nordus:rascunho", versao: 1, dados: { ... } }, "*");
```

O app guarda `JSON.stringify(dados)` (até 200 KB) no `localStorage` do app, por conversa + mensagem + nome do anexo. Quando o iframe carrega, o app devolve `{ tipo: "nordus:rascunho", versao: 1, dados }` à página, se houver algo salvo (escute `message` e confira `e.source === window.parent`).

### Altura automática

```js
window.parent.postMessage({ tipo: "nordus:altura", versao: 1, altura: document.documentElement.scrollHeight }, "*");
```

No cartão embutido a altura vai de 240 px a 85% da altura da tela. Se a pessoa arrastar a alça de redimensionar, a altura manual vale e as mensagens seguintes de altura são ignoradas naquele cartão. Em tela cheia é ignorada.

### Gravar pelo app (microfone)

Uma página com `sandbox` e origem opaca NÃO consegue pedir o microfone: `getUserMedia` dentro do iframe falha com `SecurityError: Invalid security origin` (medido no Chrome). Por isso quem grava é o app, que tem origem própria. Fluxo:

```js
window.parent.postMessage({ tipo: "nordus:gravar", versao: 1, id: "g1", acao: "iniciar" }, "*");
// depois: acao: "parar" (envia para transcrever) ou acao: "cancelar"
```

- No `iniciar`, o app chama `getUserMedia({ audio: true })` e grava com `MediaRecorder` (webm/opus, ou mp4 no Safari). O cartão (embutido e tela cheia) mostra uma faixa de gravação com ponto vermelho, cronômetro e botões Parar e Cancelar. Parar e Cancelar valem tanto da página quanto da faixa. A gravação para sozinha em 3 min ou 10 MB e o microfone é sempre liberado no fim. Sem `iniciar` vindo do iframe daquele cartão, nada grava.
- O app avisa a página: `{ tipo: "nordus:gravacao", versao: 1, id, estado: "gravando" | "transcrevendo" | "cancelada" }`.
- Ao parar, o app envia o áudio pela rota de transcrição e responde `{ tipo: "nordus:transcricao", versao: 1, id, texto }` ou `{ ..., id, erro: "mensagem curta" }`. Permissão negada vira "Microfone bloqueado. Libere nas configurações do navegador."

### Transcrever áudio que a própria página tem

```js
window.parent.postMessage({ tipo: "nordus:transcrever", versao: 1, id: "r1", mime: "audio/webm", audio: arrayBuffer }, "*");
// resposta: nordus:transcricao, como acima
```

`mime`: `audio/webm`, `audio/ogg`, `audio/mp4`, `audio/mpeg` ou `audio/wav`; `audio` é um `ArrayBuffer` de até 10 MB; uma transcrição por vez por cartão. Atenção: gravar esse áudio DENTRO do iframe não funciona em origem opaca (use `nordus:gravar`); este caminho serve para áudio que a página já tem (por exemplo um arquivo escolhido).

Transcrição no servidor (comum aos dois caminhos): o app envia os bytes para `POST /api/threads/:t/messages/:m/transcribe?name=<anexo>.html` (só mensagem de robô que anexou aquele HTML; corpo cru; teto 10 MB e 3 min de envio). O servidor converte para wav mono 16 kHz com ffmpeg (`NORDUS_FFMPEG_PATH`, padrão `ffmpeg` no PATH) dentro de `attachments/transcrever` e chama o serviço local em `NORDUS_TRANSCRIBE_URL` (padrão `http://127.0.0.1:8890/transcribe`, o mesmo faster-whisper das notas de voz; resposta com `text`). Tempo limite de 5 min, temporários apagados sempre, nenhuma API externa.

## Demo local

```
node scripts/demo-anexo-html.mjs
```

Cria uma pasta temporária isolada (`HOME` e `NORDUS_DATA_DIR` dentro dela; nunca `~/.nordus` nem produção), semeia a conversa com o robô ESTRATEGISTADECONTEUDO e uma mensagem com `docs/exemplos/quadro-ideias.html` anexado, e sobe o servidor (porta 8797) e o cliente (porta 5179, `NORDUS_UI_PORT`). Abra http://127.0.0.1:5179/ , clique em "Pular tour" no primeiro acesso e abra a conversa ESTRATEGISTADECONTEUDO. Ctrl+C encerra e apaga a pasta. A configuração `demo-anexo-html` está em `.claude/launch.json` deste worktree.

Nota sobre o painel de navegador embutido do app desktop: ele bloqueia (`ERR_BLOCKED_BY_CLIENT`) qualquer iframe com `sandbox` sem `allow-same-origin`, então o quadro não aparece nele. Em Chrome/Brave/Safari normais funciona. A demo foi verificada em Chrome (cartão, botão "Enviar ao ESTRATEGISTADECONTEUDO", tela cheia, celular de 375 px sem rolagem horizontal).
