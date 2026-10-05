import { SnapFlow } from "@/components/SnapFlow";
/**
 * Log a match — the core loop. Three ways in (photo, auto-matchup, manual) plus the
 * finals tie when one is open. The last-used way is remembered, so regulars land
 * straight in their flow; a segmented switch on the first step changes it in one tap.
 *
 * Manual/auto run a three-step wizard (opponent → teams → score & submit). Phones keep
 * the stepped layout; desktop adds a sticky live match card (players, teams, score, both
 * ratings before → after) and keyboard control (Enter = next, Esc = back). A
 * `?opponent=<uid>` link (Home "Play next", profile "Log match vs") preselects the
 * opponent and skips to teams.
 *
 * Errors are split: a failed league load blocks the screen (ErrorCard + Retry); a failed
 * action (deal, submit) shows inline, never disables the flow, and clears on the next edit.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Platform, ScrollView, StyleSheet, TextInput, View } from "react-native";
import Animated from "react-native-reanimated";
import { type Href, useLocalSearchParams, useRouter } from "expo-router";
import {
  Avatar,
  Button,
  Card,
  Columns,
  EASE_OUT,
  EmptyState,
  ErrorCard,
  Grid,
  Icon,
  IconButton,
  Interactive,
  Page,
  Reveal,
  Segmented,
  Skeleton,
  SkeletonRows,
  Tag,
  TeamPicker,
  Txt,
  useSafeBack,
  type IconName,
  type SegmentOption,
} from "@/components";
import { EloLine, MatchSubmitted } from "@/components/MatchSubmitted";
import { OpponentPicker } from "@/components/OpponentPicker";
import { ScoreStepper } from "@/components/ScoreStepper";
import { StickySplit } from "@/components/StickySplit";
import { useAuth } from "@/lib/auth";
import { AI_FEATURES } from "@/lib/constants";
import {
  createFixture,
  getActiveSeason,
  getBracket,
  getLeaguePlayers,
  getProfileSummary,
  getStandings,
  getTeams,
  canPlayAgainst,
  previewElo,
  submitFinalsMatch,
  submitFixtureMatch,
  submitManualMatch,
  type FinalsBracket,
  type FinalsDecidedBy,
  type FinalsSlot,
  type Fixture,
  type LeaguePlayer,
  type Season,
  type Standing,
  type Team,
} from "@/lib/league";
import { friendlyError } from "@/lib/friendlyError";
import { EMPTY_HISTORY, type MatchHistorySummary } from "@/lib/matchHistory";
import { useBreakpoint } from "@/lib/responsive";
import { useDocumentTitle } from "@/lib/web";
import { firstName } from "@/lib/format";
import { colors, radius, spacing } from "@/theme";
import { withAlpha } from "@/lib/color";
import type { Player } from "@/types";

type FlowMode = "manual" | "auto" | "snap";
type Mode = "choose" | FlowMode | "finals";

const LAST_MODE_KEY = "officefc:log-match:last-mode";
const STEP_NAMES = ["Opponent", "Teams", "Score"];
const AUTO_STEP_NAMES = ["Opponent", "Matchup", "Score"];
const FINALS_STEP_NAMES = ["Tie", "Teams", "Score"];
const LAST_STEP = 2;

// Photo logging needs the AI functions, which a deployment may not run (AI_FEATURES).
const MODE_OPTIONS: SegmentOption<FlowMode>[] = [
  ...(AI_FEATURES ? [{ value: "snap" as const, label: "Photo", icon: "camera" as const }] : []),
  { value: "auto", label: "Auto", icon: "swords" },
  { value: "manual", label: "Manual", icon: "edit" },
];

const DECIDED_BY_OPTIONS: SegmentOption<Exclude<FinalsDecidedBy, "walkover">>[] = [
  { value: "regulation", label: "Full time" },
  { value: "extra_time", label: "Extra time" },
  { value: "penalties", label: "Penalties" },
];

interface LeagueData {
  season: Season | null;
  players: LeaguePlayer[];
  teams: Team[];
  standings: Standing[];
  bracket: FinalsBracket | null;
  history: MatchHistorySummary;
  lastMode: FlowMode | null;
}

interface SubmittedResult {
  matchId: string;
  myGoals: number;
  opponentGoals: number;
  myDelta: number;
  opponentDelta: number;
}

async function readLastMode(): Promise<FlowMode | null> {
  try {
    const stored = await AsyncStorage.getItem(LAST_MODE_KEY);
    if (stored === "snap") return AI_FEATURES ? stored : null;
    return stored === "manual" || stored === "auto" ? stored : null;
  } catch {
    return null;
  }
}

function rememberMode(mode: FlowMode) {
  // Best effort: private windows / blocked storage just fall back to the chooser.
  AsyncStorage.setItem(LAST_MODE_KEY, mode).catch(() => undefined);
}

async function loadLeague(uid: string): Promise<LeagueData> {
  const [season, roster, teams, played, lastMode] = await Promise.all([
    getActiveSeason(),
    getLeaguePlayers(),
    getTeams(),
    // Only sorts the opponent list / defaults teams — never block logging on it.
    getProfileSummary(uid).catch(() => null),
    readLastMode(),
  ]);
  const [standings, bracket] = season
    ? await Promise.all([
        getStandings(season.id),
        season.phase === "finals" ? getBracket(season.id) : Promise.resolve(null),
      ])
    : [[], null];
  return {
    season,
    players: roster.filter((player) => player.id !== uid && canPlayAgainst(player)),
    teams,
    standings,
    bracket,
    history: played
      ? {
          myTeamIds: played.history.myTeamIds,
          opponents: new Map(Object.entries(played.history.opponents)),
        }
      : EMPTY_HISTORY,
    lastMode,
  };
}

export default function LogMatch() {
  const router = useRouter();
  const safeBack = useSafeBack();
  const params = useLocalSearchParams<{ opponent?: string }>();
  const { user, profile } = useAuth();
  const { isTablet, isDesktop, isWeb } = useBreakpoint();
  useDocumentTitle("Log a match");

  const [data, setData] = useState<LeagueData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [mode, setMode] = useState<Mode>("choose");
  const [step, setStep] = useState(0);
  const [direction, setDirection] = useState<"forward" | "back">("forward");
  const [opponent, setOpponent] = useState<LeaguePlayer | null>(null);
  const [myTeam, setMyTeam] = useState<Team | null>(null);
  const [opponentTeam, setOpponentTeam] = useState<Team | null>(null);
  const [myGoals, setMyGoals] = useState(0);
  const [opponentGoals, setOpponentGoals] = useState(0);
  const [scoreTouched, setScoreTouched] = useState(false);
  const [fixture, setFixture] = useState<Fixture | null>(null);
  const [dealing, setDealing] = useState(false);
  const [dealError, setDealError] = useState<string | null>(null);
  const [decidedBy, setDecidedBy] = useState<Exclude<FinalsDecidedBy, "walkover">>("regulation");
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<SubmittedResult | null>(null);

  const scrollRef = useRef<ScrollView>(null);
  const opponentScoreRef = useRef<TextInput>(null);
  const advanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialised = useRef(false);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setLoadError(null);
    try {
      setData(await loadLeague(user.uid));
    } catch (err) {
      setLoadError(
        friendlyError(err, "Couldn't load the league. Check your connection and try again."),
      );
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void load();
    return () => {
      if (advanceTimer.current) clearTimeout(advanceTimer.current);
    };
  }, [load]);

  const season = data?.season ?? null;
  const players = useMemo(() => data?.players ?? [], [data]);
  const teams = useMemo(() => data?.teams ?? [], [data]);
  const history = data?.history ?? EMPTY_HISTORY;
  const standings = useMemo(() => data?.standings ?? [], [data]);
  const bracket = data?.bracket ?? null;

  const me: Player | null = profile
    ? {
        id: user?.uid ?? "me",
        name: profile.displayName,
        handle: profile.handle,
        jersey: profile.jersey,
        color: profile.color,
        isYou: true,
      }
    : null;

  const ratingByUid = useMemo(
    () => new Map(standings.map((standing) => [standing.uid, standing.elo])),
    [standings],
  );
  const gamesByUid = useMemo(
    () =>
      new Map(standings.map((standing) => [standing.uid, standing.w + standing.d + standing.l])),
    [standings],
  );
  const myElo = ratingByUid.get(user?.uid ?? "") ?? 1500;
  const opponentElo = ratingByUid.get(opponent?.id ?? "") ?? 1500;
  const premierId = season?.reigningPremierId ?? null;
  // Finals decide the bracket and are excluded from the rating walk entirely, so the server
  // commits a delta of exactly 0 — the preview must not imply otherwise.
  const ratesElo = mode !== "finals";
  const myDelta =
    opponent && ratesElo
      ? previewElo(
          myElo,
          opponentElo,
          myGoals,
          opponentGoals,
          myTeam?.overall,
          opponentTeam?.overall,
          gamesByUid.get(user?.uid ?? "") ?? 0,
          premierId,
          user?.uid ?? null,
          opponent.id,
        )
      : 0;
  const opponentDelta =
    opponent && ratesElo
      ? previewElo(
          opponentElo,
          myElo,
          opponentGoals,
          myGoals,
          opponentTeam?.overall,
          myTeam?.overall,
          gamesByUid.get(opponent.id) ?? 0,
          premierId,
          opponent.id,
          user?.uid ?? null,
        )
      : 0;

  // The caller's open finals tie, if any — surfaces the finals card and locks the flow.
  const myOpenSlot = useMemo(() => {
    if (!bracket || !user) return null;
    const keys = ["e1", "e2", "s1", "s2", "gf"] as const;
    for (const key of keys) {
      const slot = bracket.slots[key];
      if (slot?.status === "open" && (slot.homeId === user.uid || slot.awayId === user.uid)) {
        return slot;
      }
    }
    return null;
  }, [bracket, user]);

  const teamById = useMemo(() => new Map(teams.map((team) => [team.id, team])), [teams]);
  // "Your team" defaults to the one you used last — most people stick with a club.
  const defaultMyTeam = history.myTeamIds.map((id) => teamById.get(id)).find(Boolean) ?? null;
  const opponentHistory = opponent ? history.opponents.get(opponent.id) : undefined;

  const teamsReady =
    !!myTeam && !!opponentTeam && (mode !== "auto" || (!!fixture && !dealing && !dealError));
  const scoreValid = mode !== "finals" || myGoals !== opponentGoals;
  const canContinue = step === 0 ? !!opponent : step === 1 ? teamsReady : scoreValid;

  /** Resolve a dealt fixture side to a Team for the preview/review UI. Falls back to a
   *  minimal Team built from the fixture snapshot if the catalogue read is missing it. */
  function fixtureTeam(dealt: Fixture, wantSideA: boolean): Team {
    const id = wantSideA ? dealt.aTeamId : dealt.bTeamId;
    const known = teamById.get(id);
    if (known) return known;
    return {
      id,
      name: wantSideA ? dealt.aTeamName : dealt.bTeamName,
      competition: "",
      category: "men",
      overall: wantSideA ? dealt.aTeamOverall : dealt.bTeamOverall,
      attack: null,
      midfield: null,
      defence: null,
      catalogueVersion: null,
      source: "catalogue",
      catalogueActive: true,
      active: true,
    };
  }

  /** Resolve a bracket-slot side to a Team for the UI, mirroring fixtureTeam. */
  function slotTeam(slot: FinalsSlot, wantHome: boolean): Team | null {
    const id = wantHome ? slot.homeTeamId : slot.awayTeamId;
    if (!id) return null;
    const known = teamById.get(id);
    if (known) return known;
    return {
      id,
      name: (wantHome ? slot.homeTeamName : slot.awayTeamName) ?? id,
      competition: "",
      category: "men",
      overall: wantHome ? slot.homeTeamOverall : slot.awayTeamOverall,
      attack: null,
      midfield: null,
      defence: null,
      catalogueVersion: null,
      source: "catalogue",
      catalogueActive: true,
      active: true,
    };
  }

  async function dealFixture(against: LeaguePlayer, reroll = false) {
    if (!user) return;
    setDealing(true);
    setDealError(null);
    try {
      const dealt = await createFixture(against.id, reroll);
      const mineIsA = dealt.aId === user.uid;
      setFixture(dealt);
      setMyTeam(fixtureTeam(dealt, mineIsA));
      setOpponentTeam(fixtureTeam(dealt, !mineIsA));
    } catch (err) {
      setDealError(friendlyError(err, "Couldn't deal a matchup. Try again."));
    } finally {
      setDealing(false);
    }
  }

  const fixtureIsFor = (player: LeaguePlayer) =>
    !!fixture && (fixture.aId === player.id || fixture.bId === player.id);

  function goTo(target: number, against: LeaguePlayer | null = opponent) {
    setDirection(target >= step ? "forward" : "back");
    setStep(target);
    setActionError(null);
    if (mode === "auto" && target === 1 && against && !fixtureIsFor(against) && !dealing) {
      void dealFixture(against);
    }
  }

  /** Switch flow. `jumpToTeams` is for a preselected opponent (deep link / snap fallback). */
  function enterMode(next: FlowMode, preset: LeaguePlayer | null, jumpToTeams: boolean) {
    rememberMode(next);
    setActionError(null);
    setDealError(null);
    setFixture(null);
    setMyGoals(0);
    setOpponentGoals(0);
    setScoreTouched(false);
    setOpponentTeam(null);
    setMyTeam(next === "manual" ? defaultMyTeam : null);
    setDirection("forward");
    setMode(next);
    if (next === "snap") return;
    if (preset && jumpToTeams) {
      setStep(1);
      if (next === "auto") void dealFixture(preset);
    } else {
      setStep(0);
    }
  }

  function enterFinals() {
    if (!myOpenSlot || !user) return;
    const iAmHome = myOpenSlot.homeId === user.uid;
    const oppId = iAmHome ? myOpenSlot.awayId : myOpenSlot.homeId;
    setOpponent(players.find((player) => player.id === oppId) ?? null);
    setMyTeam(slotTeam(myOpenSlot, iAmHome));
    setOpponentTeam(slotTeam(myOpenSlot, !iAmHome));
    setMyGoals(0);
    setOpponentGoals(0);
    setScoreTouched(false);
    setDecidedBy("regulation");
    setActionError(null);
    setDirection("forward");
    setStep(LAST_STEP);
    setMode("finals");
  }

  // First load: apply the deep-linked opponent and drop regulars straight into their flow.
  // An open finals tie keeps the chooser up so the bracket match isn't missed.
  useEffect(() => {
    if (!data || initialised.current) return;
    initialised.current = true;
    const preset = params.opponent
      ? (data.players.find((player) => player.id === params.opponent) ?? null)
      : null;
    if (preset) setOpponent(preset);
    if (!myOpenSlot && data.lastMode) enterMode(data.lastMode, preset, true);
    // Runs once per load; everything it reads is derived from `data` in this render.
  }, [data]);

  // Every step starts at the top (the shared scroll view would keep the old offset).
  useEffect(() => {
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  }, [step, mode]);

  function pickOpponent(player: LeaguePlayer) {
    setActionError(null);
    if (player.id !== opponent?.id) {
      setOpponent(player);
      // Teams belong to the pairing: a new opponent means a new deal / their own team.
      setOpponentTeam(null);
      if (mode === "auto") {
        setFixture(null);
        setMyTeam(null);
      }
    }
    // Let the check pop before moving on so the tap visibly lands.
    if (advanceTimer.current) clearTimeout(advanceTimer.current);
    advanceTimer.current = setTimeout(() => goTo(1, player), 180);
  }

  function goBack() {
    if (advanceTimer.current) clearTimeout(advanceTimer.current);
    setActionError(null);
    // Finals enter directly at the score step; back returns to the chooser.
    if (mode === "finals") {
      setMode("choose");
      return;
    }
    if (step === 0) {
      safeBack();
      return;
    }
    goTo(step - 1);
  }

  function editScore(side: "mine" | "theirs", value: number) {
    setActionError(null);
    setScoreTouched(true);
    if (side === "mine") setMyGoals(value);
    else setOpponentGoals(value);
  }

  async function submit() {
    if (!user || !season || !opponent || !myTeam || !opponentTeam) return;
    setSubmitting(true);
    setActionError(null);
    try {
      let matchId: string;
      if (mode === "finals") {
        if (!myOpenSlot) return;
        const iAmHome = myOpenSlot.homeId === user.uid;
        matchId = await submitFinalsMatch({
          seasonId: season.id,
          submittedBy: user.uid,
          slot: myOpenSlot,
          homeGoals: iAmHome ? myGoals : opponentGoals,
          awayGoals: iAmHome ? opponentGoals : myGoals,
          decidedBy,
        });
      } else if (mode === "auto") {
        if (!fixture) return;
        const mineIsA = fixture.aId === user.uid;
        matchId = await submitFixtureMatch({
          fixture,
          submittedBy: user.uid,
          aGoals: mineIsA ? myGoals : opponentGoals,
          bGoals: mineIsA ? opponentGoals : myGoals,
        });
      } else {
        matchId = await submitManualMatch({
          seasonId: season.id,
          submittedBy: user.uid,
          opponentId: opponent.id,
          myTeam,
          opponentTeam,
          myGoals,
          opponentGoals,
        });
      }
      setSubmitted({ matchId, myGoals, opponentGoals, myDelta, opponentDelta });
    } catch (err) {
      setActionError(
        friendlyError(err, "The match couldn't be submitted. Check your connection and try again."),
      );
    } finally {
      setSubmitting(false);
    }
  }

  function next() {
    if (!canContinue || submitting) return;
    if (step === 0 && opponent) goTo(1, opponent);
    else if (step === 1) goTo(2);
    else void submit();
  }

  function rematch() {
    setSubmitted(null);
    setMyGoals(0);
    setOpponentGoals(0);
    setScoreTouched(false);
    setActionError(null);
    setDirection("forward");
    if (mode === "auto") {
      // A fixture is single-use: the rematch gets a freshly dealt pair of teams.
      setFixture(null);
      setMyTeam(null);
      setOpponentTeam(null);
      setStep(1);
      if (opponent) void dealFixture(opponent);
    } else {
      setStep(LAST_STEP);
    }
  }

  // Web keyboard: Enter = next (when valid), Esc = back. Inputs handle their own Enter
  // (RN-web stops their key events), focused buttons keep native activation, and nothing
  // fires while a dialog or the team picker is open.
  const keys = useRef({ next, goBack });
  keys.current = { next, goBack };
  const wizardActive =
    !loading && !!data && !submitted && (mode === "manual" || mode === "auto" || mode === "finals");
  useEffect(() => {
    if (Platform.OS !== "web" || !wizardActive) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      const target = event.target as HTMLElement | null;
      const interactive = target?.closest?.(
        'input,textarea,select,button,a,[role="button"],[role="link"],[role="radio"],[role="tab"]',
      );
      const action =
        event.key === "Escape"
          ? keys.current.goBack
          : event.key === "Enter" && !interactive
            ? keys.current.next
            : null;
      if (!action) return;
      // Decide after every other window listener has run: the web dialog host and the
      // command palette claim Enter/Escape with preventDefault, and they register later.
      setTimeout(() => {
        if (!event.defaultPrevented) action();
      }, 0);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [wizardActive]);

  // The header button leaves the screen from the chooser / first step, else steps back.
  const closes = mode === "choose" || (step === 0 && mode !== "finals");
  const header = (
    <View style={[styles.header, isDesktop && styles.headerDesktop]}>
      <IconButton
        icon={closes ? "x" : "back"}
        accessibilityLabel={closes ? "Close" : "Back"}
        onPress={mode === "choose" ? safeBack : goBack}
        iconSize={20}
      />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt
          variant="head"
          size={isDesktop ? 26 : 21}
          accessibilityRole="header"
          numberOfLines={1}
          style={isDesktop ? { letterSpacing: -0.3 } : undefined}
        >
          Log a match
        </Txt>
        {mode === "manual" || mode === "auto" || mode === "finals" ? (
          <Txt size={12} color={colors.textDim} style={{ marginTop: 2 }}>
            Step {step + 1} of 3 ·{" "}
            {
              (mode === "auto"
                ? AUTO_STEP_NAMES
                : mode === "finals"
                  ? FINALS_STEP_NAMES
                  : STEP_NAMES)[step]
            }
          </Txt>
        ) : null}
      </View>
    </View>
  );

  if (loading || (!data && !loadError)) {
    return (
      <Page header={header} width="default">
        <View style={{ gap: spacing.lg, maxWidth: 640 }}>
          <Skeleton width={220} height={24} />
          <SkeletonRows count={5} height={68} />
        </View>
      </Page>
    );
  }

  if (loadError || !data) {
    return (
      <Page header={header} width="narrow">
        <ErrorCard
          message={loadError ?? "Couldn't load the league."}
          onRetry={() => void load()}
          retrying={loading}
        />
      </Page>
    );
  }

  if (!season || teams.length === 0) {
    return (
      <Page header={header} width="narrow">
        <EmptyState
          icon={!season ? "calendar" : "shield"}
          title={!season ? "No active season" : "No teams available yet"}
          body={
            !season
              ? "Ask an admin to start a season, then come back to log your result."
              : "An admin needs to sync the team catalogue before results can be logged."
          }
          action={{ label: "Back", onPress: safeBack, icon: "back" }}
        />
      </Page>
    );
  }

  const modeSwitch = (
    <Segmented
      options={MODE_OPTIONS}
      value={mode === "snap" || mode === "auto" ? mode : "manual"}
      onChange={(next) => {
        if (next !== mode) enterMode(next, opponent, false);
      }}
      size="sm"
      full={!isTablet}
    />
  );

  if (mode === "snap" && user && profile) {
    return (
      <SnapFlow
        uid={user.uid}
        profile={profile}
        season={season}
        players={players}
        teams={teams}
        standings={standings}
        opponentHistory={history.opponents}
        myRecentTeamIds={history.myTeamIds}
        initialOpponentId={opponent?.id ?? null}
        modeSwitch={modeSwitch}
        onCancel={safeBack}
        onManualFallback={(opponentId) => {
          const preset = players.find((player) => player.id === opponentId) ?? opponent;
          if (preset) setOpponent(preset);
          enterMode("manual", preset ?? null, !!preset);
        }}
        onViewMatch={(matchId) =>
          router.replace({ pathname: "/(app)/match/[id]", params: { id: matchId } } as Href)
        }
        onDone={safeBack}
      />
    );
  }

  if (submitted && opponent) {
    return (
      <MatchSubmitted
        me={me}
        opponent={opponent}
        myGoals={submitted.myGoals}
        opponentGoals={submitted.opponentGoals}
        myTeam={myTeam?.name}
        opponentTeam={opponentTeam?.name}
        myElo={myElo}
        myDelta={submitted.myDelta}
        opponentElo={opponentElo}
        opponentDelta={submitted.opponentDelta}
        finalsLabel={mode === "finals" ? (myOpenSlot?.label ?? "Finals tie") : null}
        onRematch={mode === "finals" ? undefined : rematch}
        onView={() =>
          router.replace({
            pathname: "/(app)/match/[id]",
            params: { id: submitted.matchId },
          } as Href)
        }
        onDone={safeBack}
      />
    );
  }

  if (mode === "choose") {
    const cards: Array<{
      key: string;
      icon: IconName;
      tint: string;
      title: string;
      body: string;
      onPress: () => void;
      finals?: boolean;
    }> = [
      ...(myOpenSlot
        ? [
            {
              key: "finals",
              icon: "trophy" as IconName,
              tint: colors.win,
              title: `Record your ${myOpenSlot.label}`,
              body: "Bracket tie with equal dealt teams. No ELO — the winner advances.",
              onPress: enterFinals,
              finals: true,
            },
          ]
        : []),
      ...(AI_FEATURES
        ? [
            {
              key: "snap",
              icon: "camera" as IconName,
              tint: colors.accent,
              title: "Upload match photo",
              body: "Snap the full-time stats screen. AI Beta suggests the score and stats for you to verify.",
              onPress: () => enterMode("snap", opponent, true),
            },
          ]
        : []),
      {
        key: "auto",
        icon: "swords",
        tint: colors.accent,
        title: "Auto matchup",
        body: "Pick an opponent and the system deals both teams, balanced to your ELOs.",
        onPress: () => enterMode("auto", opponent, true),
      },
      {
        key: "manual",
        icon: "edit",
        tint: colors.textDim,
        title: "Enter manually",
        body: "Pick opponent, teams and score step by step.",
        onPress: () => enterMode("manual", opponent, true),
      },
    ];
    return (
      <Page header={header} width="default">
        <Reveal>
          <Txt variant="head" size={isDesktop ? 28 : 24} style={{ marginTop: spacing.sm }}>
            How would you like to log this match?
          </Txt>
          <Txt
            color={colors.textDim}
            size={13.5}
            style={{ marginTop: spacing.sm, lineHeight: 20, marginBottom: spacing.x2 }}
          >
            We'll remember your choice — next time you land straight in it.
          </Txt>
        </Reveal>
        <Grid min={isDesktop ? 260 : 600} maxColumns={4} gap={spacing.md}>
          {cards.map((card, index) => (
            <Reveal key={card.key} index={index} style={{ flex: 1 }}>
              <Interactive
                onPress={card.onPress}
                lift
                accessibilityLabel={card.title}
                style={[
                  styles.modeCard,
                  isDesktop && styles.modeCardTile,
                  card.finals && styles.finalsCard,
                ]}
                hoverStyle={{ borderColor: card.finals ? colors.win : colors.lineStrong }}
              >
                <View style={[styles.modeIcon, { backgroundColor: withAlpha(card.tint, 0.12) }]}>
                  <Icon name={card.icon} size={26} color={card.tint} />
                </View>
                <View style={{ flex: isDesktop ? undefined : 1 }}>
                  <Txt variant="head" size={16}>
                    {card.title}
                  </Txt>
                  <Txt size={12.5} color={colors.textDim} style={{ marginTop: 4, lineHeight: 18 }}>
                    {card.body}
                  </Txt>
                </View>
                {isDesktop ? null : <Icon name="chevron" size={16} color={colors.textDim} />}
              </Interactive>
            </Reveal>
          ))}
        </Grid>
      </Page>
    );
  }

  const stepNames =
    mode === "auto" ? AUTO_STEP_NAMES : mode === "finals" ? FINALS_STEP_NAMES : STEP_NAMES;
  const oppFirst = opponent ? firstName(opponent.name) : "Opponent";
  const showModeSwitch = step === 0;

  let stepBody: ReactNode = null;
  if (step === 0) {
    stepBody = (
      <>
        <StepTitle>Who did you play?</StepTitle>
        <OpponentPicker
          players={players}
          ratingByUid={ratingByUid}
          history={history.opponents}
          selectedId={opponent?.id ?? null}
          onSelect={pickOpponent}
        />
      </>
    );
  } else if (step === 1 && opponent && mode !== "auto") {
    const quickPicks =
      opponentTeam || !opponentHistory
        ? undefined
        : opponentHistory.teamIds
            .map((id) => teamById.get(id))
            .filter((team): team is Team => !!team)
            .slice(0, 2)
            .map((team, index) => ({
              label: index === 0 ? `Last time: ${team.name}` : team.name,
              team,
            }));
    stepBody = (
      <>
        <StepTitle>Which teams did you use?</StepTitle>
        <Columns at="tablet" gap={spacing.lg}>
          <TeamPicker
            label="Your team"
            player={me}
            teams={teams}
            value={myTeam}
            onChange={(team) => {
              setActionError(null);
              setMyTeam(team);
            }}
            recentTeamIds={history.myTeamIds}
            hint={myTeam && myTeam.id === defaultMyTeam?.id ? "Your last team" : undefined}
          />
          <TeamPicker
            label={`${oppFirst}'s team`}
            player={opponent}
            teams={teams}
            value={opponentTeam}
            onChange={(team) => {
              setActionError(null);
              setOpponentTeam(team);
            }}
            recentTeamIds={opponentHistory?.teamIds}
            quickPicks={quickPicks}
          />
        </Columns>
      </>
    );
  } else if (step === 1 && opponent && mode === "auto") {
    stepBody = (
      <>
        <StepTitle>Your matchup</StepTitle>
        {dealError && !dealing ? (
          <ErrorCard message={dealError} onRetry={() => void dealFixture(opponent)} />
        ) : dealing && !fixture ? (
          <View style={{ gap: spacing.md }} accessibilityLabel="Dealing teams">
            <FixtureSkeleton />
            <View style={styles.vsRow}>
              <Txt variant="head" size={12} color={colors.textDim}>
                Dealing balanced teams…
              </Txt>
            </View>
            <FixtureSkeleton />
          </View>
        ) : fixture && myTeam && opponentTeam ? (
          <View style={dealing ? { opacity: 0.5 } : undefined}>
            <Reveal key={`${fixture.id}-${fixture.rerollCount}-a`} from="scale">
              <FixtureTeamCard player={me} label="You" team={myTeam} />
            </Reveal>
            <View style={styles.vsRow}>
              <Icon name="swords" size={16} color={colors.textDim} />
              <Txt variant="head" size={12} color={colors.textDim}>
                VS
              </Txt>
            </View>
            <Reveal key={`${fixture.id}-${fixture.rerollCount}-b`} from="scale" delay={90}>
              <FixtureTeamCard player={opponent} label={oppFirst} team={opponentTeam} />
            </Reveal>
            <View style={styles.note}>
              <Icon name="bolt" size={15} color={colors.accent} />
              <Txt size={12.5} color={colors.textDim} style={{ flex: 1, lineHeight: 17 }}>
                Dealt to level this matchup at your current ELOs. Play with these exact teams — the
                result won't record otherwise.
              </Txt>
            </View>
            {fixture.rerollCount < 1 ? (
              <Button
                variant="ghost"
                icon="dice"
                loading={dealing}
                onPress={() => void dealFixture(opponent, true)}
                style={{ marginTop: spacing.lg, alignSelf: "center" }}
              >
                Reroll teams (once)
              </Button>
            ) : (
              <Txt size={11.5} color={colors.textFaint} style={styles.lockedNote}>
                Reroll used — these teams are locked in.
              </Txt>
            )}
          </View>
        ) : null}
      </>
    );
  } else if (step === 2 && opponent) {
    stepBody = (
      <>
        <StepTitle>Final score</StepTitle>
        {mode === "finals" && myOpenSlot ? (
          <View style={styles.finalsBanner}>
            <Icon name="trophy" size={15} color={colors.win} />
            <Txt size={12.5} color={colors.textDim} style={{ flex: 1, lineHeight: 17 }}>
              {myOpenSlot.label} — equal dealt teams, winner advances. Score after extra time
              counts; pick how it was decided below.
            </Txt>
          </View>
        ) : null}
        <Card style={styles.scoreCard}>
          <View style={styles.scoreRow}>
            <ScoreSide player={me} name="You" team={myTeam?.name}>
              <ScoreStepper
                value={myGoals}
                onChange={(value) => editScore("mine", value)}
                label="your goals"
                size={isTablet ? "lg" : "md"}
                autoFocus={isWeb && isDesktop}
                onSubmitEditing={() => opponentScoreRef.current?.focus()}
              />
            </ScoreSide>
            <Txt variant="monoBold" size={30} color={colors.textFaint} style={styles.colon}>
              :
            </Txt>
            <ScoreSide player={opponent} name={oppFirst} team={opponentTeam?.name}>
              <ScoreStepper
                inputRef={opponentScoreRef}
                value={opponentGoals}
                onChange={(value) => editScore("theirs", value)}
                label={`${oppFirst}'s goals`}
                size={isTablet ? "lg" : "md"}
                returnKeyType="done"
                onSubmitEditing={next}
              />
            </ScoreSide>
          </View>
        </Card>
        {mode === "finals" ? (
          <>
            <Txt variant="head" size={11} color={colors.textDim} style={styles.subLabel}>
              DECIDED BY
            </Txt>
            <Segmented options={DECIDED_BY_OPTIONS} value={decidedBy} onChange={setDecidedBy} />
            {scoreTouched && myGoals === opponentGoals ? (
              <Txt
                size={12}
                color={colors.loss}
                style={{ marginTop: spacing.md, textAlign: "center" }}
                accessibilityLiveRegion="polite"
              >
                Finals can't end level — play extra time and penalties, then enter the decisive
                score.
              </Txt>
            ) : null}
          </>
        ) : !isDesktop ? (
          // Desktop shows this in the live match card beside the form.
          <Card style={styles.eloCard}>
            <Txt variant="head" size={10.5} color={colors.textDim} style={styles.kicker}>
              ELO AFTER CONFIRMATION
            </Txt>
            <EloLine label="You" before={myElo} delta={myDelta} strong />
            <EloLine label={oppFirst} before={opponentElo} delta={opponentDelta} />
          </Card>
        ) : null}
      </>
    );
  }

  const isLast = step === LAST_STEP;
  const footer = (
    <View style={[styles.footer, isDesktop && styles.footerDesktop]}>
      {actionError ? (
        <ErrorCard
          message={actionError}
          onRetry={isLast ? () => void submit() : undefined}
          retrying={submitting}
          style={{ marginBottom: spacing.md }}
        />
      ) : null}
      <View style={styles.footerRow}>
        {isDesktop ? (
          <Txt size={12} color={colors.textFaint} style={{ flex: 1 }}>
            {isWeb ? `Enter ↵ ${isLast ? "submit" : "continue"} · Esc back` : ""}
          </Txt>
        ) : null}
        {isDesktop && (step > 0 || mode === "finals") ? (
          <Button variant="ghost" size="lg" icon="back" onPress={goBack}>
            Back
          </Button>
        ) : null}
        <Button
          size="lg"
          full={!isDesktop}
          icon={isLast ? "check" : "arrowRight"}
          disabled={!canContinue}
          loading={submitting}
          onPress={next}
          style={isDesktop ? { minWidth: 200 } : undefined}
        >
          {isLast ? "Submit match" : "Continue"}
        </Button>
      </View>
    </View>
  );

  return (
    <Page
      header={
        <>
          {header}
          <ProgressTrack total={stepNames.length} current={step} />
          {showModeSwitch ? <View style={styles.modeSwitch}>{modeSwitch}</View> : null}
        </>
      }
      footer={footer}
      width="default"
      scrollRef={scrollRef}
    >
      <StickySplit
        main={
          <Reveal
            key={`${mode}-${step}`}
            from={direction === "forward" ? "left" : "right"}
            duration={280}
          >
            {stepBody}
          </Reveal>
        }
        aside={
          isDesktop ? (
            <MatchPreview
              me={me}
              opponent={opponent}
              myTeam={myTeam}
              opponentTeam={opponentTeam}
              myGoals={myGoals}
              opponentGoals={opponentGoals}
              myElo={myElo}
              opponentElo={opponentElo}
              myDelta={myDelta}
              opponentDelta={opponentDelta}
              finalsLabel={mode === "finals" ? (myOpenSlot?.label ?? "Finals") : null}
              decidedBy={
                mode === "finals"
                  ? DECIDED_BY_OPTIONS.find((option) => option.value === decidedBy)?.label
                  : undefined
              }
              dealing={mode === "auto" && dealing}
            />
          ) : null
        }
      />
    </Page>
  );
}

