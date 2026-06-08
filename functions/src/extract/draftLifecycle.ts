import type { DraftState } from "./draftSecurity";
import { DraftSecurityError } from "./draftSecurity";

export type DraftAbandonAction =
  | { action: "missing" }
  | { action: "abandon"; storagePath: string };

export function evaluateDraftAbandonment(input: {
  draft: DraftState | null;
  matchExists: boolean;
  uid: string;
}): DraftAbandonAction {
  const { draft, matchExists, uid } = input;
  if (!draft) {
    if (matchExists) {
      throw new DraftSecurityError("failed-precondition", "Submitted drafts cannot be abandoned.");
    }
    return { action: "missing" };
  }
  if (draft.ownerUid !== uid) {
    throw new DraftSecurityError("permission-denied", "That AI draft belongs to another user.");
  }
  if (draft.submitted === true || matchExists) {
    throw new DraftSecurityError("failed-precondition", "Submitted drafts cannot be abandoned.");
  }
  if (typeof draft.storagePath !== "string" || !draft.storagePath) {
    throw new DraftSecurityError("failed-precondition", "That AI draft has no uploaded photo.");
  }
  return { action: "abandon", storagePath: draft.storagePath };
}

export function isStaleUnsubmittedDraft(input: {
  createdAtMillis: number;
  submitted: unknown;
  cutoffMillis: number;
}): boolean {
  return (
    input.submitted !== true &&
    Number.isFinite(input.createdAtMillis) &&
    input.createdAtMillis > 0 &&
    input.createdAtMillis <= input.cutoffMillis
  );
}
