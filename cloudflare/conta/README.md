# Nordus account (conta.nordus.ai)

A Cloudflare Worker that gives every self-hosted Nordus a public address and a Google sign-in without the owner
creating a Google client, buying a domain or opening a port.

1. `nordus login` on the machine asks `POST /v1/ativacoes` for a code and prints the link
   `https://conta.nordus.ai/ativar?codigo=XXXX-XXXX`.
2. The person signs in with Google there and chooses `name.nordus.ai`. The Worker creates a remotely managed
   Cloudflare Tunnel for that host (ingress `http://127.0.0.1:8812`, the server's tunnel gateway) and its proxied
   CNAME.
3. The machine polls `POST /v1/ativacoes/verificar` and receives, once, an installation credential. `nordus serve
   --tunnel` exchanges it for the connector token at `POST /v1/installations/self/endpoint`.
4. "Entrar com Google" on that server goes to `/oauth/authorize`: the Worker runs Google's sign-in with its own
   client and returns a one-time code to `https://name.nordus.ai/auth/google/callback`. The server redeems it at
   `/oauth/token` with its credential and PKCE verifier and gets an ID token (issuer `https://conta.nordus.ai`)
   carrying the verified Google email. Who may enter is still the server's own sign-in list.

The account keeps only the Google identity (id, email, name, photo) and the addresses. Bots, chats and keys stay
on the person's machine.

## Deploy

```sh
pnpm exec wrangler d1 migrations apply nordus-conta --remote --config cloudflare/conta/wrangler.jsonc
pnpm exec wrangler secret put CF_API_TOKEN --config cloudflare/conta/wrangler.jsonc         # Tunnel Edit, DNS Edit on the zone
pnpm exec wrangler secret put GOOGLE_CLIENT_SECRET --config cloudflare/conta/wrangler.jsonc
pnpm exec wrangler secret put ID_TOKEN_KEY --config cloudflare/conta/wrangler.jsonc         # any random 32 bytes
pnpm conta:deploy
```

The Google client needs the redirect URI `https://conta.nordus.ai/google/callback`.
