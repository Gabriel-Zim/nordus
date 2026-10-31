import { useState } from "react";
import { Loader2 } from "lucide-react";

import type { ComputerHelpRef } from "../../../shared/wire";
import { answerSignIn } from "@/lib/sign-in";
import { t } from "@/lib/i18n";

/** The sign-in request inside the browser stage: one translucent line at the top, with the one button that hands the login back. */
export function StageSignIn({ help, askerName }: { help: ComputerHelpRef; askerName: string }) {
  const [pending, setPending] = useState<"done" | "cancel" | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const answer = async (choice: "done" | "cancel") => {
    if (pending) return;
    setPending(choice);
    setProblem(null);
    try { await answerSignIn(help, choice); }
    catch (cause) { setProblem(cause instanceof Error ? cause.message : String(cause)); }
    finally { setPending(null); }
  };
  return (
    <div className="absolute left-1/2 top-3 z-30 flex max-w-[calc(100%-120px)] -translate-x-1/2 flex-col items-center gap-1" data-testid="browser-stage-signin">
      <div className="flex max-w-full items-center gap-2.5 rounded-full bg-black/60 py-1.5 pe-2 ps-1.5 text-[13px] text-white shadow-lg ring-1 ring-white/10 backdrop-blur-md">
        <span aria-hidden="true" className="grid size-6 shrink-0 place-items-center rounded-full bg-white/20 text-[11px] font-semibold uppercase">{askerName.slice(0, 1)}</span>
        <span className="min-w-0 truncate"><b className="font-medium">{askerName}</b> {t("signIn.banner", { site: help.site })}</span>
        <button type="button" onClick={() => void answer("done")} disabled={pending !== null}
          className="flex h-7 shrink-0 items-center rounded-full bg-[#ff6633] px-3 text-[12px] font-medium text-white hover:brightness-110 disabled:opacity-60">
          {pending === "done" ? <Loader2 size={13} className="animate-spin" /> : t("signIn.done")}
        </button>
        <button type="button" onClick={() => void answer("cancel")} disabled={pending !== null}
          className="shrink-0 px-1.5 text-[12px] text-white/70 hover:text-white disabled:opacity-60">{t("signIn.cancel")}</button>
      </div>
      {problem && <p role="alert" className="rounded-full bg-black/60 px-3 py-1 text-[12px] text-red-300">{problem}</p>}
    </div>
  );
}
