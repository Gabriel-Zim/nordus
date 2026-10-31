# CLEF nas decisões do Nordus

O CLEF (`@cf/cloudflare/clef`, Cloudflare Workers AI) é um provedor do decisor (`server/decider`), ao lado do Jev e do OpenRouter. Ele responde às mesmas perguntas tipadas: sim ou não (`noul`), escolha (`choice`) e nota (`score`). Devolve probabilidades. Toda falha (sem credencial, tempo esgotado, recusa, resposta estranha) volta como `{ ok: false }`, e o código segue a regra de hoje.

## Como ligar

No `config.json` do servidor:

```json
"decider": {
  "enabled": true,
  "provider": "clef",
  "clefModel": "clef",
  "clefEnvFile": "/home/nordus/.nordus-secrets/cloudflare-ai.env",
  "clefTimeoutMs": 2500
}
```

- `clefModel`: `clef` ou `clef-flash`. Sem o campo, `clef`.
- A conta e o token nunca ficam no config. O servidor lê `CLOUDFLARE_ACCOUNT_ID` e `CLOUDFLARE_AI_TOKEN` do ambiente. Se faltar algum, lê o arquivo em `clefEnvFile` (ou em `$NORDUS_CLEF_ENV_FILE`), linhas `CHAVE=valor`. O arquivo é relido quando muda.
- `clefTimeoutMs`: a espera quando quem chama não define uma. Sem o campo, 2.500 ms.
- `clefBaseUrl`: só para testes ou um AI Gateway compatível. Sem o campo, `https://api.cloudflare.com/client/v4`.
- `jobs` continua valendo: cada decisão liga ou desliga sozinha, e ausente quer dizer ligada.

O botão de teste (`POST /api/decider/test` com `{"provider":"clef"}`) faz uma pergunta curta com o token do ambiente.

## Onde o CLEF decide

Os pontos que já usavam o decisor (sala, Boss, e-mail, tamanho do turno, skill, notificação, `taskLanes`, `ackFirst`, `criticalCheck` e os demais) passam a usar o CLEF sem mudar a chamada.

Pontos novos, cada um com a sua tarefa em `jobs` (`server/decider/clef-reads.ts`):

| Tarefa | O que lê | Regra que continua valendo |
|---|---|---|
| `replyReading` | Se a resposta digitada de um administrador é um sim à pergunta do robô | Só vale como sim com CLEF ≥ 0,85, resposta curta e nenhuma palavra de espera ou de não ("mas", "só", "espera", "não", "?"). Sim e não da regra nunca mudam. Quem pode aprovar não muda. |
| `voiceConsent` | Um sim falado que a regra não entendeu (por exemplo em português) | Mesmo limite de 0,85 e lista de travas em vários idiomas. Um não continua sendo da regra. |
| `reactionReading` | Qual opção de uma pergunta um 👍 ou 👎 quer dizer | Só em cartão de pergunta, nunca em cartão de aprovação. Precisa de 0,85 e folga de 0,3 sobre a segunda opção. |
| `routineNews` | Se a resposta de uma rotina "só avisar com novidade" diz, com outras palavras, que nada mudou | Precisa de 0,9. Resposta com pergunta, `NEEDS INPUT` ou longa nunca fica quieta. O fim do turno daquela conversa espera a leitura, no máximo o tempo do decisor. |
| `needsInput` | Se o robô parou esperando a pessoa, sem o prefixo `NEEDS INPUT:` | Precisa de 0,9; aí avisa o Chief como o prefixo faria. |
| `turnError` | O tipo de um erro de turno que nenhuma regra reconheceu | Só escolhe a frase mostrada. Limite de uso fica com a regra; nada muda em nova tentativa. |

Textos que vão ao CLEF passam pela limpeza de segredos (`redactSecretsInText`).

`shared/critical-action.ts` e o gancho de ação crítica não usam o CLEF.
