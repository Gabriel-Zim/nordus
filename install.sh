#!/usr/bin/env bash
# Nordus installer for Linux servers (VPS) and macOS.
#
#   curl -fsSL https://raw.githubusercontent.com/Gabriel-Zim/nordus/main/install.sh | bash
#
# Linux (Ubuntu or Debian): installs the Nordus server as a service with HTTPS and prints the link that signs
# your first device in. macOS: installs the desktop app. Run with --help for every option.
set -euo pipefail
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0

REPO_URL="https://github.com/Gabriel-Zim/nordus"
RAW_URL="https://raw.githubusercontent.com/Gabriel-Zim/nordus/main"
NODE_MAJOR=24
PNPM_VERSION=10.33.0
SERVICE_USER="nordus"

MODE=""
DOMAIN=""
USE_TAILSCALE=0
INSTALL_ENGINES=1
INSTALL_BROWSER=1
REF="main"
LABEL=""
ASSUME_YES=0

say()  { printf '\033[1;36m▸\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m✓\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m✗\033[0m %s\n' "$*" >&2; exit 1; }

usage() {
  cat <<'EOF'
Nordus installer

  curl -fsSL https://raw.githubusercontent.com/Gabriel-Zim/nordus/main/install.sh | bash
  curl -fsSL https://raw.githubusercontent.com/Gabriel-Zim/nordus/main/install.sh | bash -s -- [options]

Modes (chosen automatically when omitted):
  --server            Install the Nordus server (default on Linux). Runs 24/7 as a service.
  --desktop           Install the desktop app (default on macOS).

Server options:
  --domain HOST       Serve at https://HOST. Point HOST's DNS (A record) at this machine first.
                      Without --domain or --tailscale, the address is https://<your-ip>.sslip.io,
                      with a real certificate and no domain to buy.
  --tailscale         Serve only inside your Tailscale network (nothing public).
  --label NAME        Name this server shows in the apps (default: the machine's host name).
  --no-engines        Do not install the Claude Code and Codex command line tools.
  --no-browser        Do not install the browser the bots use.
  --ref BRANCH        Install another branch or tag of the repository (default: main).
  -y, --yes           Do not ask before installing system packages.
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --server|--servidor|--vps) MODE=server ;;
    --desktop|--app) MODE=desktop ;;
    --domain|--dominio) DOMAIN="${2:?--domain needs a host name}"; shift ;;
    --tailscale) USE_TAILSCALE=1 ;;
    --label) LABEL="${2:?--label needs a name}"; shift ;;
    --no-engines|--sem-motores) INSTALL_ENGINES=0 ;;
    --no-browser|--sem-navegador) INSTALL_BROWSER=0 ;;
    --ref) REF="${2:?--ref needs a branch or tag}"; shift ;;
    -y|--yes) ASSUME_YES=1 ;;
    -h|--help|--ajuda) usage; exit 0 ;;
    *) die "unknown option: $1 (see --help)" ;;
  esac
  shift
done

if [ -n "$DOMAIN" ]; then
  DOMAIN="$(printf '%s' "$DOMAIN" | tr 'A-Z' 'a-z' | sed -E 's#^https?://##; s#/+$##')"
  if ! printf '%s' "$DOMAIN" | grep -Eq '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$' \
    || printf '%s' "$DOMAIN" | grep -Eq '(^|\.)(localhost|local|internal|invalid)$'; then
    die "--domain needs a public host name that points at this server, like nordus.example.com"
  fi
fi

OS="$(uname -s)"
if [ -z "$MODE" ]; then
  case "$OS" in
    Darwin) MODE=desktop ;;
    Linux) MODE=server ;;
    *) die "this installer runs on Linux and macOS. On Windows, use install.ps1 (see INSTALL.md)." ;;
  esac
fi

