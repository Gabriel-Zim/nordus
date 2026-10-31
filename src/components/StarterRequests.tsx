import { starterRequests } from "@/lib/starter-requests";
import { t } from "@/lib/i18n";

export function StarterRequests({ bot, onPick }: { bot: { title?: string; soul?: string }; onPick: (text: string) => void }) {
  return (
    <div className="mt-5 flex w-full max-w-[440px] flex-col gap-2" role="group" aria-label={t("chat.starter.title")}>
      <p className="text-[12px] text-ink-secondary">{t("chat.starter.title")}</p>
      {starterRequests(bot).map((request) => (
        <button key={request} type="button" onClick={() => onPick(request)}
          className="min-h-11 rounded-2xl border border-hairline/40 bg-raised/40 px-3.5 py-2.5 text-left text-[13.5px] text-ink hover:bg-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
          {request}
        </button>
      ))}
    </div>
  );
}
