import { t } from "@/lib/i18n";
import { ASSIGNABLE_ROLES, ROLE_HINT, ROLE_LABEL } from "@/lib/person-roles";
import type { PersonRole } from "../../shared/people";
import { Select } from "./Select";

export function RoleSelect({ value, onChange, label, size, disabled }: {
  value: PersonRole;
  onChange: (role: PersonRole) => void;
  label: string;
  size?: "sm" | "md";
  disabled?: boolean;
}) {
  return (
    <Select size={size} value={value} onChange={(event) => onChange(event.target.value as PersonRole)} aria-label={label} disabled={disabled}>
      {ASSIGNABLE_ROLES.map((role) => (
        <option key={role} value={role} data-description={t(ROLE_HINT[role])}>{t(ROLE_LABEL[role])}</option>
      ))}
    </Select>
  );
}
