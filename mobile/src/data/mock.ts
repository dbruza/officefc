/**
 * Tiny in-memory mock for M0 visual verification only. The production app reads from
 * Firestore; this exists so the showcase screen can render the ported primitives.
 * Players mirror prototype/officefc/app/data.js.
 */
import type { ChartPoint } from "@/components";
import type { MatchResult, Player } from "@/types";

export const players: Player[] = [
  { id: "p1", name: "Marcus Bell", handle: "marcus", jersey: 10, color: "#00ff87", isYou: true },
  { id: "p2", name: "Dave Okafor", handle: "big_dave", jersey: 9, color: "#ff5470" },
  { id: "p3", name: "Priya Shah", handle: "priya", jersey: 7, color: "#5b9dff" },
  { id: "p4", name: "Tom Nguyen", handle: "tommy", jersey: 4, color: "#ffb020" },
  { id: "p5", name: "Aisha Khan", handle: "aisha", jersey: 11, color: "#c06bff" },
];

export interface StandingRow {
  player: Player;
  rank: number;
  elo: number;
  move: number;
  form: MatchResult[];
}

export const standings: StandingRow[] = [
  { player: players[2], rank: 1, elo: 1624, move: 1, form: ["W", "W", "D", "W", "L"] },
  { player: players[1], rank: 2, elo: 1601, move: -1, form: ["W", "L", "W", "W", "W"] },
  { player: players[0], rank: 3, elo: 1558, move: 2, form: ["L", "W", "L", "D", "W"] },
  { player: players[4], rank: 4, elo: 1517, move: 0, form: ["D", "L", "W", "L", "L"] },
  { player: players[3], rank: 5, elo: 1483, move: -1, form: ["L", "L", "D", "W", "L"] },
];

export const eloHistory: ChartPoint[] = [
  { date: "2026-04-01", rating: 1500 },
  { date: "2026-04-08", rating: 1488 },
  { date: "2026-04-15", rating: 1512 },
  { date: "2026-04-23", rating: 1505 },
  { date: "2026-05-02", rating: 1531 },
  { date: "2026-05-11", rating: 1524 },
  { date: "2026-05-20", rating: 1547 },
  { date: "2026-05-29", rating: 1558 },
];
