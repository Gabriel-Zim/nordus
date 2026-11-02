# Install Nordus

This guide is written for people **and** for AI coding agents (Claude Code, Codex and others). If you are an agent
installing Nordus for someone, follow the section that matches where they want it, run the commands yourself, and
finish by giving them the link that signs them in. Ask only what the guide marks as a question for the person.

Pick one:

1. [**On my computer**](#1-on-my-computer-mac-or-windows): the desktop app for Mac or Windows. Five minutes.
2. [**On a server (VPS)**](#2-a-server-vps): Nordus runs 24/7 at `your-name.nordus.ai`, reachable from the
   browser, the desktop apps and your phone, with Sign in with Google. Ten to fifteen minutes.
3. [**Both**](#3-connect-the-apps-to-your-server): the server does the work, and the desktop apps connect to it.

Every path needs at least one AI engine you already have an account for. Nordus does not resell models: bots run on
your own [Claude](https://claude.com/claude-code) (Pro or Max plan, or an API key), [Codex](https://github.com/openai/codex)
(ChatGPT plan) or [Grok](https://x.ai/cli) subscription.

---

## 1. On my computer (Mac or Windows)

### Mac

In **Terminal**:

```sh
curl -fsSL https://raw.githubusercontent.com/Gabriel-Zim/nordus/main/install.sh | bash
```

It downloads the right app for your Mac (Apple silicon or Intel), installs it in `/Applications` and opens it.

By hand instead: download [Nordus.dmg](https://github.com/Gabriel-Zim/nordus/releases/latest/download/Nordus.dmg)
(Apple silicon) or [Nordus-intel.dmg](https://github.com/Gabriel-Zim/nordus/releases/latest/download/Nordus-intel.dmg)
(Intel), drag Nordus to Applications, then **right-click → Open** the first time. The open source build is not
notarized by Apple, so macOS asks once. If it says the app "is damaged", run
`xattr -dr com.apple.quarantine /Applications/Nordus.app` and open it again.

### Windows

In **PowerShell**:

```powershell
irm https://raw.githubusercontent.com/Gabriel-Zim/nordus/main/install.ps1 | iex
```

By hand instead: download [Nordus-setup.exe](https://github.com/Gabriel-Zim/nordus/releases/latest/download/Nordus-setup.exe)
and run it. The installer is not signed with a paid certificate, so SmartScreen may say "Windows protected your PC":
choose **More info → Run anyway**.

### Ubuntu desktop

Download [Nordus-amd64.deb](https://github.com/Gabriel-Zim/nordus/releases/latest/download/Nordus-amd64.deb) and
install it with `sudo apt install ./Nordus-amd64.deb`.

### Then

1. Install and sign in to an engine, if you have not yet:

   ```sh
   npm install -g @anthropic-ai/claude-code && claude      # Claude Code
   npm install -g @openai/codex && codex login             # Codex
   ```

   (No Node? Get it from [nodejs.org](https://nodejs.org). Installed engines show up in Nordus on their own.)
2. In Nordus, create your first bot, or open the library and add one of the ready-made bots.
3. Your bots, chats and settings live in `~/.nordus` on this computer.
4. **Open it from anywhere (optional):** **Settings → Account → Endereço nordus.ai → Conectar com a conta Nordus**.
   The browser opens: sign in with Google and choose `your-name.nordus.ai`. While this computer is on, you and the
   people you invite reach it there with Sign in with Google, from any browser or phone.

The desktop app runs its own server: nothing else to set up. To keep bots working while the computer sleeps, use a
server (next section).

---

## 2. A server (VPS)

**What you need:** a Linux server with Ubuntu 22.04 or 24.04 (or Debian 12), 2 CPUs and 4 GB of RAM or more, and
root or sudo access. Any provider works (Hetzner, DigitalOcean, Contabo, Hostinger, AWS Lightsail, Oracle, a Mac mini
in a cupboard...). No domain and no open ports needed.

Connect to the server (`ssh root@YOUR_SERVER_IP`) and run:

```sh
curl -fsSL https://raw.githubusercontent.com/Gabriel-Zim/nordus/main/install.sh | bash -s -- --yes
```

What it does, in order (about ten minutes):

1. Installs Node 24, git and the build tools.
2. Creates a `nordus` account that runs the server, downloads Nordus into `/home/nordus/nordus` and builds it.
3. Installs the Claude Code and Codex command line tools, and the browser the bots use.
4. **Connects it to your Nordus account.** It prints a link like `https://conta.nordus.ai/ativar?codigo=BCDF-GHJK`
   and waits. Open it in any browser, sign in with Google, check that the code matches and choose the address,
   for example `loja-da-ana.nordus.ai`. The code is good for 30 minutes; if it runs out, the installer shows a new one.
5. Installs the `nordus` service (systemd): it starts on boot, restarts on failure and serves your address through a
   Cloudflare tunnel, with HTTPS, without opening ports. It works behind a home router too.

When it ends, open your address and choose **Entrar com Google**. The Google account you connected with is the owner,
with full access. All your servers are listed at [conta.nordus.ai](https://conta.nordus.ai).

**Other addresses**, if you prefer not to use the account:

| Option | Command | Needs |
| --- | --- | --- |
| Your own domain | `... \| bash -s -- --yes --domain nordus.yourcompany.com` | An A record pointing at the server; ports 80 and 443 open |
| `https://<ip>.sslip.io` | `... \| bash -s -- --yes --sslip` | Ports 80 and 443 open |
| Private, your devices only | `... \| bash -s -- --yes --tailscale` | [Tailscale](https://tailscale.com) |

With these, "Sign in with Google" uses a Google client of your own ([guide](docs/google-sign-in.md)), and the first
device signs in with the link the installer prints.

### Finish the setup

1. **Sign the engines in on the server**, once. They use your own subscriptions:

   ```sh
   sudo -iu nordus claude                      # Claude Code: open the link it prints and paste the code back
   sudo -iu nordus codex login --device-auth   # Codex
   ```

2. **Invite your team:** `nordus access add name@example.com`. They sign in with Google at your address.
3. **Phone:** open your address in Safari or Chrome and add it to the home screen. It works like an app, with
   notifications ([details](docs/phone-web-app.md)).

### Everyday commands (on the server)

```sh
nordus status                    # what the server says about itself
nordus login                     # connect to your Nordus account again (a new code)
nordus pair                      # a sign-in link for another device or app
nordus sessions                  # signed-in devices;  nordus sessions revoke ID
nordus access add a@gmail.com    # who may sign in with Google
journalctl -u nordus -f          # live logs
sudo systemctl restart nordus    # restart
```

**Update** by running the same install command again: it pulls the latest version, rebuilds and restarts, keeping
bots, chats and sign-ins. **Back up** `/home/nordus/.nordus` (and `/home/nordus/.claude`, `/home/nordus/.codex`) with
the service stopped.

---

## 3. Connect the apps to your server

- **Browser:** open your server's address (`https://your-name.nordus.ai`, or your domain) and sign in with Google.
- **Desktop app (Mac or Windows):** run `nordus pair` on the server and copy the link. In the app, open the
  **Server** menu → **Add Server from Copied Pairing Link…**. The same menu switches between this computer and every
  server you added. (In Settings: **Remote access → Connect to another computer → Self-hosted server**.)
- **Phone:** scan the QR code from `nordus pair`, or open the address and add it to the home screen.

---

## For AI agents: checklist

- Detect the target: the person's own computer (macOS or Windows → section 1) or a server (Linux → section 2). For a
  remote server, run the commands over `ssh`. Never paste secrets into the chat; engine sign-ins happen in the
  person's browser.
- On a server, run the installer with `--yes`. It stops at "Connect this Nordus to your account" and prints a link
  and a code: **show both to the person right away** and ask them to open the link, sign in with Google and choose
  the address. The installer continues by itself when they confirm (it shows a new code if the first one runs out).
  Use `--domain HOST` only if the person asks for their own domain.
- Confirm with `nordus status` and `curl -fsS https://<address>/api/health`.
- Tell the person to open the address and choose **Entrar com Google**, then to sign the engines in.
- Optional next steps to offer: inviting the team (`nordus access add`), the phone home screen app, the desktop app.

## Troubleshooting

- **The code expired** or the link says "Código inválido": run the installer again (or `nordus login`) for a new one.
- **The address shows "Cloudflare Tunnel error"**: the server is not running. `sudo systemctl status nordus` and
  `journalctl -u nordus -n 50` say why.
- **With `--domain` or `--sslip`**: port 80 or 443 busy means another web server (nginx, Apache) runs there; an address
  that does not load means the provider's firewall blocks 80/443 or the A record does not point at the server yet.
- **"Engine not signed in"** in a chat: sign it in again on the server (`sudo -iu nordus claude`).
- **The browser for bots fails on Ubuntu 24.04** with "No usable sandbox": see the AppArmor note in
  [docs/deploy-vps.md](docs/deploy-vps.md#ubuntu-2404-browser-sandbox).
- Anything else: `journalctl -u nordus --since -10m`, then [open an issue](https://github.com/Gabriel-Zim/nordus/issues)
  with those lines.

## Good to know

- **Connected apps (Gmail, Slack, GitHub, Notion and 500 more)** run through [Composio](https://composio.dev). In the
  open source build you use your own free Composio project key: create a project at composio.dev, copy its API key
  and paste it in **Settings → API keys → Self-host connected apps**. On a server you can also start it with
  `COMPOSIO_API_KEY` in the environment. Custom MCP servers need no key.
- **Your Nordus account** ([conta.nordus.ai](https://conta.nordus.ai)) keeps only your Google identity (email, name,
  photo) and the addresses you chose. Bots, chats and keys stay on your server; the account only passes the sign-in
  and the tunnel. Up to 5 addresses per account. `nordus logout` on the server releases its address. The service is
  in [cloudflare/conta](cloudflare/conta).
- **Nordus Cloud** (cloud computers sold in the app) is a service of the hosted product and is not part of the open
  source build.
- **Unsigned builds:** the desktop installers are not signed with paid Apple or Microsoft certificates yet. The
  one-line installers handle the warnings for you; by hand, see the notes in section 1.
