import { Plus } from "lucide-react";
import { cn } from "@/lib/cn";
import { SidebarPopoverMenu, type SidebarMenuItem } from "./SidebarPopoverMenu";

export function ComposerPlusButton({ items, label, phone }: {
  items: SidebarMenuItem[];
  label: string;
  phone: boolean;
}) {
  return (
    <SidebarPopoverMenu
      items={items}
      ariaLabel={label}
      placement="above"
      triggerClassName=""
      triggerTitle={label}
      renderTrigger={() => (
        <span data-composer-plus="" className={cn("flex items-center justify-center rounded-full text-ink", phone ? "size-11" : "size-8")}>
          <Plus size={phone ? 22 : 18} strokeWidth={2} aria-hidden="true" />
        </span>
      )}
    />
  );
}
