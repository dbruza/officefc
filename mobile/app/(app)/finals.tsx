/**
 * Finals: the end-of-season bracket (top six / four / two), the Premier, the prediction
 * game, and — once the Grand Final is decided — the champion moment. Desktop draws the
 * bracket as a tree with predictions in a right rail (when there's room for both); phones
 * page through one round at a time.
 */
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ActivityIndicator, StyleSheet, View, type LayoutChangeEvent } from "react-native";
import { type Href, useRouter } from "expo-router";
import {
  Avatar,
  Button,
  Card,
  EmptyState,
  ErrorCard,
  Icon,
  Interactive,
  Page,
  Reveal,
  ScreenHeader,
  SectionLabel,
  SkeletonCard,
  Tag,
  Txt,
  sticky,
} from "@/components";
import {
  BracketList,
  BracketSkeleton,
  BracketTree,
  type BracketRound,
  type BracketSide,
  type BracketTie,
} from "@/components/Bracket";
import { ChampionHero } from "@/components/ChampionHero";
import { useAuth } from "@/lib/auth";
import {
  awardWalkover,
  bracketSlots,
  FAVOURITE_POINTS,
  getActiveSeason,
  getBracket,
  getFinalsScoreboard,
  getLeaguePlayers,
  getMyFinalsPicks,
  pickOutcome,
  saveFinalsPick,
  UPSET_POINTS,
  type FinalsBracket,
  type FinalsDecidedBy,
  type FinalsPicks,
  type FinalsSlot,
  type FinalsSlotKey,
  type LeaguePlayer,
  type PredictionPick,
  type ScoreboardEntry,
  type Season,
} from "@/lib/league";
import { useFocusData } from "@/lib/useFocusData";
import { chooseAction, showAlert } from "@/lib/dialogs";
import { toast } from "@/lib/toast";
import { useBreakpoint } from "@/lib/responsive";
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

const ROUND_COPY: Record<FinalsSlot["round"], { label: string; short: string }> = {
  elimination: { label: "Elimination Finals", short: "Elimination" },
  semi: { label: "Semi Finals", short: "Semis" },
  final: { label: "Grand Final", short: "Final" },
};

const STRUCTURE_COPY: Record<FinalsBracket["structure"], string> = {
  top6: "Top-six finals",
  top4: "Top-four finals",
  top2: "Grand Final only",
};

/** Short names for "Winner of …" placeholders, which must fit a compact card. */
const SLOT_SHORT: Record<FinalsSlotKey, string> = {
  e1: "EF 1",
  e2: "EF 2",
  s1: "SF 1",
  s2: "SF 2",
  gf: "GF",
};

const DECIDED_TAG: Record<FinalsDecidedBy, string> = {
  regulation: "FT",
  extra_time: "AET",
  penalties: "PENS",
  walkover: "W/O",
};

const DECIDED_LINE: Record<FinalsDecidedBy, string> = {
  regulation: "",
  extra_time: " after extra time",
  penalties: " on penalties",
  walkover: " by walkover",
};

/** Rail width for predictions beside the tree; below this fit they stack under it. */
const RAIL_W = 320;
const RAIL_GAP = spacing.x2;
/** Smallest tree that reads well: CARD_MIN per column plus connector gutters. */
const treeMinWidth = (columns: number) => columns * 200 + (columns - 1) * 52;

