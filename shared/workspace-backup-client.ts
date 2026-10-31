// Exact app-owned browser state that belongs in an encrypted full backup.
// Never include cookies, authentication tokens, connection caches or unknown keys.
export const WORKSPACE_BACKUP_CLIENT_KEYS = [
  "nordus-drafts",
  "nordus-draft-attachments",
  "nordus-draft-send-ids",
  "nordus-draft-channel-modes",
  "nordus-skin",
  "nordus-show-threads",
  "nordus-show-run-card",
  "nordus-send-key",
  "nordus-color-user-bubbles",
  "nordus-chat-width",
  "nordus.sidebarDensity",
  "nordus.sidebarToolsLayout",
  "nordus.sidebarCollapsedSections.v1",
  "nordus.sidebarSectionOrder.v1",
  "nordus-analytics-opt-out",
  "nordus.remote-voice.v1",
] as const;

export type WorkspaceBackupClientState = Partial<Record<(typeof WORKSPACE_BACKUP_CLIENT_KEYS)[number], string>>;
