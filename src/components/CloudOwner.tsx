import { useEffect, useState } from "react";
import { cloudOwnerOf, sessionBodyOnce } from "@/lib/session";

export function useCloudOwner(cloudHome: boolean): string | null {
  const [owner, setOwner] = useState<string | null>(null);
  useEffect(() => {
    if (!cloudHome) return;
    let active = true;
    void sessionBodyOnce().then((session) => { if (active) setOwner(cloudOwnerOf(session)); }).catch(() => {});
    return () => { active = false; };
  }, [cloudHome]);
  return cloudHome ? owner : null;
}