# ── macOS desktop app ─────────────────────────────────────────────────────────────────────────────
install_mac_desktop() {
  [ "$OS" = Darwin ] || die "--desktop installs the macOS app. On Linux, use the server mode."
  local arch asset url tmp mount app
  arch="$(uname -m)"
  if [ "$arch" = arm64 ]; then asset="Nordus.dmg"; else asset="Nordus-intel.dmg"; fi
  url="$REPO_URL/releases/latest/download/$asset"
  tmp="$(mktemp -d)"
  say "Downloading $asset"
  curl -fL --progress-bar -o "$tmp/$asset" "$url" || die "could not download $url. Check $REPO_URL/releases."
  say "Installing Nordus in /Applications"
  mount="$(hdiutil attach -nobrowse -readonly "$tmp/$asset" | awk -F'\t' '/\/Volumes\//{print $NF; exit}')"
  [ -n "$mount" ] || die "could not open the disk image"
  app="$(find "$mount" -maxdepth 1 -name '*.app' | head -n 1)"
  [ -n "$app" ] || { hdiutil detach "$mount" -quiet || true; die "the disk image has no app inside"; }
  if [ -d "/Applications/Nordus.app" ]; then
    osascript -e 'quit app "Nordus"' >/dev/null 2>&1 || true
    rm -rf "/Applications/Nordus.app" 2>/dev/null || sudo rm -rf "/Applications/Nordus.app"
  fi
  ditto "$app" "/Applications/Nordus.app" 2>/dev/null || sudo ditto "$app" "/Applications/Nordus.app"
  hdiutil detach "$mount" -quiet || true
  rm -rf "$tmp"
  # The open source build is not notarized by Apple: without this, macOS refuses to open an app downloaded by a script.
  xattr -dr com.apple.quarantine "/Applications/Nordus.app" 2>/dev/null || sudo xattr -dr com.apple.quarantine "/Applications/Nordus.app" || true
  ok "Nordus installed in /Applications"
  open -a "/Applications/Nordus.app" || true
  cat <<EOF

Nordus is open. Next:
  1. Install and sign in to at least one engine you already pay for:
       Claude Code:  npm install -g @anthropic-ai/claude-code && claude
       Codex:        npm install -g @openai/codex && codex login
  2. Create your first bot in the app. Your data stays in ~/.nordus.
  3. To use a Nordus server you installed on a VPS, open the Server menu and choose
     "Add Server from Copied Pairing Link…".

Full guide: $REPO_URL/blob/main/INSTALL.md
EOF
}

# ── Server (Linux or macOS) ───────────────────────────────────────────────────────────────────────
SUDO=""
as_root() { if [ "$(id -u)" -eq 0 ]; then "$@"; else sudo "$@"; fi; }

need_sudo() {
  if [ "$(id -u)" -ne 0 ]; then
    command -v sudo >/dev/null || die "run this as root, or install sudo"
    sudo -v || die "this installer needs administrator access"
    SUDO=sudo
  fi
}

node_major() { command -v node >/dev/null && node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0; }

install_linux_packages() {
  command -v apt-get >/dev/null || die "this installer supports Ubuntu and Debian (apt). On other distributions, follow docs/deploy-vps.md."
  if [ "$ASSUME_YES" -eq 0 ] && [ -t 0 ]; then
    printf 'This installs Node %s, git and Nordus on this server, as a service that starts on boot. Continue? [Y/n] ' "$NODE_MAJOR"
    read -r answer
    case "$answer" in [nN]*) exit 1 ;; esac
  fi
  say "Installing system packages"
  export DEBIAN_FRONTEND=noninteractive
  as_root apt-get update -qq
  as_root apt-get install -y -qq ca-certificates curl git gnupg build-essential python3 sudo >/dev/null
  if [ "$(node_major)" -lt "$NODE_MAJOR" ]; then
    say "Installing Node $NODE_MAJOR"
    curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | as_root bash - >/dev/null
    as_root apt-get install -y -qq nodejs >/dev/null
  fi
  [ "$(node_major)" -ge "$NODE_MAJOR" ] || die "Node $NODE_MAJOR or newer is required (found $(node -v 2>/dev/null || echo none))"
  ok "Node $(node -v)"
}

ensure_service_user() {
  if ! id "$SERVICE_USER" >/dev/null 2>&1; then
    say "Creating the '$SERVICE_USER' account that runs the server"
    as_root useradd --create-home --shell /bin/bash "$SERVICE_USER"
  fi
  SERVICE_HOME="$(getent passwd "$SERVICE_USER" | cut -d: -f6)"
}

as_service() { as_root sudo -u "$SERVICE_USER" -H env HOME="$SERVICE_HOME" "$@"; }

fetch_and_build() {
  local dir="$1" runner="$2"
  if [ -d "$dir/.git" ]; then
    say "Updating Nordus in $dir"
    $runner git -C "$dir" fetch --depth 1 origin "$REF"
    $runner git -C "$dir" checkout -q FETCH_HEAD
  else
    say "Downloading Nordus into $dir"
    $runner git clone --depth 1 --branch "$REF" "$REPO_URL.git" "$dir"
  fi
  say "Installing dependencies (a few minutes)"
  $runner env COREPACK_ENABLE_DOWNLOAD_PROMPT=0 bash -c "cd '$dir' && corepack pnpm@$PNPM_VERSION install --frozen-lockfile --config.confirmModulesPurge=false"
  say "Building the web app"
  $runner env COREPACK_ENABLE_DOWNLOAD_PROMPT=0 bash -c "cd '$dir' && NODE_OPTIONS=--max-old-space-size=3072 corepack pnpm@$PNPM_VERSION exec vite build --logLevel warn"
  ok "Nordus built"
}

