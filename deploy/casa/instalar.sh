#!/bin/bash
# Nordus: liga a internet de casa no Mac (agente do launchd que sobe sozinho e volta se cair).
#   ./instalar.sh 100.64.0.20:1080 100.64.0.10      liga
#   ./instalar.sh --desligar                              desliga e remove
set -euo pipefail
ROTULO=ai.nordus.casa
DESTINO="$HOME/.nordus-casa"
PLIST="$HOME/Library/LaunchAgents/$ROTULO.plist"
AQUI="$(cd "$(dirname "$0")" && pwd)"

if [ "${1:-}" = "--desligar" ]; then
  launchctl bootout "gui/$(id -u)/$ROTULO" 2>/dev/null || true
  rm -f "$PLIST"
  rm -rf "$DESTINO"
  echo "Internet de casa desligada."
  exit 0
fi

ESCUTA="${1:?Diga o IP Tailscale deste Mac e a porta, ex.: 100.64.0.20:1080}"
PERMITIDOS="${2:?Diga o IP Tailscale do servidor dos robôs, ex.: 100.64.0.10}"
NODE="$(command -v node || true)"
[ -n "$NODE" ] || { echo "Instale o Node.js 22 ou mais novo primeiro."; exit 1; }

mkdir -p "$DESTINO" "$HOME/Library/LaunchAgents"
cp "$AQUI/socks-casa.mjs" "$AQUI/../../electron/device-egress.mjs" "$AQUI/../../electron/egress-addresses.mjs" "$DESTINO/"
cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$ROTULO</string>
  <key>ProgramArguments</key><array><string>$NODE</string><string>$DESTINO/socks-casa.mjs</string></array>
  <key>EnvironmentVariables</key><dict>
    <key>CASA_ESCUTA</key><string>$ESCUTA</string>
    <key>CASA_PERMITIDOS</key><string>$PERMITIDOS</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>15</integer>
  <key>StandardOutPath</key><string>$DESTINO/casa.log</string>
  <key>StandardErrorPath</key><string>$DESTINO/casa.log</string>
</dict>
</plist>
PLIST
launchctl bootout "gui/$(id -u)/$ROTULO" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
sleep 1
tail -1 "$DESTINO/casa.log" || true
