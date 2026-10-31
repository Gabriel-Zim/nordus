# App sign-in over Google

Native shells sign in through the server's Google page and get a bearer token
back, without a browser cookie. The browser opens in the system sheet; the
app keeps a PKCE verifier and only the verifier can turn the returned code
into a session.

## Start

```
GET https://<server>/auth/google?cliente=<client>&desafio=<challenge>
```

- `cliente` is one of `ios`, `rn` or `mac`.
- `desafio` is `base64url(sha256(verifier))`: exactly 43 characters from
  `A-Za-z0-9_-`. Keep the verifier (43 or more characters from the same
  alphabet) in the app.
- `voltar` is optional and only affects the browser sign-in; an app sign-in
  never lands on this server's pages.

The server redirects to Google and, on the way back, redirects to the client's
own scheme:

| `cliente` | Callback |
| --- | --- |
| `ios` | `ai.nordus.app://auth` |
| `rn` | `ai.nordus.rn://auth` |
| `mac` | `ai.nordus.desktop://auth` |

The new app sends `rn` on every platform and answers on `ai.nordus.rn`. There
is no `desktop` client name: `ai.nordus.desktop` is the scheme of the old
Electron app, which can stay installed beside the new one, and a sign-in sent
there would open the wrong app. `ios` and `mac` stay for builds already
shipped.

The success callback is `<callback>?code=<code>`; a refusal is
`<callback>?erro=<reason>` with the reason codes of `shared/nordus-login.ts`.
The code is single-use and lives for 60 seconds.

## Exchange the code for a token

```
POST https://<server>/auth/app/token
content-type: application/json

{"code": "<code>", "verificador": "<verifier>", "label": "iPhone do Avery"}
```

`label` is optional: without it the server names the device from the user agent.
The request must be JSON, and the answer is the same body `POST /api/auth/pair`
returns:

```json
{
  "token": "nordus_sess_...",
  "session": {
    "id": "…",
    "label": "iPhone do Avery",
    "scopes": ["admin", "client"],
    "createdAt": 1730000000000,
    "lastSeenAt": 1730000000000,
    "expiresAt": 1732592000000,
    "email": "member@example.com"
  },
  "environment": {
    "environmentId": "…",
    "label": "…",
    "platform": "darwin",
    "version": "1.2.3",
    "capabilities": { "remoteSessions": true, "selfUpdate": "operator", "jobs": true }
  }
}
```

Send the token as `Authorization: Bearer <token>` on every later request; the
scopes are the ones the same address gets when it signs in with the browser.
The answer carries `cache-control: no-store` and sets no cookie.

| Status | Meaning |
| --- | --- |
| 200 | Token issued |
| 400 | Body is not JSON or not a JSON object |
| 401 | Wrong verifier, unknown code, expired code or an already used code |
| 413 | Body over 4 KiB |
| 415 | Content type other than `application/json` |
| 429 | Too many failed attempts from this address; wait and retry |

A failed exchange spends the code: start a new sign-in instead of retrying the
same one.
