import { useCallback } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Avatar, Button, Card, Icon, ScreenHeader, SectionLabel, Txt } from "@/components";
import { useAuth } from "@/lib/auth";
import {
  awardWalkover,
  bracketSlots,
  getActiveSeason,
  getBracket,
  getFinalsScoreboard,
  getLeaguePlayers,
  getMyFinalsPicks,
  pickOutcome,
  saveFinalsPick,
  type FinalsBracket,
  type FinalsPicks,
  type FinalsSlot,
  type LeaguePlayer,
  type PredictionPick,
  type ScoreboardEntry,
  type Season,
} from "@/lib/league";
import { useFocusData } from "@/lib/useFocusData";
import { colors, radius, spacing } from "@/theme";
import { withAlpha } from "@/lib/color";
import { firstName } from "@/lib/format";

interface FinalsData {
  season: Season | null;
  bracket: FinalsBracket | null;
  players: LeaguePlayer[];
  picks: FinalsPicks;
  scoreboard: ScoreboardEntry[];
}

const ROUND_LABELS: Record<FinalsSlot["round"], string> = {
  elimination: "Elimination Finals",
  semi: "Semi Finals",
  final: "Grand Final",
};

const DECIDED_BY_TAGS: Record<string, string> = {
  extra_time: "AET",
  penalties: "PENS",
  walkover: "W/O",
};

