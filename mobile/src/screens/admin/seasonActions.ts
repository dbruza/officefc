/**
 * Season lifecycle actions for the admin screen (activate, start finals, finalize), shared
 * by the overview's phase card and the Seasons list so both get the same guard rails:
 *
 * - every action is confirmed, and irreversible ones say so;
 * - one action at a time (a ref guard, so a double click can't fire two calls);
 * - finalizing the ACTIVE season offers to activate the next one in the same step,
 *   because an empty active slot makes the backend's ensureLeagueData recreate a
 *   placeholder "Summer Showdown" season that new matches then land in. Finalize runs
 *   first so the next season's activation stamps the right reigning Premier.
 */
import { useRef, useState } from "react";
import { useRouter } from "expo-router";
import { activateSeason, finalizeSeason, listSeasons, startFinals } from "@/lib/league";
import { chooseAction, confirmAction, showAlert } from "@/lib/dialogs";
import { toast } from "@/lib/toast";
import { callableErrorMessage } from "@/lib/authErrors";

export interface AdminSeason {
  id: string;
  name: string;
  active: boolean;
  finalized: boolean;
  phase: "regular" | "finals" | "finalized";
  start: Date | null;
  end: Date | null;
}

/** Callable results carry Firestore Timestamps as `{ _seconds, _nanoseconds }`. */
function toDate(value: unknown): Date | null {
  if (value == null) return null;
  if (typeof value === "string" || typeof value === "number") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof value === "object") {
    const v = value as { _seconds?: unknown; seconds?: unknown };
    const seconds = typeof v._seconds === "number" ? v._seconds : v.seconds;
    if (typeof seconds === "number") return new Date(seconds * 1000);
  }
  return null;
}

/** listSeasons returns the raw season docs; normalise the fields the admin UI needs. */
export async function loadAdminSeasons(): Promise<AdminSeason[]> {
  const raw = (await listSeasons()) as unknown as Record<string, unknown>[];
  return raw.map((s) => {
    const finalized = s.finalized === true || s.phase === "finalized";
    return {
      id: String(s.id),
      name: String(s.name ?? s.id),
      active: s.active === true,
      finalized,
      phase: finalized ? "finalized" : s.phase === "finals" ? "finals" : "regular",
      start: toDate(s.start),
      end: toDate(s.end),
    };
  });
}

/** Inactive, unfinalized seasons that could be activated next — soonest start first. */
export function readySeasons(seasons: AdminSeason[], excludeId?: string): AdminSeason[] {
  return seasons
    .filter((s) => !s.active && !s.finalized && s.id !== excludeId)
    .sort((a, b) => (a.start?.getTime() ?? Infinity) - (b.start?.getTime() ?? Infinity));
}

export function formatDay(date: Date | null): string {
  return date
    ? date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
    : "—";
}

/** The server refuses to finalize before the end date unless forced. */
function isEarlyFinishError(error: unknown): boolean {
  const message =
    typeof error === "object" && error !== null && "message" in error
      ? String((error as { message: unknown }).message)
      : "";
  return /still active until/i.test(message);
}

export type SeasonAction = "activate" | "finals" | "finalize";

export interface SeasonActions {
  /** The action in flight, if any (drives button spinners; all buttons disable). */
  busy: { id: string; action: SeasonAction } | null;
  activate: (season: AdminSeason) => void;
  startFinals: (season: AdminSeason) => void;
  finalize: (season: AdminSeason) => void;
}