function StepTitle({ children }: { children: string }) {
  return (
    <Txt variant="head" size={22} style={{ marginBottom: spacing.lg }} accessibilityRole="header">
      {children}
    </Txt>
  );
}

/** Segmented progress with each segment filling as the wizard advances. */
function ProgressTrack({ total, current }: { total: number; current: number }) {
  return (
    <View
      style={styles.track}
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 1, max: total, now: current + 1 }}
    >
      {Array.from({ length: total }, (_, index) => (
        <View key={index} style={styles.trackSegment}>
          <Animated.View
            style={{
              ...styles.trackFill,
              width: index <= current ? "100%" : "0%",
              transitionProperty: "width",
              transitionDuration: 360,
              transitionTimingFunction: EASE_OUT,
            }}
          />
        </View>
      ))}
    </View>
  );
}

function ScoreSide({
  player,
  name,
  team,
  children,
}: {
  player: Player | null;
  name: string;
  team?: string;
  children: ReactNode;
}) {
  return (
    <View style={styles.scoreSide}>
      <Avatar player={player} size={48} jersey />
      <Txt variant="bodyMedium" size={14} style={{ marginTop: spacing.sm }} numberOfLines={1}>
        {name}
      </Txt>
      <Txt
        size={11}
        color={colors.textDim}
        numberOfLines={1}
        style={{ marginTop: 2, marginBottom: spacing.md }}
      >
        {team ?? "—"}
      </Txt>
      {children}
    </View>
  );
}

