import { useEffect, useState, type FormEvent } from "react";

import { driveApi } from "@/lib/knowledge-api";
import { addressesIn, knowledgeErrorText } from "@/lib/knowledge-ui";
import { t } from "@/lib/i18n";
import { ApiError } from "@/state/api";
import { DialogButtons, Modal } from "./knowledge-dialogs";

function failure(reason: unknown): string {
  if (reason instanceof ApiError && reason.body?.code === "bad_input" && typeof reason.body.entry === "string") return t("drive.access.invalid", { entry: reason.body.entry });
  return knowledgeErrorText(reason);
}

/** An admin chooses who, besides admins, opens the company's Drive and Wiki: whole email addresses, one per line. */
export function InternalPeopleBox({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    driveApi.internalPeople().then(
      (people) => live && setText(people.join("\n")),
      (reason: unknown) => live && setError(failure(reason)),
    );
    return () => {
      live = false;
    };
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (text === null) return;
    setPending(true);
    setError(null);
    try {
      await driveApi.setInternalPeople(addressesIn(text));
      onClose();
    } catch (reason) {
      setError(failure(reason));
      setPending(false);
    }
  };

  return (
    <Modal title={t("drive.access.title")} onClose={onClose} wide>
      <form onSubmit={(event) => void submit(event)} className="mt-3">
        <p className="text-[13px] leading-relaxed text-ink-secondary">{t("drive.access.body")}</p>
        <label className="mt-3 flex flex-col gap-1.5 text-[12.5px] text-ink-secondary">
          {t("drive.access.label")}
          <textarea
            value={text ?? ""}
            onChange={(event) => setText(event.target.value)}
            disabled={text === null}
            rows={6}
            dir="ltr"
            spellCheck={false}
            autoCapitalize="none"
            className="rounded-lg border border-hairline bg-control px-3 py-2 font-mono text-[13px] text-ink outline-none focus-visible:ring-2 focus-visible:ring-focus"
          />
        </label>
        <p className="mt-1.5 text-[12px] text-ink-tertiary">{t("drive.access.hint")}</p>
        {error && <p role="alert" className="mt-2 text-[12.5px] text-danger">{error}</p>}
        <DialogButtons confirm={t("drive.access.save")} onCancel={onClose} pending={pending} disabled={text === null} />
      </form>
    </Modal>
  );
}