write_cli_wrapper() {
  local dir="$1" user="$2"
  local wrapper
  wrapper="$(mktemp)"
  cat >"$wrapper" <<EOF
#!/bin/sh
# Runs the Nordus command as the account that owns the server, so its data folder stays the same.
if [ "\$(id -un)" != "$user" ]; then
  exec sudo -u "$user" -H -- "\$0" "\$@"
fi
exec node --experimental-strip-types "$dir/server/nordus.ts" "\$@"
EOF
  as_root install -m 755 "$wrapper" /usr/local/bin/nordus
  rm -f "$wrapper"
}

install_engines() {
  [ "$INSTALL_ENGINES" -eq 1 ] || return 0
  say "Installing the Claude Code and Codex command line tools"
  as_root npm install -g --silent @anthropic-ai/claude-code @openai/codex >/dev/null 2>&1 \
    && ok "claude and codex installed" \
    || warn "could not install the engines now; install them later with: sudo npm install -g @anthropic-ai/claude-code @openai/codex"
}

install_browser() {
  [ "$INSTALL_BROWSER" -eq 1 ] || return 0
  say "Installing the browser the bots use"
  if as_root env HOME=/root node --experimental-strip-types "$1/server/nordus.ts" browser install --with-deps >/dev/null 2>&1 \
    && as_service node --experimental-strip-types "$1/server/nordus.ts" browser install >/dev/null 2>&1; then
    ok "browser ready (turn it on in Settings → Computers)"
  else
    warn "the browser was not installed; the rest works. Retry later with: sudo nordus browser install --with-deps && nordus browser install"
  fi
}

public_ipv4() {
  curl -4 -fsS --max-time 8 https://api.ipify.org 2>/dev/null \
    || curl -4 -fsS --max-time 8 https://ifconfig.me 2>/dev/null \
    || true
}

port_busy() { as_root ss -ltnH "( sport = :$1 )" 2>/dev/null | grep -q .; }

