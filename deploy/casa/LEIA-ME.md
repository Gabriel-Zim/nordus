# Internet de casa para o navegador dos robôs

O navegador dos robôs abre Instagram, Facebook, Google/YouTube, TikTok, X e LinkedIn por uma saída fixa: o Mac de casa da
pessoa (opcional) e/ou um pool de proxy residencial brasileiro de IP fixo. O resto da internet sai direto do servidor.
Só o navegador dos robôs usa essas saídas; o servidor não usa. Sem Mac e sem arquivo de proxies, nada muda.

Como funciona:

- **No Mac:** `socks-casa.mjs` é um SOCKS5 que escuta só no IP Tailscale do Mac e só aceita o IP Tailscale do servidor.
  Ele abre só sites públicos nas portas 80 e 443. Nunca abre o próprio Mac, a rede de casa, link-local, metadados de
  nuvem nem faixas reservadas. A regra é a de `electron/device-egress.mjs`.
- **No servidor:** o portão de rede de cada navegador (`server/browser/egress/`) manda pelo Mac só os sites da lista
  (`home-sites.ts`, `NORDUS_HOME_SITES`). O resto sai direto, e todas as outras regras do portão continuam valendo.
- **Mac fechado, dormindo ou sem rede:** esses sites não abrem por outro endereço, para a conta não aparecer de fora.
  O robô lê um aviso uma vez e diz isso à pessoa numa frase. O resto continua funcionando.
- **Selo:** a tela do navegador do robô mostra "Internet de casa: ligada" ou "Internet de casa: desligada".

Medido com o relé de teste num Mac de casa: pelo Tailscale, o servidor saiu pelo IP residencial do Mac. O relé recusou 192.168.1.1 (rede de casa) e a porta 22, e derrubou conexões de
qualquer outro IP.

## 1. No Mac (uma vez)

1. O Tailscale precisa estar ligado. Confira o IP do Mac com `tailscale ip -4` (hoje 100.64.0.20).
2. Rode o instalador no repositório da Nordus:

   ```bash
   deploy/casa/instalar.sh 100.64.0.20:1080 100.64.0.10
   ```

   Ele copia três arquivos para `~/.nordus-casa` e cria o agente `ai.nordus.casa`, que sobe no login e volta sozinho
   se cair. O registro fica em `~/.nordus-casa/casa.log`.
3. Para o Mac não dormir quando estiver na tomada: Ajustes do Sistema → Bateria → Opções → "Impedir repouso automático
   quando a tela estiver desligada" (no adaptador de energia).
4. Para desligar: `deploy/casa/instalar.sh --desligar`.

Teste do servidor (deve mostrar a cidade e o provedor da internet de casa):

```bash
curl -s --socks5-hostname 100.64.0.20:1080 https://ipinfo.io/json
```

## 2. No servidor (nordus-server): o que aplicar

### Pool de proxy residencial: o arquivo de segredos

Caminho padrão `/home/nordus/.nordus-secrets/proxy-residencial.env` (outro caminho com a variável `NORDUS_PROXY_FILE`).
Dono `nordus`, permissão 600:

```bash
install -d -m 700 -o nordus -g nordus /home/nordus/.nordus-secrets
install -m 600 -o nordus -g nordus /dev/null /home/nordus/.nordus-secrets/proxy-residencial.env
```

Formato: uma saída por linha, `PROXY_<número>=<url>`. Linha em branco e `#` são comentário. Linha inválida (esquema
diferente, sem porta, nome repetido) é ignorada e o servidor registra só o número dela.

```ini
# proxies residenciais brasileiros de IP fixo
PROXY_1=socks5://usuario:senha@br1.exemplo.com:1080
PROXY_2=http://usuario:senha@br2.exemplo.com:3128
PROXY_3=socks5://sem-login.exemplo.com:1080
```

- `socks5://` fala SOCKS5 com usuário e senha (RFC 1929). `http://` fala HTTP CONNECT com `Proxy-Authorization: Basic`.
- Caractere especial na senha vai em %-código (`@` vira `%40`).
- Usuário e senha nunca aparecem em log, estado nem API. O que aparece é só `PROXY_1 host:porta`.
- O arquivo é relido sozinho quando muda (mtime) e a cada reconfiguração. Sem o arquivo, o pool fica vazio.

### config.json da produção, bloco `browserEngine`

```json
"browserEngine": {
  "egress": {
    "home": { "address": "100.64.0.20:1080" },
    "exits": {
      "order": ["home", "proxy", "direct"],
      "bots": { "ana": "PROXY_1", "leo": "PROXY_2" },
      "sites": ["instagram.com", "facebook.com", "google.com"]
    }
  }
}
```

