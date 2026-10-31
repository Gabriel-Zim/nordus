import { t } from "@/lib/i18n";
import { WEBHOOK_DEFAULT_MAX_PER_MINUTE, type WebhookTrigger } from "@/lib/webhooks";

export function WebhookChecks({ webhook }: { webhook: Pick<WebhookTrigger, "signature" | "maxPerMinute"> }) {
  const { signature } = webhook;
  return (
    <>
      <p>
        <span className="font-medium text-ink">{t("triggers.signature")}</span>{" "}
        {signature
          ? t(signature.configured ? "triggers.signatureOn" : "triggers.signatureMissing", { scheme: signature.scheme })
          : t("triggers.signatureOff")}
      </p>
      <p><span className="font-medium text-ink">{t("triggers.perMinute")}</span> {t("triggers.perMinuteHelp", { count: webhook.maxPerMinute ?? WEBHOOK_DEFAULT_MAX_PER_MINUTE })}</p>
    </>
  );
}
