import { onCall } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { requireAuth, assertAdmin } from "./auth";
import { TEAM_CATALOGUE } from "./data/teamCatalogue";

/**
 * A team doc is a legacy placeholder when it is neither part of the catalogue nor admin-created
 * (manageTeam mints ids prefixed "team-"). Those are the only docs the sync removes, so catalogue
 * teams and admin-added teams are always preserved.
 */
export function isLegacyPlaceholderTeam(id: string, catalogueIds: Set<string>): boolean {
  return !catalogueIds.has(id) && !id.startsWith("team-");
}

/**
 * Make the `teams/` collection match the catalogue: upsert every catalogue team (id, name, group,
 * active) and remove legacy placeholder teams. Idempotent — safe to re-run. Returns the counts.
 */
export async function seedTeamCatalogue(): Promise<{ seeded: number; removed: number }> {
  const db = getFirestore();
  const catalogueIds = new Set(TEAM_CATALOGUE.map((team) => team.id));
  const existing = await db.collection("teams").get();

  const writer = db.bulkWriter();
  for (const team of TEAM_CATALOGUE) {
    writer.set(
      db.doc(`teams/${team.id}`),
      {
        name: team.name,
        group: team.group,
        active: true,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  }

  let removed = 0;
  for (const doc of existing.docs) {
    if (isLegacyPlaceholderTeam(doc.id, catalogueIds)) {
      writer.delete(doc.ref);
      removed += 1;
    }
  }

  await writer.close();
  return { seeded: TEAM_CATALOGUE.length, removed };
}

/** Admin-only: sync the team catalogue into Firestore (upsert all, prune legacy placeholders). */
export const seedTeams = onCall({ cors: true }, async (req) => {
  const { uid } = requireAuth(req);
  await assertAdmin(uid);
  const result = await seedTeamCatalogue();
  return { ok: true, ...result };
});
