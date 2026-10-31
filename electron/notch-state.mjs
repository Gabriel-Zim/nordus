export const NOTCH_APPEAR_MS = 350;
export const NOTCH_DONE_MS = 2200;
export const NOTCH_MAX_AVATARS = 3;

const HIDDEN = Object.freeze({ visible: false, phase: "idle", expanded: false, avatars: [], text: "", approval: null, buttons: null, target: null });

const initialOf = (name) => {
  const first = [...String(name ?? "").trim()][0];
  return first ? first.toLocaleUpperCase() : "?";
};

const avatarOf = (entry) => ({ initial: initialOf(entry.name), color: entry.color });

const targetOf = (entry) => (entry?.botId && entry?.threadId ? { botId: entry.botId, threadId: entry.threadId } : null);

/**
 * What the notch shows, from the snapshots the app publishes ({ agents, approvals, labels }, already validated by
 * notch-ipc). idle -> working -> approval -> done -> idle. A stretch of work shorter than `appearMs` is never shown.
 * `wakeAt()` is the next moment `advance()` has something to change, or null.
 */
export function createNotchMachine({ appearMs = NOTCH_APPEAR_MS, doneMs = NOTCH_DONE_MS } = {}) {
  let feed = null;
  let phase = "idle";
  let burstAt = 0;
  let appeared = false;
  let doneUntil = 0;
  let recent = [];
  let chosen = null;

  const settle = (now) => {
    if (phase === "done" && now >= doneUntil) {
      phase = "idle";
      appeared = false;
      recent = [];
    }
    if (phase === "approval") appeared = true;
    if (phase === "working" && !appeared && now - burstAt >= appearMs) appeared = true;
  };

  return {
    feed(next, now) {
      settle(now);
      feed = next;
      const waiting = next.approvals.length > 0;
      const busy = next.agents.length > 0;
      if (waiting || busy) {
        if (phase === "idle") {
          burstAt = now;
          appeared = false;
        }
        phase = waiting ? "approval" : "working";
        recent = busy ? next.agents : next.approvals;
        chosen = waiting ? (next.approvals.some((entry) => entry.id === chosen) ? chosen : next.approvals[0].id) : null;
      } else {
        chosen = null;
        if (phase === "working" || phase === "approval") {
          if (appeared) {
            phase = "done";
            doneUntil = now + doneMs;
          } else {
            phase = "idle";
            recent = [];
          }
        }
      }
      settle(now);
    },

    advance(now) {
      settle(now);
    },

    reset() {
      feed = null;
      phase = "idle";
      appeared = false;
      recent = [];
      chosen = null;
    },

    wakeAt() {
      if (phase === "done") return doneUntil;
      if (phase === "working" && !appeared) return burstAt + appearMs;
      return null;
    },

    phase: () => phase,

    view() {
      if (!feed || phase === "idle" || (phase === "working" && !appeared)) return HIDDEN;
      const labels = feed.labels;
      const buttons = { approve: labels.approve, decline: labels.decline, open: labels.open };
      if (phase === "approval") {
        const current = feed.approvals.find((entry) => entry.id === chosen) ?? feed.approvals[0];
        return {
          visible: true,
          phase,
          expanded: true,
          avatars: [avatarOf(current)],
          text: feed.approvals.length > 1 ? `+${feed.approvals.length - 1}` : "",
          approval: { id: current.id, header: current.header, text: current.text, decidable: current.decidable },
          buttons,
          target: targetOf(current),
        };
      }
      const shown = recent.slice(0, NOTCH_MAX_AVATARS).map(avatarOf);
      if (phase === "done") {
        return { visible: true, phase, expanded: false, avatars: shown, text: labels.done, approval: null, buttons, target: targetOf(recent[0]) };
      }
      const several = feed.agents.length > 1;
      return {
        visible: true,
        phase,
        expanded: false,
        avatars: shown,
        text: several ? labels.several.replace("{count}", String(feed.agents.length)) : feed.agents[0].status,
        approval: null,
        buttons,
        target: targetOf(feed.agents[0]),
      };
    },
  };
}
