import { useEffect, useState } from "react";

import { isLoginRefusal, JOIN_PENDING_TITLE, LOGIN_REFUSAL_TEXT, WAITLIST_TITLE, type LoginRefusal, type LoginStatus } from "../../shared/nordus-login";
import { PairPage } from "./PairPage";

/** Taken off the address bar before anything renders, so a reload does not show the message again. */
export function takeLoginRefusalFromLocation(): LoginRefusal | null {
  const params = new URLSearchParams(location.search);
  const raw = params.get("login_erro");
  if (raw === null) return null;
  params.delete("login_erro");
  const search = params.toString();
  history.replaceState(null, "", location.pathname + (search ? `?${search}` : "") + location.hash);
  return isLoginRefusal(raw) ? raw : "falhou";
}

export function googleStartHref(path: string, search: string, joinToken?: string | null): string {
  const back = `${path}${search}`;
  const params = new URLSearchParams();
  if (back !== "/") params.set("voltar", back);
  if (joinToken) params.set("convite", joinToken);
  const query = params.toString();
  return query ? `/auth/google?${query}` : "/auth/google";
}

export async function readLoginStatus(fetchImpl: typeof fetch = fetch): Promise<LoginStatus> {
  try {
    const res = await fetchImpl("/auth/status", { credentials: "same-origin", cache: "no-store" });
    const body = res.ok ? await res.json() as Partial<LoginStatus> : null;
    return { google: body?.google === true };
  } catch {
    return { google: false };
  }
}

/** A native shell that runs the Google sign-in in the system's browser sheet (see /auth/app/troca on the server). */
declare global {
  interface Window { nordusNative?: { signInWithGoogle?: () => Promise<void> } }
}

export function nativeGoogleSignIn(): (() => Promise<void>) | null {
  const hook = typeof window === "undefined" ? undefined : window.nordusNative?.signInWithGoogle;
  return typeof hook === "function" ? hook : null;
}

export function NordusMark({ size = 30 }: { size?: number }) {
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} aria-hidden="true">
      <path fill="currentColor" d="M73.97,33.37s-.03-.09-.08-.09c-.03,0-.07.02-.08.05-2.3,4.07-4.23,7.61-5.79,10.61-.34.64-.74,1.2-1.47,1.15-1.08-.07-1.25-.71-1.27-1.75-.1-4.44-.16-7.83-.2-10.15,0-.25-.19-.46-.44-.5-3.29-.47-7.23-.95-11.83-1.44-.86-.09-1.95-1.27-1-2.04.42-.34.75-.57.99-.71,8.24-4.51,16.91-9.53,26-15.06,1.24-.76,2.33-.62,3.27.4.16.18.25.4.25.64v69.92c0,.14-.11.25-.25.25h-7.4c-.16,0-.31-.07-.42-.19l-22.58-25.35c-.16-.19-.45-.21-.64-.05-2.43,1.94-4.16,3.3-5.2,4.08-8.89,6.7-17.4,13.15-25.53,19.38-.63.49-1.9,1.38-3.8,2.68-.14.09-.32.06-.41-.08-.04-.05-.05-.11-.05-.17V13.76c0-.28.22-.5.5-.5h6.7c.16,0,.32.07.42.19l23.14,26.62c.24.27.6.4.96.34,3.34-.55,6.11.33,8.31,2.63,2.6,2.71,3.39,6.65,1.82,10.14-.06.14-.04.31.07.42l15.9,17.85s.07.03.1,0c.02-.01.03-.04.03-.06v-38.04ZM24.49,71.86c2.09-3.05,4.13-6.19,6.12-9.44,4.28-7.02,7.63-12.58,10.05-16.66.08-.13.06-.3-.04-.41l-16.17-18.15s-.08-.03-.11,0c-.01.01-.02.03-.02.05v44.57c0,.05.04.09.09.09.03,0,.06-.02.07-.04ZM53.83,49.88c0-2.52-2.04-4.56-4.56-4.56h0c-2.52,0-4.56,2.04-4.56,4.56h0c0,2.52,2.04,4.56,4.56,4.56s4.56-2.04,4.56-4.56Z" />
    </svg>
  );
}