/** Sticky desktop card: the match as it will be sent, updating live with every edit. */
function MatchPreview({
  me,
  opponent,
  myTeam,
  opponentTeam,
  myGoals,
  opponentGoals,
  myElo,
  opponentElo,
  myDelta,
  opponentDelta,
  finalsLabel,
  decidedBy,
  dealing,
}: {
  me: Player | null;
  opponent: LeaguePlayer | null;
  myTeam: Team | null;
  opponentTeam: Team | null;
  myGoals: number;
  opponentGoals: number;
  myElo: number;
  opponentElo: number;
  myDelta: number;
  opponentDelta: number;
  finalsLabel: string | null;
  decidedBy?: string;
  dealing: boolean;
}) {
  const oppFirst = opponent ? firstName(opponent.name) : "Opponent";
  return (
    <Card style={styles.preview}>
      <View style={styles.previewHead}>
        <Txt variant="head" size={10.5} color={colors.textDim} style={styles.kicker}>
          {finalsLabel ? finalsLabel.toUpperCase() : "MATCH CARD"}
        </Txt>
        <Tag tone="neutral">Draft</Tag>
      </View>
      <View style={styles.previewScore}>
        <PreviewSide player={me} name="You" team={myTeam?.name} dealing={dealing} />
        <View style={styles.previewDigits}>
          <Digit value={myGoals} />
          <Txt variant="monoBold" size={36} color={colors.textFaint}>
            :
          </Txt>
          <Digit value={opponentGoals} />
        </View>
        <PreviewSide
          player={opponent}
          name={opponent ? oppFirst : "Opponent"}
          team={opponentTeam?.name}
          dealing={dealing}
        />
      </View>
      <View style={styles.divider} />
      {finalsLabel ? (
        <View style={styles.previewNote}>
          <Icon name="trophy" size={15} color={colors.gold} />
          <Txt size={12.5} color={colors.textDim} style={{ flex: 1, lineHeight: 18 }}>
            No ELO change — the winner advances{decidedBy ? ` · ${decidedBy}` : ""}.
          </Txt>
        </View>
      ) : opponent ? (
        <View style={{ gap: spacing.sm }}>
          <Txt variant="head" size={10.5} color={colors.textDim} style={styles.kicker}>
            ELO AFTER CONFIRMATION
          </Txt>
          <EloLine label="You" before={myElo} delta={myDelta} strong />
          <EloLine label={oppFirst} before={opponentElo} delta={opponentDelta} />
        </View>
      ) : (
        <Txt size={12.5} color={colors.textDim}>
          Pick an opponent to see how the result moves both ratings.
        </Txt>
      )}
      <Txt size={11.5} color={colors.textFaint} style={{ marginTop: spacing.md, lineHeight: 16 }}>
        {opponent
          ? `${oppFirst} confirms before it counts — they'll get a notification.`
          : "Results only count once your opponent confirms them."}
      </Txt>
    </Card>
  );
}

