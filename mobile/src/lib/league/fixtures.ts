import { mutate } from "../dataCache";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../firebase";
import { assertWithinPendingLimit } from "./matches";
import type { Fixture, SubmitFixtureMatchInput } from "./types";

interface FixturePayload {
  id: string;
  seasonId: string;
  aId: string;
  bId: string;
  aTeamId: string;
  aTeamName: string;
  aTeamOverall: number;
  bTeamId: string;
  bTeamName: string;
  bTeamOverall: number;
  aElo: number;
  bElo: number;
  targetDiff: number;
  status: string;
  rerollCount: number;
  expiresAtMillis: number;
}

function mapFixture(payload: FixturePayload): Fixture {
  return {
    id: payload.id,
    seasonId: payload.seasonId,
    aId: payload.aId,
    bId: payload.bId,
    aTeamId: payload.aTeamId,
    aTeamName: payload.aTeamName,
    aTeamOverall: payload.aTeamOverall,
    bTeamId: payload.bTeamId,
    bTeamName: payload.bTeamName,
    bTeamOverall: payload.bTeamOverall,
    aElo: payload.aElo,
    bElo: payload.bElo,
    targetDiff: payload.targetDiff,
    status: payload.status === "submitted" ? "submitted" : "proposed",
    rerollCount: payload.rerollCount,
    expiresAt: payload.expiresAtMillis > 0 ? new Date(payload.expiresAtMillis) : null,
  };
}

/** Deal (or fetch the live) auto-matchup fixture against an opponent. Pass reroll to
 *  swap the dealt teams — the server allows one reroll per fixture. */
export async function createFixture(opponentId: string, reroll = false): Promise<Fixture> {
  const callable = httpsCallable<
    { opponentId: string; reroll?: boolean },
    { ok: boolean; fixture: FixturePayload }
  >(functions, "createFixture");
  const result = await mutate(() => callable({ opponentId, reroll }));
  return mapFixture(result.data.fixture);
}

/** Record the result of an auto-matchup. The match mirrors the fixture exactly (sides,
 *  teams, season) — security rules reject anything else — and the normal
 *  pending-confirmation lifecycle takes over from there. */
export async function submitFixtureMatch(input: SubmitFixtureMatchInput): Promise<string> {
  const { fixture } = input;
  await assertWithinPendingLimit(
    input.submittedBy,
    fixture.aId === input.submittedBy ? fixture.bId : fixture.aId,
  );
  const ref = await addDoc(collection(db, "matches"), {
    seasonId: fixture.seasonId,
    submittedBy: input.submittedBy,
    aId: fixture.aId,
    bId: fixture.bId,
    aTeamId: fixture.aTeamId,
    bTeamId: fixture.bTeamId,
    aTeam: fixture.aTeamName,
    bTeam: fixture.bTeamName,
    aGoals: input.aGoals,
    bGoals: input.bGoals,
    status: "pending_confirmation",
    source: "fixture",
    fixtureId: fixture.id,
    date: serverTimestamp(),
    createdAt: serverTimestamp(),
  });
  return ref.id;
}
