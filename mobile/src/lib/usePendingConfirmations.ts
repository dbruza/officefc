import { useEffect, useRef, useState } from "react";
import { subscribePendingConfirmations, type PendingMatch } from "./league";

/**
 * Live subscription to the matches awaiting this user's confirmation.
 *
 * The Firestore `onSnapshot` listener already re-syncs on reconnect and app-foreground, so callers
 * must NOT add a manual AppState refetch on top — that just races the listener. This is the single
 * source of truth for both the Home badge count and the Confirmations inbox.
 *
 * `matches` is the actionable inbox (results awaiting MY verdict) and drives badge counts;
 * `outgoing` is my own submissions still waiting on the opponent.
 *
 * `loaded` is false until the first snapshot arrives, so callers can hold their empty state until
 * the listener has actually reported (avoids a "nothing pending" flash before data lands).
 */
export function usePendingConfirmations(
  uid: string | undefined,
  options?: { onError?: () => void },
): { matches: PendingMatch[]; outgoing: PendingMatch[]; loaded: boolean } {
  const [matches, setMatches] = useState<PendingMatch[]>([]);
  const [outgoing, setOutgoing] = useState<PendingMatch[]>([]);
  const [loaded, setLoaded] = useState(false);
  const onErrorRef = useRef(options?.onError);
  onErrorRef.current = options?.onError;

  useEffect(() => {
    if (!uid) {
      setMatches([]);
      setOutgoing([]);
      setLoaded(false);
      return;
    }
    setLoaded(false);
    const unsubscribe = subscribePendingConfirmations(
      uid,
      (buckets) => {
        setMatches(buckets.incoming);
        setOutgoing(buckets.outgoing);
        setLoaded(true);
      },
      () => onErrorRef.current?.(),
    );
    return unsubscribe;
  }, [uid]);

  return { matches, outgoing, loaded };
}
