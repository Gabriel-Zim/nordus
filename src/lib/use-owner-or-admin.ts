import { useEffect, useState } from "react";

import { isOwnerOrAdmin, sessionOnce } from "./session";

function ownerOrAdmin(): Promise<boolean> {
  return sessionOnce().then(isOwnerOrAdmin, () => false);
}

export function useOwnerOrAdmin(): boolean | null {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    void ownerOrAdmin().then((value) => {
      if (alive) setAllowed(value);
    });
    return () => {
      alive = false;
    };
  }, []);
  return allowed;
}
