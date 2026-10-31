import { useCallback, useState } from "react";
import {
  answerJoinRequest, createJoinLink, ensureJoinLink, fetchJoinState, removeJoinLink,
  type JoinApproveRole, type PeopleJoinState,
} from "@/lib/people-join";

const EMPTY: PeopleJoinState = { link: null, requests: [] };

export function usePeopleJoin() {
  const [state, setState] = useState<PeopleJoinState>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async (work: () => Promise<PeopleJoinState | void>) => {
    setBusy(true);
    setError(null);
    try {
      const next = await work();
      if (next) setState(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }, []);

  const reload = useCallback(() => run(fetchJoinState), [run]);
  const ensure = useCallback(() => run(ensureJoinLink), [run]);
  const rotate = useCallback(() => run(async () => ({ ...(await fetchJoinState()), link: await createJoinLink() })), [run]);
  const disable = useCallback(() => run(async () => {
    await removeJoinLink();
    return { ...(await fetchJoinState()), link: null };
  }), [run]);
  const answer = useCallback((id: string, decision: { approve: JoinApproveRole } | { reject: true }) => run(async () => {
    await answerJoinRequest(id, decision);
    return fetchJoinState();
  }), [run]);

  return { state, busy, error, reload, ensure, rotate, disable, answer };
}