- `home` é opcional: só entra se o Mac estiver configurado. Sem ele, a saída "casa" não existe.
- `exits` é opcional. Sozinho o arquivo de proxies já liga o pool, com a ordem e a lista padrão.
- `exits.order`: a ordem de tentativa. Valores `"home"` (Mac de casa), `"proxy"` (pool) e `"direct"` (internet do servidor),
  sem repetir. Padrão: `["home", "proxy", "direct"]`. Com `home` configurado e `home.whenAway` diferente de `"direct"`, o
  padrão fica `["home", "proxy"]`, sem direto, para a conta não aparecer pelo endereço do servidor. Escrevendo a ordem,
  ela manda.
- `exits.bots`: robô para PROXY_n (a chave é o id do robô). Sem mapa, cada robô recebe um PROXY_n por hash do id sobre o
  pool, gravado em `browser-exits-state.json` na pasta de dados: o IP do robô não muda quando o pool cresce.
- `exits.sites` (ou `home.sites`) troca a lista padrão de sites. Aceita endereço colado (`https://www.instagram.com/`
  vira `instagram.com`) e cada nome inclui os subdomínios. O Google de cada país só entra com `google.com` na lista.
- `home.whenAway` (só no uso antigo, sem pool): `"wait"` (padrão) não abre os sites sem o Mac; `"direct"` abre pelo servidor.

### Variáveis da unidade `nordus` (drop-in, ao lado do `tela.conf`)

```ini
[Service]
Environment=NORDUS_BROWSER_TIMEZONE=America/Sao_Paulo
Environment=NORDUS_BROWSER_LANG=pt-BR
```

Fuso e idioma da pessoa. Depois: `systemctl daemon-reload` e `systemctl restart nordus`.

### IP fixo por robô e o que acontece quando a saída cai

Cada robô sai sempre pelo seu PROXY_n. Cada saída é testada a cada minuto (abre a conexão e confere o handshake).

Quando a saída do robô cai:

- **Site em que o robô ainda não entrou:** troca de saída na ordem (outro proxy do pool, depois o Mac, depois direto, se o
  direto estiver na ordem). Se caiu até o direto, o robô lê um aviso em português uma vez.
- **Site em que o robô já entrou:** não troca. A conexão é recusada ("a saída de internet deste robô, fora do ar") e o
  robô lê uma vez um aviso em português para dizer à pessoa numa frase. Quando a saída volta, o site volta a abrir pela
  mesma saída. O resto da internet continua funcionando.
- **Sinal de "já entrou":** o registro por robô e serviço da saída pela qual ele já abriu o site com sucesso, em
  `browser-exits-state.json`. Os cookies ficam cifrados no perfil e só o Chrome ligado os lê, então o servidor usa o
  registro. Ele é conservador: um site aberto sem login também conta. Um serviço agrupa os domínios dele
  (`instagram.com` e `cdninstagram.com` são o mesmo; veja `siteFamily` em `home-sites.ts`). Para liberar um robô, apague a
  entrada `bot-<id>|<serviço>` do arquivo com o servidor parado.
- Saída em que o robô nunca abriu nada, e o direto fora da ordem: o site fica sem abrir até alguma saída voltar.

### Selo e estado das saídas

`GET /api/browser/exits` (e `/api/browser/home-internet`, que o selo atual usa) devolve, sem segredo:

```json
{ "configured": true, "state": "on", "exits": [
  { "name": "casa", "kind": "home", "state": "off" },
  { "name": "PROXY_1", "kind": "proxy", "state": "on" } ] }
```

`state` é `"on"` quando alguma saída responde.

### Raio-x diário

O servidor roda o raio-x sozinho todo dia às 06:00 (America/Sao_Paulo). Para cada saída ele confere: no ar, IP, cidade e
ASN vistos em `ipinfo.io/json` pela saída, e se `https://www.google.com/generate_204` responde 204. Não mede detecção.
Piorou (saída fora, IP diferente do último raio-x, página que não abre)? Entra uma linha datada em
`browser-exits-incidents.log` na pasta de dados e uma linha no log do servidor. Nada vai para conversas.

Para rodar na hora ou por cron/systemd timer (sai com 1 se alguma saída piorou):

```bash
cd <pasta do Nordus> && NORDUS_DATA_DIR=/home/nordus/.nordus node deploy/casa/raio-x.mjs
```

Cron, se preferir o do sistema, às 06:00 de São Paulo:

```cron
CRON_TZ=America/Sao_Paulo
0 6 * * * nordus cd <pasta do Nordus> && node deploy/casa/raio-x.mjs >> /home/nordus/.nordus/raio-x.log 2>&1
```

(Se usar o cron, o aviso do próprio servidor às 06:00 se repete: o IP guardado é o do último raio-x, então o segundo não
acusa nada de novo.)