function PreviewSide({
  player,
  name,
  team,
  dealing,
}: {
  player: Player | null;
  name: string;
  team?: string;
  dealing: boolean;
}) {
  return (
    <View style={styles.previewSide}>
      {player ? (
        <Avatar player={player} size={52} jersey />
      ) : (
        <View style={styles.placeholderAvatar}>
          <Icon name="users" size={20} color={colors.textFaint} />
        </View>
      )}
      <Txt variant="bodyMedium" size={13.5} style={{ marginTop: spacing.sm }} numberOfLines={1}>
        {name}
      </Txt>
      {dealing ? (
        <Skeleton width={70} height={10} style={{ marginTop: 5 }} />
      ) : (
        <Txt
          size={11}
          color={team ? colors.textDim : colors.textFaint}
          numberOfLines={1}
          style={{ marginTop: 3 }}
        >
          {team ?? "Team TBD"}
        </Txt>
      )}
    </View>
  );
}

/** A score digit that rolls in when it changes. */
function Digit({ value }: { value: number }) {
  return (
    <Reveal key={value} from="up" duration={220}>
      <Txt variant="monoBold" size={44}>
        {value}
      </Txt>
    </Reveal>
  );
}

function FixtureSkeleton() {
  return (
    <View style={[styles.fixtureCard, { borderColor: colors.line }]}>
      <Skeleton width={42} height={42} round={21} />
      <View style={{ flex: 1, gap: 7 }}>
        <Skeleton width="25%" height={10} />
        <Skeleton width="55%" height={14} />
      </View>
      <Skeleton width={52} height={52} round={radius.sm} />
    </View>
  );
}