export default function FinalsScreen() {
  const router = useRouter();
  const { user, membership } = useAuth();
  const isAdmin = membership?.role === "admin";

  const { data, loading, error, reload } = useFocusData<FinalsData>(
    "finals-bracket",
    useCallback(async () => {
      const season = await getActiveSeason();
      const [bracket, players] = await Promise.all([
        season ? getBracket(season.id) : Promise.resolve(null),
        getLeaguePlayers(),
      ]);
      // Prediction-game data rides along with the bracket load; empty defaults keep the
      // section renderable (and quietly hidden) when finals haven't started.
      const [picks, scoreboard] =
        bracket && user
          ? await Promise.all([
              getMyFinalsPicks(season!.id, user.uid),
              getFinalsScoreboard(season!.id),
            ])
          : [{ picks: {} }, [] as ScoreboardEntry[]];
      return { season, bracket, players, picks, scoreboard };
    }, [user]),
  );

  const season = data?.season ?? null;
  const bracket = data?.bracket ?? null;
  const players = data?.players ?? [];
  const picks = data?.picks ?? { picks: {} };
  const scoreboard = data?.scoreboard ?? [];
  const playerById = new Map(players.map((player) => [player.id, player]));

  const myOpenSlot =
    bracket && user
      ? bracketSlots(bracket).find(
          (slot) =>
            slot.status === "open" && (slot.homeId === user.uid || slot.awayId === user.uid),
        )
      : null;

  function confirmWalkover(slot: FinalsSlot, winnerId: string) {
    const winner = playerById.get(winnerId);
    Alert.alert(
      "Award walkover",
      `${winner?.name ?? winnerId} advances from the ${slot.label} without a match. This can't be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Award",
          style: "destructive",
          onPress: () => {
            if (!season) return;
            awardWalkover(season.id, slot.key, winnerId)
              .then(() => reload())
              .catch((error: unknown) =>
                Alert.alert(
                  "Walkover failed",
                  error instanceof Error ? error.message : "Try again.",
                ),
              );
          },
        },
      ],
    );
  }

  function choosePick(slot: FinalsSlot, predictedWinnerId: string) {
    if (!season || !user || slot.status !== "open") return;
    saveFinalsPick(season.id, user.uid, slot, predictedWinnerId)
      .then(() => reload())
      .catch(() => Alert.alert("Prediction not saved", "Check the connection and try again."));
  }

  const rounds: Array<{ round: FinalsSlot["round"]; slots: FinalsSlot[] }> = [];
  if (bracket) {
    for (const slot of bracketSlots(bracket)) {
      const group = rounds.find((entry) => entry.round === slot.round);
      if (group) group.slots.push(slot);
      else rounds.push({ round: slot.round, slots: [slot] });
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <ScreenHeader title="Finals" />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {loading && !data ? <ActivityIndicator color={colors.accent} /> : null}

        {error ? (
          <Card style={{ borderColor: withAlpha(colors.loss, 0.35), marginBottom: spacing.lg }}>
            <Txt color={colors.loss} size={13}>
              Couldn't load the finals bracket. Check the connection and retry.
            </Txt>
            <Button variant="dark" size="sm" style={{ marginTop: spacing.md }} onPress={reload}>
              Retry
            </Button>
          </Card>
        ) : null}

        {!error && !loading && (!season || !bracket) ? (
          <View style={styles.empty}>
            <Icon name="trophy" size={34} color={colors.textDim} />
            <Txt variant="head" size={17} style={{ marginTop: spacing.md }}>
              Finals haven't started
            </Txt>
            <Txt
              color={colors.textDim}
              size={12.5}
              style={{ marginTop: spacing.sm, textAlign: "center", lineHeight: 18 }}
            >
              When the admin locks the bracket, the top six on the table fight for the championship
              here.
            </Txt>
          </View>
        ) : null}

        {bracket && season ? (
          <>
            <View style={styles.premierCard}>
              <Icon name="medal" size={20} color={colors.accent} />
              <View style={{ flex: 1 }}>
                <Txt variant="head" size={10.5} color={colors.textDim}>
                  PREMIER · TOP OF THE TABLE
                </Txt>
                <Txt variant="bodyMedium" size={15} style={{ marginTop: 3 }}>
                  {playerById.get(bracket.premierId)?.name ?? bracket.premierId}
                </Txt>
              </View>
              <Txt size={11} color={colors.textDim}>
                locked at finals
              </Txt>
            </View>

            <View style={{ marginTop: spacing.lg }}>
              <SectionLabel>Seeds</SectionLabel>
            </View>
            <View style={styles.seedRow}>
              {bracket.seeds.map((seed) => (
                <View key={seed.uid} style={styles.seedChip}>
                  <Txt variant="monoBold" size={12} color={colors.accent}>
                    {seed.rank}
                  </Txt>
                  <Txt size={12}>{firstName(playerById.get(seed.uid)?.name ?? seed.uid)}</Txt>
                </View>
              ))}
            </View>

            {myOpenSlot ? (
              <Pressable
                onPress={() => router.push("/log-match")}
                style={styles.ctaCard}
                accessibilityRole="button"
              >
                <Icon name="swords" size={20} color={colors.accent} />
                <View style={{ flex: 1 }}>
                  <Txt variant="head" size={14}>
                    Your {myOpenSlot.label} is live
                  </Txt>
                  <Txt size={11.5} color={colors.textDim} style={{ marginTop: 2 }}>
                    Play with the dealt teams, then record the result here.
                  </Txt>
                </View>
                <Icon name="chevron" size={16} color={colors.textDim} />
              </Pressable>
            ) : null}

            {rounds.map((group) => (
              <View key={group.round} style={{ marginTop: spacing.xl }}>
                <SectionLabel>{ROUND_LABELS[group.round]}</SectionLabel>
                {group.slots.map((slot) => (
                  <SlotCard
                    key={slot.key}
                    slot={slot}
                    playerById={playerById}
                    isAdmin={isAdmin}
                    onWalkover={confirmWalkover}
                  />
                ))}
              </View>
            ))}

            {user ? (
              <PredictionsSection
                slots={bracketSlots(bracket)}
                picks={picks}
                scoreboard={scoreboard}
                playerById={playerById}
                myUid={user.uid}
                onPick={choosePick}
              />
            ) : null}
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function SlotCard({
  slot,
  playerById,
  isAdmin,
  onWalkover,
}: {
  slot: FinalsSlot;
  playerById: Map<string, LeaguePlayer>;
  isAdmin: boolean;
  onWalkover: (slot: FinalsSlot, winnerId: string) => void;
}) {
  const decidedTag = slot.decidedBy ? DECIDED_BY_TAGS[slot.decidedBy] : null;
  return (
    <View style={[styles.slotCard, slot.status === "open" && styles.slotCardOpen]}>
      <View style={styles.slotHeader}>
        <Txt variant="head" size={11} color={colors.textDim}>
          {slot.label.toUpperCase()}
        </Txt>
        {slot.status === "decided" ? (
          <View style={styles.statusChip}>
            <Txt size={10} color={colors.textDim}>
              {decidedTag ? `DECIDED · ${decidedTag}` : "DECIDED"}
            </Txt>
          </View>
        ) : slot.status === "open" ? (
          <View style={[styles.statusChip, styles.statusChipOpen]}>
            <Txt size={10} color={colors.accent}>
              READY TO PLAY
            </Txt>
          </View>
        ) : (
          <View style={styles.statusChip}>
            <Txt size={10} color={colors.textFaint}>
              AWAITING QUALIFIERS
            </Txt>
          </View>
        )}
      </View>
      <SlotSide
        slot={slot}
        side="home"
        playerById={playerById}
        isAdmin={isAdmin}
        onWalkover={onWalkover}
      />
      <View style={styles.slotDivider} />
      <SlotSide
        slot={slot}
        side="away"
        playerById={playerById}
        isAdmin={isAdmin}
        onWalkover={onWalkover}
      />
    </View>
  );
}

function SlotSide({
  slot,
  side,
  playerById,
  isAdmin,
  onWalkover,
}: {
  slot: FinalsSlot;
  side: "home" | "away";
  playerById: Map<string, LeaguePlayer>;
  isAdmin: boolean;
  onWalkover: (slot: FinalsSlot, winnerId: string) => void;
}) {
  const id = side === "home" ? slot.homeId : slot.awayId;
  const seed = side === "home" ? slot.homeSeed : slot.awaySeed;
  const from = side === "home" ? slot.homeFrom : slot.awayFrom;
  const teamName = side === "home" ? slot.homeTeamName : slot.awayTeamName;
  const teamOverall = side === "home" ? slot.homeTeamOverall : slot.awayTeamOverall;
  const player = id ? playerById.get(id) : null;
  const isWinner = slot.status === "decided" && slot.winnerId === id;
  const isLoser = slot.status === "decided" && slot.winnerId !== id;

  return (
    <View style={[styles.sideRow, isLoser && { opacity: 0.45 }]}>
      <Avatar player={player ?? null} size={34} jersey />
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
          {seed != null ? (
            <Txt variant="monoBold" size={11} color={colors.accent}>
              #{seed}
            </Txt>
          ) : null}
          <Txt variant="bodyMedium" size={14}>
            {player?.name ?? (from ? `Winner of ${from.toUpperCase()}` : "TBD")}
          </Txt>
          {isWinner ? <Icon name="trophy" size={13} color={colors.win} /> : null}
        </View>
        {teamName ? (
          <Txt size={11} color={colors.textDim} style={{ marginTop: 2 }}>
            {teamName}
            {teamOverall != null ? ` · OVR ${teamOverall}` : ""}
          </Txt>
        ) : null}
      </View>
      {isAdmin && slot.status === "open" && id ? (
        <Pressable
          onPress={() => onWalkover(slot, id)}
          style={styles.walkoverButton}
          accessibilityLabel={`Award walkover to ${player?.name ?? id}`}
        >
          <Txt size={10} color={colors.textDim}>
            Walkover
          </Txt>
        </Pressable>
      ) : null}
    </View>
  );
}

/** Slots with anything to predict (open ties) or already settled picks, in bracket order. */
function predictableSlots(slots: FinalsSlot[]): FinalsSlot[] {
  return slots.filter((slot) => slot.status === "open" || slot.status === "decided");
}

function PredictionsSection({
  slots,
  picks,
  scoreboard,
  playerById,
  myUid,
  onPick,
}: {
  slots: FinalsSlot[];
  picks: FinalsPicks;
  scoreboard: ScoreboardEntry[];
  playerById: Map<string, LeaguePlayer>;
  myUid: string;
  onPick: (slot: FinalsSlot, predictedWinnerId: string) => void;
}) {
  const rows = predictableSlots(slots);
  const top5 = scoreboard.slice(0, 5);
  if (rows.length === 0 && top5.length === 0) return null;

  return (
    <View style={{ marginTop: spacing.xl }}>
      <SectionLabel>Predictions</SectionLabel>

      {rows.map((slot) => (
        <PickRow
          key={slot.key}
          slot={slot}
          myUid={myUid}
          pick={picks.picks[slot.key]}
          playerById={playerById}
          onPick={onPick}
        />
      ))}

      {top5.length > 0 ? (
        <>
          <SectionLabel style={{ marginTop: spacing.xl }}>Prediction league</SectionLabel>
          <Card>
            {top5.map((entry, index) => (
              <View
                key={entry.predictorId}
                style={[styles.boardRow, index > 0 && styles.boardRowDivider]}
              >
                <Txt variant="monoBold" size={12} color={colors.textDim}>
                  {index + 1}
                </Txt>
                <Txt
                  variant="bodyMedium"
                  size={13}
                  style={{ flex: 1 }}
                  numberOfLines={1}
                  ellipsizeMode="tail"
                >
                  {entry.predictorId === myUid
                    ? "You"
                    : (playerById.get(entry.predictorId)?.name ?? entry.predictorId)}
                </Txt>
                <Txt size={11} color={colors.textDim}>
                  {entry.correct} right
                </Txt>
                <Txt variant="monoBold" size={14} color={colors.accent}>
                  {entry.points} pts
                </Txt>
              </View>
            ))}
          </Card>
        </>
      ) : null}
    </View>
  );
}

function PickRow({
  slot,
  myUid,
  pick,
  playerById,
  onPick,
}: {
  slot: FinalsSlot;
  myUid: string;
  pick: PredictionPick | undefined;
  playerById: Map<string, LeaguePlayer>;
  onPick: (slot: FinalsSlot, predictedWinnerId: string) => void;
}) {
  const outcome = pickOutcome(slot, pick);
  const open = slot.status === "open";
  const sides: Array<"home" | "away"> = ["home", "away"];
  return (
    <Card style={styles.pickCard}>
      <View style={styles.pickHeader}>
        <Txt variant="head" size={10.5} color={colors.textDim}>
          {slot.label.toUpperCase()}
        </Txt>
        {outcome.decided && outcome.points > 0 ? (
          <View style={[styles.statusChip, styles.statusChipOpen]}>
            <Txt size={10} color={colors.accent}>
              {`✓ +${outcome.points}`}
            </Txt>
          </View>
        ) : outcome.decided ? (
          <View style={styles.statusChip}>
            <Txt size={10} color={colors.textDim}>
              missed
            </Txt>
          </View>
        ) : null}
      </View>
      <View style={{ flexDirection: "row", gap: spacing.sm }}>
        {sides.map((side) => (
          <PickSide
            key={side}
            slot={slot}
            side={side}
            myUid={myUid}
            pick={pick}
            selectable={open}
            playerById={playerById}
            onPick={onPick}
          />
        ))}
      </View>
    </Card>
  );
}

function PickSide({
  slot,
  side,
  myUid,
  pick,
  selectable,
  playerById,
  onPick,
}: {
  slot: FinalsSlot;
  side: "home" | "away";
  myUid: string;
  pick: PredictionPick | undefined;
  selectable: boolean;
  playerById: Map<string, LeaguePlayer>;
  onPick: (slot: FinalsSlot, predictedWinnerId: string) => void;
}) {
  const id = side === "home" ? slot.homeId : slot.awayId;
  const seed = side === "home" ? slot.homeSeed : slot.awaySeed;
  if (!id) return null;
  const player = playerById.get(id);
  const selected = pick?.predictedWinnerId === id;
  const isWinner = slot.status === "decided" && slot.winnerId === id;
  // Once decided the whole row is inert; while open only the unselected side needs a press.
  const pressable = selectable && !selected;
  return (
    <Pressable
      onPress={() => (pressable ? onPick(slot, id) : undefined)}
      disabled={!pressable}
      accessibilityRole={pressable ? "button" : undefined}
      accessibilityLabel={`Predict ${player?.name ?? id} to win the ${slot.label}`}
      accessibilityState={selected ? { selected: true } : undefined}
      style={[
        styles.pickSide,
        selected && styles.pickSideSelected,
        isWinner && !selected && styles.pickSideWinnerMissed,
      ]}
    >
      <Avatar player={player ?? null} size={26} jersey />
      <View style={{ flex: 1 }}>
        <Txt variant="bodyMedium" size={12.5} numberOfLines={1} ellipsizeMode="tail">
          {id === myUid ? "You" : firstName(player?.name ?? id)}
        </Txt>
        {seed != null ? (
          <Txt size={10} color={colors.textDim}>
            seed {seed}
          </Txt>
        ) : null}
      </View>
      {isWinner ? <Icon name="check" size={13} color={colors.win} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, paddingBottom: spacing.x3 },
  empty: { alignItems: "center", paddingVertical: spacing.x3, paddingHorizontal: spacing.xl },
  premierCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: withAlpha(colors.accent, 0.35),
    borderRadius: radius.lg,
    backgroundColor: withAlpha(colors.accent, 0.06),
  },
  seedRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  seedChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
  },
  ctaCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    marginTop: spacing.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: withAlpha(colors.accent, 0.45),
    borderRadius: radius.lg,
    backgroundColor: withAlpha(colors.accent, 0.08),
  },
  slotCard: {
    marginTop: spacing.md,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
  },
  slotCardOpen: { borderColor: withAlpha(colors.accent, 0.35) },
  slotHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.md,
  },
  statusChip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.pill,
    backgroundColor: colors.surface2,
  },
  statusChipOpen: { backgroundColor: withAlpha(colors.accent, 0.12) },
  sideRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  slotDivider: { height: 1, backgroundColor: colors.line, marginVertical: spacing.md },
  walkoverButton: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.sm,
    backgroundColor: colors.surface2,
  },
  pickCard: { marginTop: spacing.md, padding: spacing.md },
  pickHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.sm,
  },
  pickSide: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.sm,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    backgroundColor: colors.bg,
  },
  pickSideSelected: {
    borderColor: withAlpha(colors.accent, 0.6),
    backgroundColor: withAlpha(colors.accent, 0.08),
  },
  pickSideWinnerMissed: { opacity: 0.55 },
  boardRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.sm + 2,
  },
  boardRowDivider: {
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
});
