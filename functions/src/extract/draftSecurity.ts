export type DraftSecurityCode =
  | "already-exists"
  | "failed-precondition"
  | "not-found"
  | "permission-denied";

export class DraftSecurityError extends Error {
  constructor(
    public readonly code: DraftSecurityCode,
    message: string,
  ) {
    super(message);
    this.name = "DraftSecurityError";
  }
}

export interface DraftState {
  ownerUid?: unknown;
  storagePath?: unknown;
  status?: unknown;
  submitted?: unknown;
  submittedMatchId?: unknown;
}

export interface MatchState {
  source?: unknown;
  submittedBy?: unknown;
}

export type DraftClaimAction = "claim" | "reuse";
export type DraftSubmissionAction = "create" | "existing";

export function assertValidDraftId(draftId: string): void {
  if (
    draftId.length === 0 ||
    draftId.length > 1500 ||
    draftId.includes("/") ||
    draftId === "." ||
    draftId === ".."
  ) {
    throw new DraftSecurityError("failed-precondition", "Invalid AI draft id.");
  }
}

export function evaluateDraftClaim(input: {
  draft: DraftState | null;
  matchExists: boolean;
  uid: string;
  storagePath: string;
  force: boolean;
}): DraftClaimAction {
  const { draft, matchExists, uid, storagePath, force } = input;
  if (matchExists) {
    throw new DraftSecurityError(
      "already-exists",
      "That draft id is already used by a match.",
    );
  }
  if (!draft) return "claim";
  if (draft.ownerUid !== uid) {
    throw new DraftSecurityError("permission-denied", "That AI draft belongs to another user.");
  }
  if (draft.storagePath !== storagePath) {
    throw new DraftSecurityError(
      "failed-precondition",
      "The uploaded photo does not match the existing AI draft.",
    );
  }
  if (draft.submitted === true) {
    throw new DraftSecurityError("failed-precondition", "That AI draft was already submitted.");
  }
  if (draft.status === "abandoning") {
    throw new DraftSecurityError("failed-precondition", "That AI draft is being abandoned.");
  }
  if (draft.status === "processing") {
    throw new DraftSecurityError(
      "failed-precondition",
      "That AI draft is already being processed.",
    );
  }
  if (draft.status === "done" && !force) return "reuse";
  return "claim";
}

export function evaluateDraftSubmission(input: {
  draft: DraftState | null;
  match: MatchState | null;
  draftId: string;
  uid: string;
}): DraftSubmissionAction {
  const { draft, match, draftId, uid } = input;
  if (!draft) throw new DraftSecurityError("not-found", "AI draft not found.");
  if (draft.ownerUid !== uid) {
    throw new DraftSecurityError("permission-denied", "That AI draft belongs to another user.");
  }

  if (draft.submitted === true) {
    if (
      draft.submittedMatchId === draftId &&
      match?.source === "ai_assisted" &&
      match.submittedBy === uid
    ) {
      return "existing";
    }
    throw new DraftSecurityError("failed-precondition", "That AI draft was already submitted.");
  }

  if (draft.status !== "done") {
    throw new DraftSecurityError("failed-precondition", "AI extraction is not complete.");
  }
  if (match) {
    throw new DraftSecurityError(
      "already-exists",
      "That draft id is already used by a match.",
    );
  }
  return "create";
}