export default function FinalsScreen() {
  const router = useRouter();
  const { user, membership } = useAuth();
  const isAdmin = membership?.role === "admin";
  const { isDesktop } = useBreakpoint();
  const [contentW, setContentW] = useState(0);
  const [busyTie, setBusyTie] = useState<string | null>(null);
  const [savingPick, setSavingPick] = useState<string | null>(null);
  // Picks confirmed by the server but not yet reflected by the follow-up reload.
  const [localPicks, setLocalPicks] = useState<Record<string, PredictionPick>>({});

  const { data, refreshing, error, reload } = useFocusData<FinalsData>(
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

  useEffect(() => setLocalPicks({}), [data]);

  const season = data?.season ?? null;
  const bracket = data?.bracket ?? null;
  const players = data?.players ?? [];
  const picks: FinalsPicks = { picks: { ...(data?.picks.picks ?? {}), ...localPicks } };
  const scoreboard = data?.scoreboard ?? [];
  const playerById = new Map(players.map((player) => [player.id, player]));
  const nameOf = (uid: string | null) => (uid ? (playerById.get(uid)?.name ?? "A player") : "TBD");
  const viewerId = user?.uid ?? null;

  const slots = bracket ? bracketSlots(bracket) : [];
  const myOpenSlot = viewerId
    ? slots.find(
        (slot) => slot.status === "open" && (slot.homeId === viewerId || slot.awayId === viewerId),
      )
    : undefined;

  const grandFinal = bracket?.slots.gf;
  const championId =
    grandFinal?.status === "decided" && grandFinal.winnerId ? grandFinal.winnerId : null;

  function decideWithoutMatch(slot: FinalsSlot) {
    if (!season || !slot.homeId || !slot.awayId) return;
    const sides = [slot.homeId, slot.awayId];
    chooseAction({
      title: "Advance without a match?",
      message: `Pick who goes through from the ${slot.label} as a walkover. This can't be undone.`,
      options: [
        ...sides.map((winnerId) => ({
          label: `Advance ${firstName(nameOf(winnerId))}`,
          // Both winners are equally irreversible — neither gets the safe-looking style.
          style: "destructive" as const,
          onPress: () => {
            setBusyTie(slot.key);
            awardWalkover(season.id, slot.key, winnerId)
              .then(() => {
                toast.success(`${firstName(nameOf(winnerId))} advances from the ${slot.label}`);
                return reload();
              })
              .catch((err: unknown) =>
                showAlert("Walkover failed", err instanceof Error ? err.message : "Try again."),
              )
              .finally(() => setBusyTie(null));
          },
        })),
        { label: "Cancel", style: "cancel" as const },
      ],
    });
  }

  function choosePick(slot: FinalsSlot, predictedWinnerId: string) {
    if (!season || !user || slot.status !== "open" || savingPick) return;
    setSavingPick(`${slot.key}:${predictedWinnerId}`);
    saveFinalsPick(season.id, user.uid, slot, predictedWinnerId)
      .then(() => {
        setLocalPicks((prev) => ({ ...prev, [slot.key]: { predictedWinnerId } }));
        toast.success(`Backing ${firstName(nameOf(predictedWinnerId))} in the ${slot.label}`);
        return reload();
      })
      .catch(() => toast.error("Prediction not saved. Check the connection and try again."))
      .finally(() => setSavingPick(null));
  }

  const rounds: BracketRound[] = [];
  for (const slot of slots) {
    const copy = ROUND_COPY[slot.round];
    let round = rounds.find((entry) => entry.key === slot.round);
    if (!round) {
      round = { key: slot.round, label: copy.label, shortLabel: copy.short, ties: [] };
      rounds.push(round);
    }
    round.ties.push(
      slotToTie(slot, playerById, {
        footer:
          isAdmin && slot.status === "open" && slot.homeId && slot.awayId ? (
            <Button
              size="sm"
              variant="ghost"
              icon="arrowRight"
              full
              loading={busyTie === slot.key}
              onPress={() => decideWithoutMatch(slot)}
              accessibilityLabel={`Advance a player from the ${slot.label} without a match`}
            >
              Advance a player…
            </Button>
          ) : undefined,
        onOpenMatch: (matchId) =>
          router.push({ pathname: "/(app)/match/[id]", params: { id: matchId } } as Href),
      }),
    );
  }

  const railFits =
    isDesktop && contentW > 0 && contentW - RAIL_W - RAIL_GAP >= treeMinWidth(rounds.length);

  const predictions =
    bracket && user ? (
      <PredictionsPanel
        slots={slots}
        picks={picks}
        scoreboard={scoreboard}
        playerById={playerById}
        myUid={user.uid}
        savingKey={savingPick}
        onPick={choosePick}
        twoUp={isDesktop && !railFits}
      />
    ) : null;

  const subtitle =
    season && bracket ? `${season.name} · ${STRUCTURE_COPY[bracket.structure]}` : season?.name;

  return (
    <Page
      width="wide"
      refreshing={refreshing}
      onRefresh={reload}
      header={
        <ScreenHeader
          title="Finals"
          subtitle={subtitle}
          onRefresh={reload}
          refreshing={refreshing}
        />
      }
    >
      {error ? (
        <ErrorCard
          message="Couldn't load the finals bracket. Check the connection and retry."
          onRetry={reload}
          retrying={refreshing}
          style={{ marginBottom: spacing.lg }}
        />
      ) : null}

      {!data && !error ? (
        <View style={{ gap: spacing.xl }}>
          <SkeletonCard height={88} />
          <BracketSkeleton columns={3} />
        </View>
      ) : null}

      {data && !error && (!season || !bracket) ? (
        <EmptyState
          icon="trophy"
          title="Finals haven't started"
          body="When an admin locks the bracket at the end of the regular season, the top of the table — up to six players — play off for the championship here."
          action={
            isAdmin
              ? {
                  label: "Open admin",
                  icon: "settings",
                  onPress: () => router.push("/(app)/admin"),
                }
              : undefined
          }
        />
      ) : null}

      {bracket && season ? (
        <View style={{ gap: spacing.xl }}>
          {championId && grandFinal ? (
            <ChampionHero
              kicker={`CHAMPION · ${season.name.toUpperCase()}`}
              player={playerById.get(championId)}
              fallbackName="Champion"
              line={championLine(grandFinal, championId, bracket.premierId, nameOf)}
              stats={[
                {
                  label: "Finals won",
                  value: slots.filter((slot) => slot.winnerId === championId).length,
                },
                ...seedStat(bracket, championId),
              ]}
              seenKey={viewerId ? `finals:${season.id}:${championId}:${viewerId}` : null}
            />
          ) : null}

          {myOpenSlot ? (
            <Reveal>
              <Interactive
                onPress={() => router.push("/log-match")}
                accessibilityRole="link"
                style={styles.ctaCard}
                hoverStyle={{ backgroundColor: withAlpha(colors.accent, 0.14) }}
              >
                <View style={styles.ctaIcon}>
                  <Icon name="swords" size={20} color={colors.accent} />
                </View>
                <View style={{ flex: 1 }}>
                  <Txt variant="head" size={15}>
                    Your {myOpenSlot.label} is live
                  </Txt>
                  <Txt size={12} color={colors.textDim} style={{ marginTop: 2 }}>
                    Play with the dealt teams, then record the result.
                  </Txt>
                </View>
                <Icon name="chevron" size={16} color={colors.accent} />
              </Interactive>
            </Reveal>
          ) : null}

          <View
            onLayout={(e: LayoutChangeEvent) => setContentW(e.nativeEvent.layout.width)}
            style={railFits ? styles.withRail : { gap: spacing.xl }}
          >
            <View
              style={railFits ? { flex: 1, minWidth: 0, gap: spacing.xl } : { gap: spacing.xl }}
            >
              <PremierStrip bracket={bracket} playerById={playerById} viewerId={viewerId} />
              <View>
                {!isDesktop ? <SectionLabel>Bracket</SectionLabel> : null}
                {isDesktop ? (
                  <BracketTree
                    rounds={rounds}
                    viewerId={viewerId}
                    championId={championId}
                    roundMeta={roundMeta}
                  />
                ) : (
                  <BracketList
                    rounds={rounds}
                    viewerId={viewerId}
                    championId={championId}
                    roundMeta={roundMeta}
                  />
                )}
              </View>
            </View>
            {railFits && predictions ? (
              <View style={[{ width: RAIL_W }, sticky]}>{predictions}</View>
            ) : null}
          </View>

          {!railFits ? predictions : null}
        </View>
      ) : null}
    </Page>
  );
}

function slotToTie(
  slot: FinalsSlot,
  playerById: Map<string, LeaguePlayer>,
  extra: { footer?: ReactNode; onOpenMatch: (matchId: string) => void },
): BracketTie {
  const side = (which: "home" | "away"): BracketSide => {
    const home = which === "home";
    const id = home ? slot.homeId : slot.awayId;
    const from = home ? slot.homeFrom : slot.awayFrom;
    const team = home ? slot.homeTeamName : slot.awayTeamName;
    const overall = home ? slot.homeTeamOverall : slot.awayTeamOverall;
    return {
      id,
      player: id ? (playerById.get(id) ?? null) : null,
      placeholder: id
        ? "Former player"
        : from
          ? `Winner of ${SLOT_SHORT[from]}`
          : slot.status === "decided"
            ? "Bye"
            : "TBD",
      seed: home ? slot.homeSeed : slot.awaySeed,
      sub: team ? `${team}${overall != null ? ` · ${overall}` : ""}` : null,
    };
  };
  const feeders: BracketTie["feeders"] = [];
  if (slot.homeFrom) feeders.push({ id: slot.homeFrom, side: 0 });
  if (slot.awayFrom) feeders.push({ id: slot.awayFrom, side: 1 });
  const matchId = slot.matchId;
  return {
    id: slot.key,
    label: slot.label,
    status: slot.status,
    result: slot.decidedBy ? DECIDED_TAG[slot.decidedBy] : null,
    sides: [side("home"), side("away")],
    winnerId: slot.winnerId,
    final: slot.key === "gf",
    feeders,
    footer: extra.footer,
    onPress: slot.status === "decided" && matchId ? () => extra.onOpenMatch(matchId) : undefined,
  };
}

function roundMeta(round: BracketRound): string | null {
  const open = round.ties.filter((tie) => tie.status === "open").length;
  const decided = round.ties.filter((tie) => tie.status === "decided").length;
  if (open) return `${open} ready to play`;
  if (decided === round.ties.length) return "Complete";
  return "Waiting on earlier rounds";
}

function championLine(
  grandFinal: FinalsSlot,
  championId: string,
  premierId: string,
  nameOf: (uid: string | null) => string,
): string {
  const runnerUpId = grandFinal.homeId === championId ? grandFinal.awayId : grandFinal.homeId;
  const how = grandFinal.decidedBy ? DECIDED_LINE[grandFinal.decidedBy] : "";
  const base = `Beat ${firstName(nameOf(runnerUpId))} in the Grand Final${how}`;
  // Premier (top of the table) and champion (Grand Final) in one season is the Double.
  return championId === premierId ? `${base} — and topped the table. The Double.` : `${base}.`;
}

function seedStat(bracket: FinalsBracket, championId: string) {
  const seed = bracket.seeds.find((entry) => entry.uid === championId)?.rank;
  return seed != null ? [{ label: "From seed", value: seed, format: (n: number) => `#${n}` }] : [];
}

/** Premier (top of the table at the lock) plus the seeded field. */
function PremierStrip({
  bracket,
  playerById,
  viewerId,
}: {
  bracket: FinalsBracket;
  playerById: Map<string, LeaguePlayer>;
  viewerId: string | null;
}) {
  const { isTablet } = useBreakpoint();
  const premier = playerById.get(bracket.premierId) ?? null;
  return (
    <Reveal>
      <Card padded={false} style={[styles.strip, isTablet && styles.stripWide]}>
        <View style={[styles.premier, isTablet && styles.premierWide]}>
          <View style={styles.premierIcon}>
            <Icon name="crown" size={18} color={colors.accent} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Txt variant="head" size={10.5} color={colors.textDim} style={styles.eyebrow}>
              PREMIER
            </Txt>
            <Txt variant="head" size={15} numberOfLines={1} style={{ marginTop: 2 }}>
              {premier?.name ?? "Former player"}
            </Txt>
            <Txt size={11} color={colors.textFaint}>
              Top of the table at the finals lock
            </Txt>
          </View>
        </View>
        <View style={styles.seeds}>
          <Txt variant="head" size={10.5} color={colors.textDim} style={styles.eyebrow}>
            SEEDS
          </Txt>
          <View style={styles.seedRow}>
            {bracket.seeds.map((seed) => {
              const player = playerById.get(seed.uid) ?? null;
              const isViewer = seed.uid === viewerId;
              return (
                <View key={seed.uid} style={[styles.seedChip, isViewer && styles.seedChipYou]}>
                  <Txt variant="monoBold" size={11.5} color={colors.accent}>
                    {seed.rank}
                  </Txt>
                  <Avatar player={player} size={18} />
                  <Txt size={12.5} numberOfLines={1}>
                    {isViewer ? "You" : firstName(player?.name ?? "Player")}
                  </Txt>
                </View>
              );
            })}
          </View>
        </View>
      </Card>
    </Reveal>
  );
}

/** Slots with anything to predict (open ties) or already graded picks: open ties first. */
function predictableSlots(slots: FinalsSlot[]): FinalsSlot[] {
  return [
    ...slots.filter((slot) => slot.status === "open"),
    ...slots.filter((slot) => slot.status === "decided"),
  ];
}

function PredictionsPanel({
  slots,
  picks,
  scoreboard,
  playerById,
  myUid,
  savingKey,
  onPick,
  twoUp,
}: {
  slots: FinalsSlot[];
  picks: FinalsPicks;
  scoreboard: ScoreboardEntry[];
  playerById: Map<string, LeaguePlayer>;
  myUid: string;
  savingKey: string | null;
  onPick: (slot: FinalsSlot, predictedWinnerId: string) => void;
  /** Desktop without the rail: picks and the league table side by side. */
  twoUp: boolean;
}) {
  const rows = predictableSlots(slots);
  const top5 = scoreboard.slice(0, 5);
  const myIndex = scoreboard.findIndex((entry) => entry.predictorId === myUid);
  if (rows.length === 0 && top5.length === 0) return null;

  const pickList =
    rows.length > 0 ? (
      <View>
        <SectionLabel>Predictions</SectionLabel>
        {rows.some((slot) => slot.status === "open") ? (
          <Txt size={12} color={colors.textDim} style={styles.predictHint}>
            Back a winner in each open tie: {FAVOURITE_POINTS} pt for the favourite, {UPSET_POINTS}{" "}
            for calling an upset.
          </Txt>
        ) : null}
        <View style={{ gap: spacing.sm }}>
          {rows.map((slot, i) => (
            <Reveal key={slot.key} index={i}>
              <PickRow
                slot={slot}
                myUid={myUid}
                pick={picks.picks[slot.key]}
                playerById={playerById}
                savingKey={savingKey}
                onPick={onPick}
              />
            </Reveal>
          ))}
        </View>
      </View>
    ) : null;

  const league =
    top5.length > 0 ? (
      <View>
        <SectionLabel>Prediction league</SectionLabel>
        <Card padded={false}>
          {top5.map((entry, index) => {
            const isMe = entry.predictorId === myUid;
            return (
              <View
                key={entry.predictorId}
                style={[
                  styles.boardRow,
                  index > 0 && styles.boardRowDivider,
                  isMe && styles.boardRowMe,
                ]}
              >
                <Txt variant="monoBold" size={12} color={colors.textDim} style={styles.boardRank}>
                  {index + 1}
                </Txt>
                <Txt
                  variant="bodyMedium"
                  size={13}
                  style={{ flex: 1 }}
                  numberOfLines={1}
                  ellipsizeMode="tail"
                >
                  {isMe ? "You" : (playerById.get(entry.predictorId)?.name ?? "Former player")}
                </Txt>
                <Txt size={11} color={colors.textDim}>
                  {entry.correct} right
                </Txt>
                <Txt variant="monoBold" size={14} color={colors.accent}>
                  {entry.points} pts
                </Txt>
              </View>
            );
          })}
        </Card>
        {myIndex >= 5 ? (
          <Txt size={11.5} color={colors.textDim} style={{ marginTop: spacing.sm }}>
            You're {ordinal(myIndex + 1)} with {scoreboard[myIndex].points} pts.
          </Txt>
        ) : null}
      </View>
    ) : null;

  if (twoUp) {
    return (
      <View style={styles.twoUp}>
        <View style={{ flex: 1, minWidth: 0 }}>{pickList}</View>
        <View style={{ flex: 1, minWidth: 0 }}>{league}</View>
      </View>
    );
  }
  return (
    <View style={{ gap: spacing.xl }}>
      {pickList}
      {league}
    </View>
  );
}

function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

function PickRow({
  slot,
  myUid,
  pick,
  playerById,
  savingKey,
  onPick,
}: {
  slot: FinalsSlot;
  myUid: string;
  pick: PredictionPick | undefined;
  playerById: Map<string, LeaguePlayer>;
  savingKey: string | null;
  onPick: (slot: FinalsSlot, predictedWinnerId: string) => void;
}) {
  const outcome = pickOutcome(slot, pick);
  const open = slot.status === "open";
  const sides: Array<"home" | "away"> = ["home", "away"];
  return (
    <Card style={styles.pickCard}>
      <View style={styles.pickHeader}>
        <Txt variant="head" size={10.5} color={colors.textDim} style={styles.eyebrow}>
          {slot.label.toUpperCase()}
        </Txt>
        {outcome.decided && outcome.points > 0 ? (
          <Tag tone="accent">{`✓ +${outcome.points}`}</Tag>
        ) : outcome.decided ? (
          <Tag>MISSED</Tag>
        ) : open && !pick ? (
          <Tag tone="accent">PICK ONE</Tag>
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
            saving={savingKey}
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
  saving,
  playerById,
  onPick,
}: {
  slot: FinalsSlot;
  side: "home" | "away";
  myUid: string;
  pick: PredictionPick | undefined;
  selectable: boolean;
  saving: string | null;
  playerById: Map<string, LeaguePlayer>;
  onPick: (slot: FinalsSlot, predictedWinnerId: string) => void;
}) {
  const id = side === "home" ? slot.homeId : slot.awayId;
  const seed = side === "home" ? slot.homeSeed : slot.awaySeed;
  if (!id) return null;
  const player = playerById.get(id);
  const selected = pick?.predictedWinnerId === id;
  const isWinner = slot.status === "decided" && slot.winnerId === id;
  const busy = saving === `${slot.key}:${id}`;
  // Once decided the whole row is inert; while open only the unselected side needs a press.
  const pressable = selectable && !selected && saving === null;
  return (
    <Interactive
      onPress={() => onPick(slot, id)}
      disabled={!pressable}
      accessibilityLabel={`Predict ${player?.name ?? "this player"} to win the ${slot.label}`}
      accessibilityState={{ selected, disabled: !pressable, busy }}
      style={[
        styles.pickSide,
        selected && styles.pickSideSelected,
        isWinner && !selected && styles.pickSideWinnerMissed,
        // Disabled-looking only when it's genuinely closed, not while a sibling saves.
        !selectable && !selected && !isWinner && { opacity: 0.7 },
      ]}
      hoverStyle={{ borderColor: colors.lineStrong, backgroundColor: colors.surface2 }}
    >
      <Avatar player={player ?? null} size={26} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt variant="bodyMedium" size={12.5} numberOfLines={1} ellipsizeMode="tail">
          {id === myUid ? "You" : firstName(player?.name ?? "Player")}
        </Txt>
        {seed != null ? (
          <Txt size={10} color={colors.textDim}>
            seed {seed}
          </Txt>
        ) : null}
      </View>
      {busy ? (
        <ActivityIndicator size="small" color={colors.accent} />
      ) : isWinner ? (
        <Icon name="check" size={13} color={colors.win} />
      ) : selected ? (
        <Icon name="star" size={13} color={colors.accent} />
      ) : null}
    </Interactive>
  );
}

const styles = StyleSheet.create({
  eyebrow: { letterSpacing: 1.2 },
  withRail: { flexDirection: "row", alignItems: "flex-start", gap: RAIL_GAP },
  ctaCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: withAlpha(colors.accent, 0.45),
    borderRadius: radius.lg,
    backgroundColor: withAlpha(colors.accent, 0.08),
  },
  ctaIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: withAlpha(colors.accent, 0.12),
  },
  strip: { overflow: "hidden" },
  stripWide: { flexDirection: "row" },
  premier: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
    backgroundColor: withAlpha(colors.accent, 0.05),
  },
  premierWide: {
    width: 280,
    borderBottomWidth: 0,
    borderRightWidth: 1,
    borderRightColor: colors.line,
  },
  premierIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: withAlpha(colors.accent, 0.35),
  },
  seeds: { flex: 1, padding: spacing.lg, gap: spacing.sm },
  seedRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  seedChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingLeft: spacing.sm + 2,
    paddingRight: spacing.md,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.pill,
    backgroundColor: colors.surface2,
  },
  seedChipYou: { borderColor: withAlpha(colors.accent, 0.6) },
  predictHint: { marginTop: -4, marginBottom: spacing.md, lineHeight: 17 },
  twoUp: { flexDirection: "row", alignItems: "flex-start", gap: spacing.x2 },
  pickCard: { padding: spacing.md },
  pickHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.sm,
  },
  pickSide: {
    flex: 1,
    minWidth: 0,
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
  pickSideWinnerMissed: { opacity: 0.6 },
  boardRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.sm + 3,
    paddingHorizontal: spacing.lg,
  },
  boardRowDivider: { borderTopWidth: 1, borderTopColor: colors.line },
  boardRowMe: { backgroundColor: withAlpha(colors.accent, 0.06) },
  boardRank: { width: 16 },
});
