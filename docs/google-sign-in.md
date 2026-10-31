# Sign in with Google

Every Nordus server can show a **Sign in with Google** button, so you and your team enter with your Google accounts
instead of pairing links. The server runs the sign-in itself: it uses a Google OAuth client that belongs to you, and
only the people on the server's list get in. Nothing goes through a third party.

You need a server reachable over HTTPS (the [VPS installer](../INSTALL.md#2-a-server-vps) gives you one) and about
five minutes.

## 1. Copy the redirect address from Nordus

Open your Nordus (signed in with a pairing link the first time), then **Settings → People → Login com Google**.
Copy the **redirect URI** shown there. It looks like `https://your-address/auth/google/callback`.

## 2. Create the Google client

1. Open [Google Cloud Console → APIs & Services → Credentials](https://console.cloud.google.com/apis/credentials)
   and pick or create a project (any name, for example "Nordus").
2. If Google asks, configure the **OAuth consent screen**: user type **External**, app name "Nordus", your email as
   support and developer contact. No scopes to add. Under **Audience**, publish the app (or add each person as a
   test user).
3. **Create credentials → OAuth client ID → Web application.**
4. Under **Authorized redirect URIs**, paste the address from step 1. Save.
5. Copy the **Client ID** (ends in `.apps.googleusercontent.com`) and the **Client secret**.

## 3. Turn it on in Nordus

Back in **Settings → People → Login com Google**, paste the client ID and the secret and press **Save**. The secret
is encrypted on the server and never shown again.

## 4. Say who may enter

Add each person under **Settings → People**, or from the server's terminal:

```sh
nordus access add you@gmail.com             # full access
nordus access add teammate@company.com      # another person
nordus access add @company.com              # everyone at a Google Workspace domain
nordus access add client@example.com --chat-only   # chats and approvals, no settings
nordus access list
```

Open your Nordus address in a new browser: the **Sign in with Google** button is there. Anyone not on the list sees a
polite waiting screen and shows up in **People** for you to approve.

## Troubleshooting

- **`redirect_uri_mismatch`**: the redirect URI in Google is not exactly the one Nordus shows (check `https`, the
  host and the path). Fix it in the Google client and try again after a minute.
- **"Access blocked: app not verified"**: the consent screen is still in testing. Publish it, or add the person as a
  test user.
- **The address changed** (new domain, or you moved from the `sslip.io` address to your own domain): add the new
  redirect URI in the same Google client. Several can live side by side.
