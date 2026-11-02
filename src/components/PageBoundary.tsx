import { Component, type ReactNode } from "react";

import { t } from "@/lib/i18n";

// React unmounts everything below a root that has no error boundary when a render or an effect throws (react.dev,
// "Catching rendering errors with an error boundary"), which left a page showing only the body's background.
export class PageBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" className="flex min-h-screen items-center justify-center bg-panel p-6 text-center text-ink">
        <div className="max-w-md space-y-3">
          <h1 className="text-lg font-semibold">{t("page.broken.title")}</h1>
          <p className="text-sm text-ink-secondary">{t("page.broken.body")}</p>
          <p className="break-words text-xs text-ink-tertiary">{this.state.error.message}</p>
          <button type="button" className="ui-button ui-button-md" onClick={() => location.reload()}>
            {t("page.broken.reload")}
          </button>
        </div>
      </div>
    );
  }
}
