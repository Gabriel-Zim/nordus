import { ChevronRight } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { useShowThreads } from "@/lib/thread-preferences";
import { membersOf, waitingThreadOf } from "@/lib/team-members";
import { botStepNow } from "@/lib/work-steps";
import { openWhereBotWaits } from "@/state/thread-navigation";
import { useStore, type Bot } from "@/state/store";
import { BotAvatar } from "../Avatar";
import { botWorkingIn, sidebarBotActivityTasks } from "../SidebarBotActivity";

const openChatCls = "flex shrink-0 items-center gap-0.5 rounded-md py-1 pl-2 pr-1 text-[13px] font-medium text-ink hover:bg-raised";

export function TeamSection({ leader, onClose }: { leader: Bot; onClose: () => void }) {
  const { state, dispatch } = useStore();
  const showThreads = useShowThreads();
  const members = membersOf(state.bots, leader);
  return (
    <div className="ios-group divide-y divide-hairline/40 border-y border-hairline/40">
      {members.map((member) => {
        const activityTasks = sidebarBotActivityTasks(member, state.pendingQueued);
        const waiting = Boolean(waitingThreadOf(member));
        const working = !waiting && botWorkingIn(member, activityTasks);
        const line = waiting ? t("sidebar.preview.waiting") : (working ? botStepNow(member, state.groups) : null) ?? member.title;
        return (
          <div key={member.id} data-team-member={member.id} className="flex items-center gap-3 py-3">
            <BotAvatar bot={member} size={40} />
            <div className="min-w-0 flex-1">
              <div className="nb-name truncate text-[13.5px] font-semibold text-ink">{member.name}</div>
              {line && <div className={cn("truncate text-[12.5px]", waiting ? "text-warning" : "text-ink-secondary")}>{line}</div>}
            </div>
            <button
              type="button"
              data-team-open={member.id}
              aria-label={t("botSettings.simple.teamOpenChatAria", { name: member.name })}
              onClick={() => {
                onClose();
                openWhereBotWaits(dispatch, member, waitingThreadOf(member), showThreads);
              }}
              className={openChatCls}
            >
              {t("botSettings.simple.teamOpenChat")}
              <ChevronRight size={14} className="shrink-0 text-ink-secondary" aria-hidden="true" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
