import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import {
  BROWSER_SIGN_IN_FAILED, previewBrowserSignIn, sessionOnce, SERVICE_TRUST_REASON, takeBrowserSignInFromLocation, takePairingCodeFromLocation, takeInvitedEmailFromLocation, takeJoinTokenFromLocation,
} from "./lib/session";
import { startEarlyRequests } from "./lib/early-requests";
import { readLastConversation } from "./lib/last-conversation";
import { bootstrapBrand } from "./lib/brand";
import { DEFAULT_LOCALE, loadLocale, setLocale } from "./lib/i18n";
import { languageChoice } from "./lib/language-preference";
import { applyThemeMode, readThemeMode } from "./lib/theme-mode";
import { applyChatWidth, readChatWidth } from "./lib/chat-width";
import { applyFont, readFont } from "./lib/fonts";
import { applyAccent, readAccent } from "./lib/accent-color";
import { applyBackgroundTone } from "./lib/background-tone";
import { installLiquidGlass } from "./lib/liquid-glass";
import { installGlassMotion } from "./lib/glass-motion";
import { settleAdvancedModeDefault } from "./lib/interface-mode";
import { holdReloadWhile, installPageBuildWatch } from "./lib/page-build";
import { currentCall } from "./lib/call";
import { uploadsInFlight } from "./lib/composer-attachments";
import { settleOutboxOwner } from "./lib/app-outbox";
import { BrowserSignInPage } from "./pair/BrowserSignInPage";
import { PairPage } from "./pair/PairPage";
import { NordusLoginPage, takeLoginRefusalFromLocation } from "./pair/NordusLoginPage";
import { PageBoundary } from "./components/PageBoundary";
import "./styles.css";

// Before first paint; settleAdvancedModeDefault must run before applyThemeMode writes nordus-skin.
settleAdvancedModeDefault();
// The iOS app injects window.nordusNative; inside it the interface takes the system font.
if (typeof window !== "undefined" && (window as { nordusNative?: unknown }).nordusNative) document.documentElement.dataset.iosApp = "";
applyThemeMode(readThemeMode());
applyFont(readFont());
applyAccent(readAccent());
applyBackgroundTone();
installLiquidGlass();
installGlassMotion();
applyChatWidth(readChatWidth());
installPageBuildWatch();
// A new build waits for a call to end and every upload to land: a reload would cut both short.
holdReloadWhile(() => currentCall() !== null || uploadsInFlight() > 0);

// The list and the engines start loading beside the session check, not behind it (the same cookie answers both).
if (location.pathname !== "/pair" && location.pathname !== "/desktop-viewer" && !(window as { ogb?: { remoteClient?: unknown } }).ogb?.remoteClient) {
  startEarlyRequests(readLastConversation());
}

async function chooseRoot(): Promise<React.ReactNode> {
  if (location.pathname === "/pair") {
    const signIn = takeBrowserSignInFromLocation();
    if (signIn) {
      const preview = await previewBrowserSignIn(signIn);
      return preview ? <BrowserSignInPage credential={signIn} owner={preview.owner} /> : <PairPage initialCode={null} reason={BROWSER_SIGN_IN_FAILED} />;
    }
    const joinToken = takeJoinTokenFromLocation();
    if (joinToken) return <NordusLoginPage joinToken={joinToken} returnTo="/" googleOnly />;
    return <PairPage initialCode={takePairingCodeFromLocation()} initialEmail={takeInvitedEmailFromLocation()} />;
  }
  const refusal = takeLoginRefusalFromLocation();
  const session = await sessionOnce();
  if (session.kind === "unauthenticated") return <NordusLoginPage reason={session.error} refusal={refusal} />;
  if (session.kind === "loopback" && session.trust === "service") return <NordusLoginPage reason={SERVICE_TRUST_REASON} refusal={refusal} />;
  if (session.kind === "session") settleOutboxOwner(session.email);
  if (location.pathname === "/desktop-viewer") {
    const { DesktopViewer } = await import("./components/DesktopViewer");
    return <DesktopViewer />;
  }
  return <App />;
}

// t() is synchronous, so the saved language is in memory before the first render (pt-br already is).
async function loadSavedLocale(): Promise<void> {
  const saved = languageChoice() || DEFAULT_LOCALE;
  await loadLocale(saved);
  setLocale(saved);
}

void Promise.all([bootstrapBrand(), loadSavedLocale(), chooseRoot()]).then(([, , root]) => {
  createRoot(document.getElementById("root")!).render(<StrictMode><PageBoundary>{root}</PageBoundary></StrictMode>);
});
