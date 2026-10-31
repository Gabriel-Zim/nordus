// The browser as the person sees it on a computer: Chrome's own window, with its own tabs, address bar and profile
// picture, on a screen of its own. Each browser profile gets a private virtual display (Xvfb) with one shared-nothing VNC
// server (x11vnc) that listens only on a Unix socket in a directory of the server's user, so no other profile, bot or
// local user can look at it. The generated launcher starts the display the first time a profile's Chrome starts and
// points that Chrome at it; this module finds it again from the profile's directory.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { delimiter, join } from "node:path";

export interface NativeTools { xvfb: string; x11vnc: string }

export interface NativeSettings extends NativeTools {
  /** Where the displays' owner, size and socket files live (mode 0700). */
  dir: string;
  width: number;
  height: number;
}

const FIRST = 100;
const SLOTS = 800;

/** The POSIX `cksum` of text, which the launcher computes with the `cksum` command to pick a profile's first display number. */
export function posixCksum(text: string): number {
  const bytes = Buffer.from(text, "utf8");
  let crc = 0;
  const update = (byte: number) => {
    crc ^= byte << 24;
    for (let bit = 0; bit < 8; bit++) crc = crc & 0x80000000 ? ((crc << 1) ^ 0x04c11db7) : (crc << 1);
    crc >>>= 0;
  };
  for (const byte of bytes) update(byte);
  for (let length = bytes.length; length > 0; length = Math.floor(length / 256)) update(length & 0xff);
  return (~crc) >>> 0;
}

/** The display number the launcher tries first for a profile; a taken number moves on to the next. */
export function firstDisplayFor(userDataDir: string): number {
  return FIRST + (posixCksum(userDataDir) % SLOTS);
}

function onPath(name: string, env: NodeJS.ProcessEnv): string | null {
  if (name.includes("/")) return existsSync(name) ? name : null;
  for (const dir of (env.PATH ?? "").split(delimiter)) {
    if (dir && existsSync(join(dir, name))) return join(dir, name);
  }
  return null;
}

/** The virtual display and VNC server, when this server runs a windowed browser (NORDUS_BROWSER_HEADED=1) and has both
 * tools: NORDUS_BROWSER_NATIVE=0 turns the window view off, NORDUS_XVFB and NORDUS_X11VNC name tools outside PATH. */
export function nativeTools(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): NativeTools | null {
  if (platform !== "linux" || env.NORDUS_BROWSER_HEADED !== "1" || env.NORDUS_BROWSER_NATIVE?.trim() === "0") return null;
  const xvfb = onPath(env.NORDUS_XVFB?.trim() || "Xvfb", env);
  const x11vnc = onPath(env.NORDUS_X11VNC?.trim() || "x11vnc", env);
  return xvfb && x11vnc ? { xvfb, x11vnc } : null;
}

export function nativeDir(dataDir: string): string {
  return join(dataDir, "browser", "native");
}

export interface NativeScreen { display: number; socket: string; width: number; height: number }

/** The display a profile's Chrome runs on, once its launcher has started one and its VNC socket is up. */
export function nativeScreenOf(dataDir: string, userDataDir: string): NativeScreen | null {
  const dir = nativeDir(dataDir);
  let names: string[];
  try { names = readdirSync(dir); } catch { return null; }
  for (const name of names) {
    const match = /^X(\d+)\.owner$/u.exec(name);
    if (!match) continue;
    try { if (readFileSync(join(dir, name), "utf8") !== userDataDir) continue; } catch { continue; }
    const socket = join(dir, `X${match[1]}.sock`);
    try { if (!statSync(socket).isSocket()) continue; } catch { continue; }
    const [width, height] = (() => { try { return readFileSync(join(dir, `X${match[1]}.size`), "utf8").trim().split("x").map(Number); } catch { return []; } })();
    if (!width || !height) continue;
    return { display: Number(match[1]), socket, width, height };
  }
  return null;
}

const q = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

/** The launcher's part for a windowed Chrome on a private display. A profile that cannot get one runs on the shared display
 * the server already has, as before. Chrome fills the display: it is the only window on it. */
export function nativeLauncherScript(settings: NativeSettings): string[] {
  const size = `${settings.width}x${settings.height}`;
  return [
    "UD=''",
    'for a in "$@"; do case "$a" in --user-data-dir=*) UD=${a#--user-data-dir=};; esac; done',
    'if [ -n "$UD" ]; then',
    `  NDIR=${q(settings.dir)}`,
    '  (umask 077; mkdir -p "$NDIR") && chmod 700 "$NDIR" 2>/dev/null',
    '  N=$(( ' + FIRST + ' + $(printf %s "$UD" | cksum | cut -d" " -f1) % ' + SLOTS + ' )); TRIES=0',
    `  while [ "$TRIES" -lt ${SLOTS} ]; do`,
    '    if ( set -C; printf %s "$UD" > "$NDIR/X$N.owner" ) 2>/dev/null || [ "$(cat "$NDIR/X$N.owner" 2>/dev/null)" = "$UD" ]; then break; fi',
    `    N=$((N + 1)); [ "$N" -ge ${FIRST + SLOTS} ] && N=${FIRST}; TRIES=$((TRIES + 1))`,
    "  done",
    `  if [ "$TRIES" -lt ${SLOTS} ]; then`,
    '    if ! pgrep -f "Xvfb :$N -screen" >/dev/null 2>&1; then',
    `      rm -f "/tmp/.X11-unix/X$N" "/tmp/.X$N-lock"`,
    `      setsid ${q(settings.xvfb)} ":$N" -screen 0 ${size}x24 -nolisten tcp -noreset >"$NDIR/X$N.xvfb.log" 2>&1 </dev/null &`,
    "      W=0; while ! [ -S \"/tmp/.X11-unix/X$N\" ] && [ \"$W\" -lt 50 ]; do sleep 0.1; W=$((W + 1)); done",
    "    fi",
    '    if ! pgrep -f "unixsock $NDIR/X$N.sock" >/dev/null 2>&1; then',
    '      rm -f "$NDIR/X$N.sock"',
    `      setsid ${q(settings.x11vnc)} -display ":$N" -rfbport 0 -unixsock "$NDIR/X$N.sock" -nopw -shared -forever -noxdamage -noxrecord -quiet >"$NDIR/X$N.vnc.log" 2>&1 </dev/null &`,
    '      W=0; while ! [ -S "$NDIR/X$N.sock" ] && [ "$W" -lt 50 ]; do sleep 0.1; W=$((W + 1)); done',
    "    fi",
    `    printf %s ${q(size)} > "$NDIR/X$N.size"`,
    '    DISPLAY=":$N"; export DISPLAY; unset WAYLAND_DISPLAY XAUTHORITY',
    `    set -- "$@" --window-position=0,0 --window-size=${settings.width},${settings.height}`,
    "  fi",
    "fi",
  ];
}
