import { mutate } from "../dataCache";
import { httpsCallable } from "firebase/functions";
import { functions } from "../firebase";

export async function ensureLeagueSetup(): Promise<void> {
  const callable = httpsCallable<Record<string, never>, { ok: boolean }>(
    functions,
    "ensureLeagueSetup",
  );
  await mutate(() => callable({}));
}

export async function rebuildLeagueReadModels(): Promise<{
  queued?: boolean;
  seasonCount: number;
  matchCount: number;
}> {
  const callable = httpsCallable<
    Record<string, never>,
    { ok: boolean; queued?: boolean; seasonCount: number; matchCount: number }
  >(functions, "rebuildLeagueReadModels", { timeout: 550000 });
  const result = await mutate(() => callable({}));
  return result.data;
}
