import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  InteractionManager,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Avatar, Button, Card, EloDelta, Icon, SnapFlow, TeamPicker, Txt } from "@/components";
import { useAuth } from "@/lib/auth";
import {
  createFixture,
  getActiveSeason,
  getBracket,
  getLeaguePlayers,
  getStandings,
  getTeams,
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
import { colors, radius, spacing } from "@/theme";
import { withAlpha } from "@/lib/color";
import type { Player } from "@/types";

const STEP_NAMES = ["Opponent", "Teams", "Score", "Review"];
const AUTO_STEP_NAMES = ["Opponent", "Matchup", "Score", "Review"];
const FINALS_STEP_NAMES = ["Tie", "Teams", "Score", "Review"];

const DECIDED_BY_OPTIONS: Array<{ value: Exclude<FinalsDecidedBy, "walkover">; label: string }> = [
  { value: "regulation", label: "Full time" },
  { value: "extra_time", label: "Extra time" },
  { value: "penalties", label: "Penalties" },
];

export default function LogMatch() {
  const router = useRouter();
  const { user, profile } = useAuth();
  const [mode, setMode] = useState<"choose" | "manual" | "snap" | "auto" | "finals">("choose");
  const [step, setStep] = useState(0);
  const [fixture, setFixture] = useState<Fixture | null>(null);
  const [dealing, setDealing] = useState(false);
  const [bracket, setBracket] = useState<FinalsBracket | null>(null);
  const [decidedBy, setDecidedBy] = useState<Exclude<FinalsDecidedBy, "walkover">>("regulation");
  const [season, setSeason] = useState<Season | null>(null);
  const [players, setPlayers] = useState<LeaguePlayer[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [standings, setStandings] = useState<Standing[]>([]);
  const [opponent, setOpponent] = useState<LeaguePlayer | null>(null);
  const [myTeam, setMyTeam] = useState<Team | null>(null);
  const [opponentTeam, setOpponentTeam] = useState<Team | null>(null);
  const [myGoals, setMyGoals] = useState(0);
  const [opponentGoals, setOpponentGoals] = useState(0);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Defer the fetch until the push animation settles so the transition stays smooth.
    const task = InteractionManager.runAfterInteractions(() => {
      Promise.all([getActiveSeason(), getLeaguePlayers(), getTeams()])
        .then(async ([activeSeason, roster, teamList]) => {
          setSeason(activeSeason);
          setPlayers(roster.filter((player) => player.id !== user?.uid));
          setTeams(teamList);
          if (activeSeason) {
            setStandings(await getStandings(activeSeason.id));
            if (activeSeason.phase === "finals") setBracket(await getBracket(activeSeason.id));
          }
          if (!activeSeason)
            setError("No active season yet. Ask an admin to initialize the league.");
          else if (teamList.length === 0) setError("No active teams are available yet.");
        })
        .catch(() => setError("Couldn't load the league. Check the connection and try again."))
        .finally(() => setLoading(false));
    });
    return () => task.cancel();
  }, [user?.uid]);

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
  const myGames = gamesByUid.get(user?.uid ?? "") ?? 0;
  const opponentGames = gamesByUid.get(opponent?.id ?? "") ?? 0;
  const myDelta = opponent
    ? previewElo(
        myElo,
        opponentElo,
        myGoals,
        opponentGoals,
        myTeam?.overall,
        opponentTeam?.overall,
        myGames,
      )
    : 0;
  const opponentDelta = opponent
    ? previewElo(
        opponentElo,
        myElo,
        opponentGoals,
        myGoals,
        opponentTeam?.overall,
        myTeam?.overall,
        opponentGames,
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

  const canContinue =
    (step === 0 && !!opponent) ||
    (step === 1 && !!myTeam && !!opponentTeam && (mode !== "auto" || (!!fixture && !dealing))) ||
    (step === 2 && (mode !== "finals" || myGoals !== opponentGoals)) ||
    step === 3;

  function goBack() {
    // Finals mode enters directly at the score step; back exits to the mode chooser.
    if (step === 0 || (mode === "finals" && step === 2)) setMode("choose");
    else setStep((current) => current - 1);
  }

  function selectOpponent(player: LeaguePlayer) {
    if (player.id === opponent?.id) return;
    setOpponent(player);
    if (mode === "auto") {
      // A fixture is per-pair: switching opponent invalidates the dealt teams.
      setFixture(null);
      setMyTeam(null);
      setOpponentTeam(null);
    }
  }

  /** Resolve a dealt fixture side to a Team for the preview/review UI. Falls back to a
   *  minimal Team built from the fixture snapshot if the catalogue read is missing it. */
  function fixtureTeam(dealt: Fixture, wantSideA: boolean): Team {
    const id = wantSideA ? dealt.aTeamId : dealt.bTeamId;
    const known = teams.find((team) => team.id === id);
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

  async function dealFixture(reroll = false) {
    if (!opponent || !user) return;
    setDealing(true);
    setError(null);
    try {
      const dealt = await createFixture(opponent.id, reroll);
      const mineIsA = dealt.aId === user.uid;
      setFixture(dealt);
      setMyTeam(fixtureTeam(dealt, mineIsA));
      setOpponentTeam(fixtureTeam(dealt, !mineIsA));
    } catch (dealError) {
      setError(
        dealError instanceof Error && dealError.message
          ? dealError.message
          : "Couldn't deal a matchup. Try again.",
      );
    } finally {
      setDealing(false);
    }
  }

  /** Resolve a bracket-slot side to a Team for the UI, mirroring fixtureTeam. */
  function slotTeam(slot: FinalsSlot, wantHome: boolean): Team | null {
    const id = wantHome ? slot.homeTeamId : slot.awayTeamId;
    if (!id) return null;
    const known = teams.find((team) => team.id === id);
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

  /** Enter finals mode: opponent and teams come from the open tie, straight to the score. */
  function enterFinals() {
    if (!myOpenSlot || !user) return;
    const iAmHome = myOpenSlot.homeId === user.uid;
    const oppId = iAmHome ? myOpenSlot.awayId : myOpenSlot.homeId;
    setOpponent(players.find((player) => player.id === oppId) ?? null);
    setMyTeam(slotTeam(myOpenSlot, iAmHome));
    setOpponentTeam(slotTeam(myOpenSlot, !iAmHome));
    setMyGoals(0);
    setOpponentGoals(0);
    setDecidedBy("regulation");
    setError(null);
    setStep(2);
    setMode("finals");
  }

  async function next() {
    if (!canContinue) return;
    if (step < 3) {
      const enteringMatchup = mode === "auto" && step === 0 && !fixture;
      setStep((current) => current + 1);
      if (enteringMatchup) void dealFixture();
      return;
    }
    if (!user || !season || !opponent || !myTeam || !opponentTeam) return;

    setSubmitting(true);
    setError(null);
    try {
      if (mode === "finals") {
        if (!myOpenSlot) return;
        const iAmHome = myOpenSlot.homeId === user.uid;
        await submitFinalsMatch({
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
        await submitFixtureMatch({
          fixture,
          submittedBy: user.uid,
          aGoals: mineIsA ? myGoals : opponentGoals,
          bGoals: mineIsA ? opponentGoals : myGoals,
        });
      } else {
        await submitManualMatch({
          seasonId: season.id,
          submittedBy: user.uid,
          opponentId: opponent.id,
          myTeam,
          opponentTeam,
          myGoals,
          opponentGoals,
        });
      }
      setSubmitted(true);
    } catch {
      setError("The match couldn't be submitted. Check the emulators and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator color={colors.accent} />
      </SafeAreaView>
    );
  }

  if (mode === "snap" && user && season && profile) {
    return (
      <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
        <SnapFlow
          uid={user.uid}
          profile={profile}
          season={season}
          players={players}
          teams={teams}
          standings={standings}
          onCancel={() => setMode("choose")}
          onManualFallback={() => {
            setStep(0);
            setMode("manual");
          }}
          onDone={() => router.replace("/(app)/(tabs)")}
        />
      </SafeAreaView>
    );
  }

  if (mode === "choose") {
    return (
      <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.iconButton}>
            <Icon name="x" size={20} stroke={2.5} />
          </Pressable>
          <Txt variant="head" size={18}>
            Log a match
          </Txt>
        </View>
        <ScrollView contentContainerStyle={[styles.content, { flex: 1, justifyContent: "center" }]}>
          <Txt variant="head" size={24}>
            How would you like to log this match?
          </Txt>
          <Txt
            color={colors.textDim}
            size={13}
            style={{ marginTop: spacing.sm, lineHeight: 19, marginBottom: spacing.x2 }}
          >
            Snap the result screen, let the system deal a balanced matchup, or enter everything
            manually.
          </Txt>
          <View style={{ gap: spacing.md }}>
            {myOpenSlot ? (
              <Pressable onPress={enterFinals} style={[styles.modeCard, styles.finalsCard]}>
                <View style={[styles.modeIcon, { backgroundColor: withAlpha(colors.win, 0.12) }]}>
                  <Icon name="trophy" size={28} color={colors.win} />
                </View>
                <View style={{ flex: 1 }}>
                  <Txt variant="head" size={16}>
                    Record your {myOpenSlot.label}
                  </Txt>
                  <Txt size={12.5} color={colors.textDim} style={{ marginTop: 4, lineHeight: 17 }}>
                    Bracket tie with equal dealt teams. No ELO — the winner advances.
                  </Txt>
                </View>
                <Icon name="chevron" size={16} color={colors.textDim} />
              </Pressable>
            ) : null}
            <Pressable onPress={() => setMode("snap")} style={styles.modeCard}>
              <View style={[styles.modeIcon, { backgroundColor: withAlpha(colors.accent, 0.12) }]}>
                <Icon name="camera" size={28} color={colors.accent} />
              </View>
              <View style={{ flex: 1 }}>
                <Txt variant="head" size={16}>
                  Upload match photo
                </Txt>
                <Txt size={12.5} color={colors.textDim} style={{ marginTop: 4, lineHeight: 17 }}>
                  Upload the end-of-match screen. AI Beta suggests the score and stats for you to
                  verify.
                </Txt>
              </View>
              <Icon name="chevron" size={16} color={colors.textDim} />
            </Pressable>
            <Pressable
              onPress={() => {
                setStep(0);
                setMode("auto");
              }}
              style={styles.modeCard}
            >
              <View style={[styles.modeIcon, { backgroundColor: withAlpha(colors.accent, 0.12) }]}>
                <Icon name="swords" size={28} color={colors.accent} />
              </View>
              <View style={{ flex: 1 }}>
                <Txt variant="head" size={16}>
                  Auto matchup
                </Txt>
                <Txt size={12.5} color={colors.textDim} style={{ marginTop: 4, lineHeight: 17 }}>
                  Pick an opponent and the system deals both teams, balanced to your ELOs. Play the
                  fixture, then record the score.
                </Txt>
              </View>
              <Icon name="chevron" size={16} color={colors.textDim} />
            </Pressable>
            <Pressable onPress={() => setMode("manual")} style={styles.modeCard}>
              <View style={[styles.modeIcon, { backgroundColor: colors.surface2 }]}>
                <Icon name="edit" size={28} color={colors.textDim} />
              </View>
              <View style={{ flex: 1 }}>
                <Txt variant="head" size={16}>
                  Enter manually
                </Txt>
                <Txt size={12.5} color={colors.textDim} style={{ marginTop: 4, lineHeight: 17 }}>
                  Pick opponent, teams, and score step-by-step the classic way.
                </Txt>
              </View>
              <Icon name="chevron" size={16} color={colors.textDim} />
            </Pressable>
          </View>
          {error ? (
            <Txt color={colors.loss} size={13} style={{ marginTop: spacing.lg, lineHeight: 19 }}>
              {error}
            </Txt>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (submitted && opponent) {
    const result = myGoals > opponentGoals ? "win" : myGoals < opponentGoals ? "loss" : "draw";
    return (
      <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
        <View style={styles.success}>
          <View
            style={[
              styles.resultBurst,
              {
                backgroundColor: withAlpha(
                  result === "win" ? colors.win : result === "loss" ? colors.loss : colors.draw,
                  0.12,
                ),
              },
            ]}
          >
            <Icon
              name={result === "win" ? "trophy" : result === "loss" ? "flame" : "ball"}
              size={38}
              color={result === "win" ? colors.win : result === "loss" ? colors.loss : colors.draw}
            />
          </View>
          <Txt variant="head" size={26} style={{ textAlign: "center", marginTop: spacing.lg }}>
            Result sent for confirmation.
          </Txt>
          <Txt variant="monoBold" size={56} style={{ marginVertical: spacing.sm }}>
            {myGoals}
            <Txt variant="monoBold" size={56} color={colors.textFaint}>
              :
            </Txt>
            {opponentGoals}
          </Txt>
          <Txt color={colors.textDim} style={{ textAlign: "center", lineHeight: 20 }}>
            {mode === "finals"
              ? `${opponent.name.split(" ")[0]} needs to confirm before the bracket advances.`
              : `${opponent.name.split(" ")[0]} needs to confirm before this affects the table.`}
          </Txt>
          <Card style={styles.previewCard}>
            {mode === "finals" ? (
              <>
                <View>
                  <Txt variant="head" size={10.5} color={colors.textDim}>
                    FINALS RESULT
                  </Txt>
                  <Txt variant="bodyMedium" size={14} style={{ marginTop: 4 }}>
                    No ELO change — bracket only
                  </Txt>
                </View>
                <Txt size={12} color={colors.textFaint}>
                  pending
                </Txt>
              </>
            ) : (
              <>
                <View>
                  <Txt variant="head" size={10.5} color={colors.textDim}>
                    ELO PREVIEW
                  </Txt>
                  <Txt variant="monoBold" size={19} style={{ marginTop: 4 }}>
                    {myElo + myDelta} <EloDelta delta={myDelta} />
                  </Txt>
                </View>
                <Txt size={12} color={colors.textFaint}>
                  pending
                </Txt>
              </>
            )}
          </Card>
        </View>
        <View style={styles.footer}>
          <Button full size="lg" onPress={() => router.replace("/(app)/(tabs)")}>
            Back to dashboard
          </Button>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <Pressable onPress={goBack} style={styles.iconButton}>
          <Icon name={step === 0 ? "x" : "back"} size={20} stroke={2.5} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Txt variant="head" size={18}>
            Log a match
          </Txt>
          <Txt size={11.5} color={colors.textDim} style={{ marginTop: 2 }}>
            Step {step + 1} of 4 ·{" "}
            {
              (mode === "auto"
                ? AUTO_STEP_NAMES
                : mode === "finals"
                  ? FINALS_STEP_NAMES
                  : STEP_NAMES)[step]
            }
          </Txt>
        </View>
      </View>
      <View style={styles.track}>
        {(mode === "auto"
          ? AUTO_STEP_NAMES
          : mode === "finals"
            ? FINALS_STEP_NAMES
            : STEP_NAMES
        ).map((name, index) => (
          <View key={name} style={[styles.trackSegment, index <= step && styles.trackSegmentOn]} />
        ))}
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {step === 0 ? (
          <>
            <StepTitle>Who did you play?</StepTitle>
            <View style={{ gap: spacing.sm }}>
              {players.map((player) => (
                <Pressable
                  key={player.id}
                  onPress={() => selectOpponent(player)}
                  style={[styles.pickRow, opponent?.id === player.id && styles.pickRowActive]}
                >
                  <Avatar player={player} size={42} jersey />
                  <View style={{ flex: 1 }}>
                    <Txt variant="bodyMedium" size={14.5}>
                      {player.name}
                    </Txt>
                    <Txt variant="mono" size={11.5} color={colors.textDim} style={{ marginTop: 3 }}>
                      ELO {ratingByUid.get(player.id) ?? 1500} · @{player.handle}
                    </Txt>
                  </View>
                  {opponent?.id === player.id ? (
                    <View style={styles.check}>
                      <Icon name="check" size={13} color={colors.onAccent} stroke={3} />
                    </View>
                  ) : null}
                </Pressable>
              ))}
              {players.length === 0 ? (
                <Txt color={colors.textDim}>Invite another player before logging a match.</Txt>
              ) : null}
            </View>
          </>
        ) : null}

        {step === 1 && opponent && mode !== "auto" ? (
          <>
            <StepTitle>Which teams did you use?</StepTitle>
            <TeamPicker
              label="Your team"
              player={me}
              teams={teams}
              value={myTeam}
              onChange={setMyTeam}
            />
            <View style={{ height: spacing.lg }} />
            <TeamPicker
              label={`${opponent.name.split(" ")[0]}'s team`}
              player={opponent}
              teams={teams}
              value={opponentTeam}
              onChange={setOpponentTeam}
            />
          </>
        ) : null}

        {step === 1 && opponent && mode === "auto" ? (
          <>
            <StepTitle>Your matchup</StepTitle>
            {dealing ? (
              <View style={styles.dealLoading}>
                <ActivityIndicator color={colors.accent} />
                <Txt color={colors.textDim} size={13}>
                  Dealing teams…
                </Txt>
              </View>
            ) : fixture && myTeam && opponentTeam ? (
              <>
                <FixtureTeamCard player={me} label="You" team={myTeam} />
                <View style={styles.vsRow}>
                  <Icon name="swords" size={16} color={colors.textDim} />
                  <Txt variant="head" size={12} color={colors.textDim}>
                    VS
                  </Txt>
                </View>
                <FixtureTeamCard
                  player={opponent}
                  label={opponent.name.split(" ")[0]}
                  team={opponentTeam}
                />
                <View style={styles.eloPreview}>
                  <Icon name="bolt" size={15} color={colors.accent} />
                  <Txt size={12.5} color={colors.textDim} style={{ flex: 1, lineHeight: 17 }}>
                    Dealt to level this matchup at your current ELOs. Play with these exact teams —
                    the result won't record otherwise.
                  </Txt>
                </View>
                {fixture.rerollCount < 1 ? (
                  <Pressable
                    onPress={() => dealFixture(true)}
                    disabled={dealing}
                    style={styles.rerollButton}
                  >
                    <Icon name="bolt" size={15} color={colors.textDim} />
                    <Txt size={13} color={colors.textDim}>
                      Reroll teams (once)
                    </Txt>
                  </Pressable>
                ) : (
                  <Txt
                    size={11.5}
                    color={colors.textFaint}
                    style={{ marginTop: spacing.md, textAlign: "center" }}
                  >
                    Reroll used — these teams are locked in.
                  </Txt>
                )}
              </>
            ) : null}
          </>
        ) : null}

        {step === 2 && opponent ? (
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
            <View style={styles.scoreRow}>
              <ScoreStepper
                player={me}
                team={myTeam?.name ?? ""}
                value={myGoals}
                onChange={setMyGoals}
              />
              <Txt variant="monoBold" size={28} color={colors.textFaint}>
                :
              </Txt>
              <ScoreStepper
                player={opponent}
                team={opponentTeam?.name ?? ""}
                value={opponentGoals}
                onChange={setOpponentGoals}
              />
            </View>
            {mode === "finals" ? (
              <>
                <View style={styles.decidedByRow}>
                  {DECIDED_BY_OPTIONS.map((option) => (
                    <Pressable
                      key={option.value}
                      onPress={() => setDecidedBy(option.value)}
                      style={[
                        styles.decidedByChip,
                        decidedBy === option.value && styles.decidedByChipActive,
                      ]}
                    >
                      <Txt
                        size={12}
                        color={decidedBy === option.value ? colors.accent : colors.textDim}
                      >
                        {option.label}
                      </Txt>
                    </Pressable>
                  ))}
                </View>
                {myGoals === opponentGoals ? (
                  <Txt
                    size={12}
                    color={colors.loss}
                    style={{ marginTop: spacing.md, textAlign: "center" }}
                  >
                    Finals can't end level — play extra time and penalties, then enter the decisive
                    score.
                  </Txt>
                ) : null}
              </>
            ) : (
              <View style={styles.eloPreview}>
                <Icon name="bolt" size={15} color={colors.accent} />
                <Txt size={12.5} color={colors.textDim}>
                  ELO swing preview
                </Txt>
                <View style={{ marginLeft: "auto" }}>
                  <EloDelta delta={myDelta} />
                </View>
              </View>
            )}
          </>
        ) : null}

        {step === 3 && opponent ? (
          <>
            <StepTitle>Look right?</StepTitle>
            <Card style={styles.reviewCard}>
              <View style={styles.reviewScore}>
                <ReviewPlayer player={me} label="You" team={myTeam?.name ?? ""} />
                <Txt variant="monoBold" size={38}>
                  {myGoals}
                  <Txt variant="monoBold" size={38} color={colors.textFaint}>
                    :
                  </Txt>
                  {opponentGoals}
                </Txt>
                <ReviewPlayer
                  player={opponent}
                  label={opponent.name.split(" ")[0]}
                  team={opponentTeam?.name ?? ""}
                />
              </View>
              <View style={styles.divider} />
              {mode === "finals" && myOpenSlot ? (
                <View style={styles.reviewBottom}>
                  <View>
                    <Txt variant="head" size={10.5} color={colors.textDim}>
                      {myOpenSlot.label.toUpperCase()}
                    </Txt>
                    <Txt size={11.5} color={colors.textFaint} style={{ marginTop: 3 }}>
                      Bracket advances after opponent confirmation
                    </Txt>
                  </View>
                  <Txt variant="bodyMedium" size={12} color={colors.textDim}>
                    {DECIDED_BY_OPTIONS.find((option) => option.value === decidedBy)?.label}
                  </Txt>
                </View>
              ) : (
                <View style={styles.reviewBottom}>
                  <View>
                    <Txt variant="head" size={10.5} color={colors.textDim}>
                      ELO CHANGE PREVIEW
                    </Txt>
                    <Txt size={11.5} color={colors.textFaint} style={{ marginTop: 3 }}>
                      Applies after opponent confirmation
                    </Txt>
                  </View>
                  <View style={{ alignItems: "flex-end" }}>
                    <EloDelta delta={myDelta} />
                    <Txt variant="mono" size={11} color={colors.textDim} style={{ marginTop: 3 }}>
                      opponent {opponentDelta >= 0 ? "+" : ""}
                      {opponentDelta}
                    </Txt>
                  </View>
                </View>
              )}
            </Card>
          </>
        ) : null}

        {error ? (
          <Txt color={colors.loss} size={13} style={{ marginTop: spacing.lg, lineHeight: 19 }}>
            {error}
          </Txt>
        ) : null}
      </ScrollView>

      <View style={styles.footer}>
        <Button
          full
          size="lg"
          icon={step === 3 ? "check" : undefined}
          disabled={!canContinue || submitting || !!error}
          onPress={next}
        >
          {submitting ? "Submitting…" : step === 3 ? "Submit match" : "Continue"}
        </Button>
      </View>
    </SafeAreaView>
  );
}

function StepTitle({ children }: { children: string }) {
  return (
    <Txt variant="head" size={22} style={{ marginBottom: spacing.lg }}>
      {children}
    </Txt>
  );
}

function ScoreStepper({
  player,
  team,
  value,
  onChange,
}: {
  player: Player | null;
  team: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <View style={{ flex: 1, alignItems: "center" }}>
      <Avatar player={player} size={44} jersey />
      <Txt
        size={11}
        color={colors.textDim}
        numberOfLines={1}
        style={{ marginVertical: spacing.sm }}
      >
        {team}
      </Txt>
      <View style={styles.stepper}>
        <Pressable
          onPress={() => onChange(Math.max(0, value - 1))}
          disabled={value === 0}
          style={[styles.stepButton, value === 0 && { opacity: 0.35 }]}
        >
          <Txt variant="monoBold" size={22}>
            -
          </Txt>
        </Pressable>
        <TextInput
          value={String(value)}
          onChangeText={(t) => {
            const n = Number.parseInt(t.replace(/[^0-9]/g, ""), 10);
            onChange(Number.isFinite(n) ? Math.min(99, n) : 0);
          }}
          keyboardType="number-pad"
          selectTextOnFocus
          style={styles.scoreInput}
        />
        <Pressable onPress={() => onChange(Math.min(99, value + 1))} style={styles.stepButton}>
          <Txt variant="monoBold" size={22}>
            +
          </Txt>
        </Pressable>
      </View>
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

function ReviewPlayer({
  player,
  label,
  team,
}: {
  player: Player | null;
  label: string;
  team: string;
}) {
  return (
    <View style={{ flex: 1, alignItems: "center" }}>
      <Avatar player={player} size={48} jersey />
      <Txt variant="bodyMedium" size={13} style={{ marginTop: spacing.sm }}>
        {label}
      </Txt>
      <Txt size={10.5} color={colors.textDim} numberOfLines={1} style={{ marginTop: 2 }}>
        {team}
      </Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  center: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: "center",
    justifyContent: "center",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xs,
    paddingBottom: spacing.sm,
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  track: { flexDirection: "row", gap: 5, paddingHorizontal: spacing.lg },
  trackSegment: { flex: 1, height: 3, borderRadius: 2, backgroundColor: colors.surface2 },
  trackSegmentOn: { backgroundColor: colors.accent },
  content: { padding: spacing.lg, paddingBottom: spacing.x3 },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    backgroundColor: colors.bg,
  },
  pickRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  pickRowActive: {
    borderColor: withAlpha(colors.accent, 0.55),
    backgroundColor: withAlpha(colors.accent, 0.07),
  },
  check: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  scoreRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  stepper: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  scoreInput: {
    minWidth: 56,
    textAlign: "center",
    color: colors.text,
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 34,
    paddingVertical: 2,
  },
  stepButton: {
    width: 38,
    height: 38,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface2,
    alignItems: "center",
    justifyContent: "center",
  },
  eloPreview: {
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
  reviewCard: { padding: spacing.lg },
  reviewScore: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  divider: { height: 1, backgroundColor: colors.line, marginVertical: spacing.lg },
  reviewBottom: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  success: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.x2,
  },
  resultBurst: {
    width: 88,
    height: 88,
    borderRadius: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  previewCard: {
    width: "100%",
    marginTop: spacing.x2,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
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
  modeIcon: {
    width: 56,
    height: 56,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  dealLoading: {
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.x3,
  },
  vsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    marginVertical: spacing.md,
  },
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
  rerollButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    marginTop: spacing.lg,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  finalsCard: { borderColor: withAlpha(colors.win, 0.45) },
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
  decidedByRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: spacing.sm,
    marginTop: spacing.x2,
  },
  decidedByChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
  },
  decidedByChipActive: {
    borderColor: withAlpha(colors.accent, 0.45),
    backgroundColor: withAlpha(colors.accent, 0.08),
  },
});
