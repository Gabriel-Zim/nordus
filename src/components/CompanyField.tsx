import { useEffect, useState } from "react";
import { t } from "@/lib/i18n";
import { COMPANY_MAX, oneLine } from "@/lib/onboarding-chat";
import { api, useStore, type ConfigStatus } from "@/state/store";

export function CompanyField() {
  const { state, dispatch } = useStore();
  const saved = state.config?.profile?.company ?? "";
  const [company, setCompany] = useState(saved);
  useEffect(() => setCompany(saved), [saved]);

  const save = () => {
    const next = oneLine(company, COMPANY_MAX);
    if (next === saved) return;
    void api<ConfigStatus>("/api/config", { method: "PUT", body: JSON.stringify({ profile: { company: next } }) })
      .then((config) => dispatch({ type: "profileSaved", profile: { company: config.profile?.company ?? "" } }))
      .catch(() => setCompany(saved));
  };

  return (
    <input
      aria-label={t("onboarding.chat.company.label")}
      value={company}
      maxLength={COMPANY_MAX}
      onChange={(event) => setCompany(event.target.value)}
      onBlur={save}
      placeholder={t("onboarding.chat.company.label")}
      autoComplete="organization"
      className="w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[14px] text-ink placeholder:text-ink-secondary focus:outline-none"
    />
  );
}
