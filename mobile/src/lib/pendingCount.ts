/**
 * Count of results awaiting the signed-in user's verdict, provided once by the (app)
 * layout (which owns the live subscription) so nav chrome can badge without opening
 * its own listener.
 */
import { createContext, useContext } from "react";

export const PendingCountContext = createContext(0);

export function usePendingCount(): number {
  return useContext(PendingCountContext);
}