export function useSeasonActions({
  seasons,
  reload,
  onCreateNext,
}: {
  seasons: AdminSeason[];
  reload: () => Promise<unknown>;
  /** Open the "new season" form (offered when finalizing with nothing lined up). */
  onCreateNext: () => void;
}): SeasonActions {
  const router = useRouter();
  const [busy, setBusy] = useState<SeasonActions["busy"]>(null);
  const running = useRef(false);

  /** Run one action exclusively; errors get an action-specific title. */
  async function run(
    id: string,
    action: SeasonAction,
    failTitle: string,
    task: () => Promise<void>,
  ): Promise<void> {
    if (running.current) return;
    running.current = true;
    setBusy({ id, action });
    try {
      await task();
    } catch (error) {
      showAlert(failTitle, callableErrorMessage(error));
    } finally {
      running.current = false;
      setBusy(null);
      void reload();
    }
  }

  function activate(season: AdminSeason) {
    const current = seasons.find((s) => s.active && s.id !== season.id);
    const doActivate = () =>
      run(season.id, "activate", `Couldn't activate ${season.name}`, async () => {
        await activateSeason(season.id);
        toast.success(`${season.name} is now the active season`);
      });

    if (!current) {
      confirmAction({
        title: `Activate ${season.name}?`,
        message: `New matches will be logged to ${season.name}, and its join code starts working.`,
        confirmLabel: "Activate",
        onConfirm: () => void doActivate(),
      });
      return;
    }
    // Switching seasons the safe way is "finalize the old one, then activate" — offer
    // that as the main path rather than silently stranding the running season.
    const currentEndsLater = !!current.end && current.end.getTime() > Date.now();
    const early = currentEndsLater
      ? ` ${current.name} is scheduled to run until ${formatDay(current.end)}, so finalizing now ends it early.`
      : "";
    chooseAction({
      title: `Switch to ${season.name}?`,
      message: `${current.name} is still running. Usually you finalize ${current.name} (crowning its champion, which can't be undone) and activate ${season.name} in one step, which also carries the reigning Premier over.${early} Activating alone leaves ${current.name} unfinalized.`,
      options: [
        { label: "Cancel", style: "cancel" },
        { label: "Activate only", style: "destructive", onPress: () => void doActivate() },
        {
          label: `Finalize ${current.name} & switch`,
          style: "primary",
          onPress: () => finalizeFlow(current, season),
        },
      ],
    });
  }

  function startFinalsFor(season: AdminSeason) {
    confirmAction({
      title: `Start finals for ${season.name}?`,
      message:
        "Seeds lock from the current table and the finals bracket opens. This can't be undone.",
      confirmLabel: "Start finals",
      destructive: true,
      onConfirm: () =>
        void run(season.id, "finals", "Couldn't start finals", async () => {
          await startFinals(season.id);
          toast.success("Finals are live", {
            action: { label: "Bracket", onPress: () => router.push("/(app)/finals") },
          });
        }),
    });
  }

  /** Finalize `season`, optionally activating `next` straight after. */
  function finalizeFlow(season: AdminSeason, next: AdminSeason | null, forceEarly = false) {
    const endsLater = !!season.end && season.end.getTime() > Date.now();
    const force = forceEarly || endsLater;
    void run(season.id, "finalize", `Couldn't finalize ${season.name}`, async () => {
      try {
        await finalizeSeason(season.id, force);
      } catch (error) {
        if (!force && isEarlyFinishError(error)) {
          // The end date wasn't readable client-side; ask before forcing.
          confirmAction({
            title: `End ${season.name} early?`,
            message: "It's scheduled to run longer. Finalizing now closes it for good.",
            confirmLabel: "Finalize now",
            destructive: true,
            onConfirm: () => finalizeFlow(season, next, true),
          });
          return;
        }
        throw error;
      }
      const recap = {
        label: "Recap",
        onPress: () =>
          router.push({ pathname: "/(app)/recap/[seasonId]", params: { seasonId: season.id } }),
      };
      if (!next) {
        toast.success(`${season.name} finalized`, { action: recap });
        return;
      }
      try {
        await activateSeason(next.id);
        toast.success(`${season.name} finalized · ${next.name} is live`, { action: recap });
      } catch (error) {
        showAlert(
          `${season.name} finalized, but ${next.name} didn't activate`,
          `${callableErrorMessage(error)} Activate ${next.name} from the Seasons list now, before anyone logs a match.`,
        );
      }
    });
  }

  function finalize(season: AdminSeason) {
    const endsLater = !!season.end && season.end.getTime() > Date.now();
    const early = endsLater
      ? ` It's scheduled to run until ${formatDay(season.end)}; finalizing now ends it early.`
      : "";
    const base = `This crowns the champion, publishes the recap and closes ${season.name} for good.${early}`;

    // Finalizing a season that isn't the active one can't empty the active slot.
    if (!season.active) {
      confirmAction({
        title: `Finalize ${season.name}?`,
        message: `${base} This can't be undone.`,
        confirmLabel: "Finalize",
        destructive: true,
        onConfirm: () => finalizeFlow(season, null),
      });
      return;
    }

    const next = readySeasons(seasons, season.id)[0] ?? null;
    if (!next) {
      chooseAction({
        title: "No season lined up",
        message: `Finalizing ${season.name} leaves the league with no active season, and the app then auto-creates a placeholder "Summer Showdown" season that new matches land in. Create the next season first; you can then finalize and switch in one step.`,
        options: [
          { label: "Cancel", style: "cancel" },
          {
            label: "Finalize anyway",
            style: "destructive",
            onPress: () => finalizeFlow(season, null),
          },
          { label: "Create next season", style: "primary", onPress: onCreateNext },
        ],
      });
      return;
    }

    chooseAction({
      title: `Finalize ${season.name}?`,
      message: `${base} ${next.name} becomes the active season straight away, so new matches have somewhere to go. This can't be undone.`,
      // No "finalize only" here: it would empty the active slot, the exact footgun
      // this flow exists to avoid. Without a next season the dialog above still allows it.
      options: [
        { label: "Cancel", style: "cancel" },
        {
          label: `Finalize & activate ${next.name}`,
          style: "primary",
          onPress: () => finalizeFlow(season, next),
        },
      ],
    });
  }

  return { busy, activate, startFinals: startFinalsFor, finalize };
}