choose_address() {
  if [ "$USE_TAILSCALE" -eq 1 ]; then
    command -v tailscale >/dev/null || { say "Installing Tailscale"; curl -fsSL https://tailscale.com/install.sh | as_root sh >/dev/null; }
    as_root tailscale status >/dev/null 2>&1 || as_root tailscale up
    SERVE_ARGS=(--tailscale)
    return
  fi
  if [ -z "$DOMAIN" ]; then
    local ip
    ip="$(public_ipv4)"
    [ -n "$ip" ] || die "could not find this server's public IP. Use --domain HOST or --tailscale."
    DOMAIN="${ip//./-}.sslip.io"
    say "No domain given: using https://$DOMAIN (sslip.io points this name at $ip)"
  fi
  for port in 80 443; do
    port_busy "$port" && die "port $port is already in use on this server (another web server?). Stop it, or install with --tailscale."
  done
  if command -v ufw >/dev/null && as_root ufw status 2>/dev/null | grep -q "Status: active"; then
    as_root ufw allow 80/tcp >/dev/null && as_root ufw allow 443/tcp >/dev/null && ok "firewall: ports 80 and 443 open"
  fi
  SERVE_ARGS=(--domain "$DOMAIN")
}

install_linux_service() {
  local dir="$1"
  local args=("${SERVE_ARGS[@]}")
  [ -n "$LABEL" ] && args+=(--label "$LABEL")
  say "Installing the service"
  local out
  if ! out="$(as_service node --experimental-strip-types "$dir/server/nordus.ts" service install "${args[@]}" 2>&1)" \
    || [ ! -f "$SERVICE_HOME/.nordus/nordus.service" ]; then
    printf '%s\n' "$out" | head -n 3 >&2
    die "could not write the service. The line above says why (a domain must be a public name, like nordus.example.com)."
  fi
  as_root install -m 644 "$SERVICE_HOME/.nordus/nordus.service" /etc/systemd/system/nordus.service
  as_root systemctl daemon-reload
  as_root systemctl enable nordus >/dev/null 2>&1
  as_root systemctl restart nordus
  ok "service 'nordus' running (logs: journalctl -u nordus -f)"
}

wait_until_ready() {
  say "Waiting for the server to answer"
  for _ in $(seq 1 90); do
    if curl -fsS --max-time 2 http://127.0.0.1:8799/api/health >/dev/null 2>&1; then
      ok "server is up"
      return 0
    fi
    sleep 2
  done
  as_root journalctl -u nordus --no-pager -n 40 >&2 || true
  die "the server did not start. The lines above say why."
}

wait_for_https() {
  [ -n "$DOMAIN" ] || return 0
  say "Getting the HTTPS certificate for $DOMAIN"
  for _ in $(seq 1 60); do
    if curl -fsS --max-time 4 "https://$DOMAIN/api/health" >/dev/null 2>&1; then
      ok "https://$DOMAIN is live"
      return 0
    fi
    sleep 3
  done
  warn "https://$DOMAIN is not answering yet. Check that its DNS points at this server and that ports 80 and 443 are open in your provider's firewall."
}

print_next_steps() {
  local address="$1"
  echo
  say "Sign in your first device:"
  nordus pair --label "First device" || warn "run 'nordus pair' to get a sign-in link"
  cat <<EOF

────────────────────────────────────────────────────────────────────────────
 Nordus is running at ${address:-your Tailscale address (see the link above)}

 1. Open the link above in your browser (or scan the QR code with your phone).
    It signs that device in. Run 'nordus pair' whenever you need another link.
 2. Sign the engines in on this server, once (they use your own subscriptions):
      sudo -iu $SERVICE_USER claude              # Claude Code: follow the link it prints
      sudo -iu $SERVICE_USER codex login --device-auth
 3. Optional: let people enter with "Sign in with Google".
      Guide: $REPO_URL/blob/main/docs/google-sign-in.md
 4. Desktop app (Mac or Windows): Server menu → "Add Server from Copied Pairing Link…".

 Update later:   curl -fsSL $RAW_URL/install.sh | bash
 Status:         nordus status    ·    Logs: journalctl -u nordus -f
────────────────────────────────────────────────────────────────────────────
EOF
}

install_server_linux() {
  need_sudo
  install_linux_packages
  ensure_service_user
  local dir="$SERVICE_HOME/nordus"
  as_root bash -c "corepack enable >/dev/null 2>&1 || npm install -g corepack >/dev/null 2>&1"
  fetch_and_build "$dir" as_service
  write_cli_wrapper "$dir" "$SERVICE_USER"
  install_engines
  install_browser "$dir"
  # An update: the running server holds ports 80 and 443 itself; it restarts with the new version below.
  as_root systemctl stop nordus >/dev/null 2>&1 || true
  choose_address
  install_linux_service "$dir"
  wait_until_ready
  wait_for_https
  print_next_steps "${DOMAIN:+https://$DOMAIN}"
}

install_server_mac() {
  command -v git >/dev/null || die "git is missing: run 'xcode-select --install' and try again"
  if [ "$(node_major)" -lt "$NODE_MAJOR" ]; then
    if command -v brew >/dev/null; then
      say "Installing Node $NODE_MAJOR with Homebrew"
      brew install "node@$NODE_MAJOR" >/dev/null
      brew link --overwrite --force "node@$NODE_MAJOR" >/dev/null
    else
      die "Node $NODE_MAJOR or newer is required. Install it from https://nodejs.org and run this again."
    fi
  fi
  local dir="$HOME/nordus"
  corepack enable >/dev/null 2>&1 || true
  fetch_and_build "$dir" ""
  mkdir -p "$HOME/.local/bin"
  cat >"$HOME/.local/bin/nordus" <<EOF
#!/bin/sh
exec node --experimental-strip-types "$dir/server/nordus.ts" "\$@"
EOF
  chmod 755 "$HOME/.local/bin/nordus"
  local args=()
  if [ -n "$DOMAIN" ]; then args=(--domain "$DOMAIN"); elif [ "$USE_TAILSCALE" -eq 1 ]; then args=(--tailscale); fi
  [ -n "$LABEL" ] && args+=(--label "$LABEL")
  node --experimental-strip-types "$dir/server/nordus.ts" service install "${args[@]}" >/dev/null
  local plist="$HOME/Library/LaunchAgents/ai.nordus.serve.plist"
  mkdir -p "$HOME/Library/LaunchAgents"
  launchctl bootout "gui/$(id -u)/ai.nordus.serve" >/dev/null 2>&1 || true
  cp "$HOME/.nordus/ai.nordus.serve.plist" "$plist"
  launchctl bootstrap "gui/$(id -u)" "$plist"
  ok "Nordus server running on this Mac (starts with your login)"
  for _ in $(seq 1 60); do curl -fsS --max-time 2 http://127.0.0.1:8799/api/health >/dev/null 2>&1 && break; sleep 2; done
  open "http://127.0.0.1:8799" || true
  echo
  echo "Open http://127.0.0.1:8799 on this Mac. Add ~/.local/bin to your PATH to use the 'nordus' command."
}

case "$MODE" in
  desktop) install_mac_desktop ;;
  server)
    if [ "$OS" = Darwin ]; then install_server_mac; else install_server_linux; fi
    ;;
esac