function GoogleG() {
  return (
    <svg viewBox="0 0 48 48" width="18" height="18" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

/** The page an unauthenticated visitor sees: Nordus's own, with Google sign-in. Without a Google client it is the pairing page. */
export function NordusLoginPage({ reason, refusal: initialRefusal = null, notice, returnTo, googleOnly = false, joinToken = null }: {
  reason?: string;
  refusal?: LoginRefusal | null;
  notice?: string;
  /** Where Google sends the person back; the page's own address when absent. */
  returnTo?: string;
  /** Signing in again after a lost session: Google is the way back, so the pairing link stays out. */
  googleOnly?: boolean;
  /** The invite link's token, carried through Google so a new account can ask to join. */
  joinToken?: string | null;
}) {
  const [status, setStatus] = useState<LoginStatus | null>(null);
  const [refusal, setRefusal] = useState<LoginRefusal | null>(initialRefusal);
  const [leaving, setLeaving] = useState(false);
  useEffect(() => { void readLoginStatus().then(setStatus); }, []);

  const waiting = refusal === "lista_de_espera";
  const requested = refusal === "pendente";
  if (status === null) return <main className="nordus-login" aria-busy="true" />;
  if (!status.google) return <PairPage initialCode={null} reason={notice ?? reason} joinToken={joinToken} />;

  return (
    <main className="nordus-login">
      <div className="nordus-login-card">
        <div className="flex items-center gap-3">
          <span className="nordus-login-logo"><NordusMark /></span>
          <span className="text-[22px] font-semibold tracking-[-0.01em] text-white">Nordus</span>
        </div>
        {requested ? (
          <>
            <h1 className="mt-7 text-[19px] font-semibold text-white">{JOIN_PENDING_TITLE}</h1>
            <p role="status" className="mt-1.5 text-[14px] leading-relaxed text-white/60">{LOGIN_REFUSAL_TEXT.pendente}</p>
          </>
        ) : waiting ? (
          <>
            <h1 className="mt-7 text-[19px] font-semibold text-white">{WAITLIST_TITLE}</h1>
            <p role="status" className="mt-1.5 text-[14px] leading-relaxed text-white/60">{LOGIN_REFUSAL_TEXT.lista_de_espera}</p>
          </>
        ) : (
          <>
            <h1 className="mt-7 text-[19px] font-semibold text-white">Entrar</h1>
            <p className="mt-1.5 text-[14px] leading-relaxed text-white/60">Use a sua conta Google da equipe para abrir a Nordus.</p>
            {notice && !refusal ? <p role="status" className="nordus-login-alert">{notice}</p> : null}
            {refusal ? <p role="alert" className="nordus-login-alert">{LOGIN_REFUSAL_TEXT[refusal]}</p> : null}
          </>
        )}
        <a
          href={returnTo ? googleStartHref(returnTo, "", joinToken) : googleStartHref(location.pathname, location.search, joinToken)}
          onClick={(event) => {
            setLeaving(true);
            const native = nativeGoogleSignIn();
            if (!native) return;
            event.preventDefault();
            setRefusal(null);
            void native()
              .catch((error: unknown) => {
                const why = error instanceof Error ? error.message : "";
                setRefusal(isLoginRefusal(why) ? why : "falhou");
              })
              .finally(() => setLeaving(false));
          }}
          aria-disabled={leaving}
          className="nordus-login-google"
        >
          <GoogleG />
          <span>{leaving ? "Abrindo o Google…" : waiting || requested ? "Entrar com outra conta" : "Entrar com Google"}</span>
        </a>
        {googleOnly ? null : <a href="/pair" className="mt-5 block text-center text-[13px] text-white/50 transition-colors hover:text-white/80">Tenho um código de pareamento</a>}
      </div>
      <p className="nordus-login-foot">Nordus, da Zorg Content</p>
    </main>
  );
}
