import { useCallback } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Avatar, Icon, ScreenHeader, SectionLabel, Txt } from "@/components";
import { useAuth } from "@/lib/auth";
import {
  awardWalkover,
  bracketSlots,
  getActiveSeason,
  getBracket,
  getLeaguePlayers,
  type FinalsBracket,
  type FinalsSlot,
  type LeaguePlayer,
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

  const { data, loading, reload } = useFocusData<FinalsData>(
    "finals-bracket",
    useCallback(async () => {
      const season = await getActiveSeason();
      const [bracket, players] = await Promise.all([
        season ? getBracket(season.id) : Promise.resolve(null),
        getLeaguePlayers(),
      ]);
      return { season, bracket, players };
    }, []),
  );

  const season = data?.season ?? null;
  const bracket = data?.bracket ?? null;
  const players = data?.players ?? [];
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

        {!loading && (!season || !bracket) ? (
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
            W/O
          </Txt>
        </Pressable>
      ) : null}
    </View>
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
});
