import { httpsCallable } from "firebase/functions";
import { functions } from "../firebase";

export async function ensureLeagueSetup(): Promise<void> {
  const callable = httpsCallable<Record<string, never>, { ok: boolean }>(
    functions,
    "ensureLeagueSetup",
  );
  await callable({});
}

export async function rebuildLeagueReadModels(): Promise<{
  seasonCount: number;
  matchCount: number;
}> {
  const callable = httpsCallable<
    Record<string, never>,
    { ok: boolean; seasonCount: number; matchCount: number }
  >(functions, "rebuildLeagueReadModels");
  const result = await callable({});
  return result.data;
}