function FixtureTeamCard({
  player,
  label,
  team,
}: {
  player: Player | null;
  label: string;
  team: Team;
}) {
  return (
    <View style={styles.fixtureCard}>
      <Avatar player={player} size={42} jersey />
      <View style={{ flex: 1 }}>
        <Txt variant="head" size={11} color={colors.textDim}>
          {label.toUpperCase()}
        </Txt>
        <Txt variant="bodyMedium" size={15} style={{ marginTop: 3 }}>
          {team.name}
        </Txt>
        {team.competition ? (
          <Txt size={10.5} color={colors.textDim} numberOfLines={1} style={{ marginTop: 3 }}>
            {team.competition}
          </Txt>
        ) : null}
      </View>
      <View style={styles.overallBadge}>
        <Txt variant="monoBold" size={18} color={colors.accent}>
          {team.overall ?? "—"}
        </Txt>
        <Txt size={8.5} color={colors.textDim}>
          OVR
        </Txt>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  headerDesktop: { minHeight: 64, paddingTop: spacing.x2, paddingBottom: spacing.md },
  modeSwitch: { marginTop: spacing.md, alignItems: "flex-start" },
  track: { flexDirection: "row", gap: 5, marginTop: spacing.xs },
  trackSegment: {
    flex: 1,
    height: 3,
    borderRadius: 2,
    backgroundColor: colors.surface2,
    overflow: "hidden",
  },
  trackFill: { height: "100%", borderRadius: 2, backgroundColor: colors.accent },
  footer: {
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    backgroundColor: colors.bg,
  },
  footerDesktop: { paddingBottom: spacing.lg },
  footerRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  modeCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
  },
  modeCardTile: {
    flex: 1,
    flexDirection: "column",
    alignItems: "flex-start",
    minHeight: 200,
    padding: spacing.x2,
  },
  modeIcon: {
    width: 52,
    height: 52,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  finalsCard: { borderColor: withAlpha(colors.win, 0.45) },
  vsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    marginVertical: spacing.md,
  },
  note: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginTop: spacing.x2,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: withAlpha(colors.accent, 0.07),
    borderWidth: 1,
    borderColor: withAlpha(colors.accent, 0.2),
  },
  lockedNote: { marginTop: spacing.md, textAlign: "center" },
  fixtureCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: withAlpha(colors.accent, 0.35),
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
  },
  overallBadge: {
    width: 52,
    height: 52,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface2,
  },
  finalsBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: spacing.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: withAlpha(colors.win, 0.3),
    borderRadius: radius.md,
    backgroundColor: withAlpha(colors.win, 0.07),
  },
  scoreCard: { paddingVertical: spacing.x2 },
  scoreRow: { flexDirection: "row", alignItems: "flex-end", gap: spacing.xs },
  scoreSide: { flex: 1, alignItems: "center", minWidth: 0 },
  colon: { marginBottom: 8 },
  subLabel: { letterSpacing: 1.2, marginTop: spacing.x2, marginBottom: spacing.sm },
  eloCard: { marginTop: spacing.lg, gap: spacing.sm },
  kicker: { letterSpacing: 1.2 },
  preview: { padding: spacing.xl, gap: spacing.xs },
  previewHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  previewScore: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    marginVertical: spacing.x2,
  },
  previewDigits: { flexDirection: "row", alignItems: "center", gap: 4 },
  previewSide: { flex: 1, alignItems: "center", minWidth: 0 },
  placeholderAvatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: colors.lineStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  previewNote: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  divider: { height: 1, backgroundColor: colors.line, marginBottom: spacing.lg },
});
