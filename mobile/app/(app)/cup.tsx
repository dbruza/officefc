/**
 * Mid-season knockout cup: the drawn bracket, the viewer's run, and the winner once the
 * final is decided. Desktop draws the bracket as a tree (scrolling sideways when a big
 * draw outgrows the window); phones page through rounds. Admins can push a stuck tie
 * through without a match.
 */
import { useCallback, useState, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import {
  CountUp,
  EmptyState,
  ErrorCard,
  Grid,
  Icon,
  Interactive,
  Page,
  Reveal,
  ScreenHeader,
  SectionLabel,
  SkeletonCard,
  Txt,
  Button,
  type IconName,
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
  forceAdvanceCup,
  getActiveSeason,
  getCup,
  getLeaguePlayers,
  type CupState,
  type CupTie,
  type LeaguePlayer,
  type Season,
} from "@/lib/league";
import { useFocusData } from "@/lib/useFocusData";
import { chooseAction, showAlert } from "@/lib/dialogs";
import { toast } from "@/lib/toast";
import { useBreakpoint } from "@/lib/responsive";
import { colors, radius, spacing } from "@/theme";
import { withAlpha } from "@/lib/color";
import { firstName } from "@/lib/format";
import {
  cupRoundLabel,
  cupRoundShort,
  cupShape,
  cupTieLabel,
  type CupSource,
} from "@/screens/brackets/cupBracket";

interface CupData {
  season: Season | null;
  cup: CupState | null;
  players: LeaguePlayer[];
}

const tieId = (round: number, tie: number) => `r${round}t${tie}`;

export default function CupScreen() {
  const router = useRouter();
  const { user, membership } = useAuth();
  const isAdmin = membership?.role === "admin";
  const { isDesktop } = useBreakpoint();
  const [busyTie, setBusyTie] = useState<string | null>(null);

  const { data, refreshing, error, reload } = useFocusData<CupData>(
    "cup-bracket",
    useCallback(async () => {
      const season = await getActiveSeason();
      const [cup, players] = await Promise.all([
        season ? getCup(season.id) : Promise.resolve(null),
        getLeaguePlayers(),
      ]);
      return { season, cup, players };
    }, []),
  );

  const season = data?.season ?? null;
  const cup = data?.cup ?? null;
  const players = data?.players ?? [];
  const playerById = new Map(players.map((player) => [player.id, player]));
  const nameOf = (uid: string | null) => (uid ? (playerById.get(uid)?.name ?? "A player") : "TBD");
  const viewerId = user?.uid ?? null;

  const myOpenTie =
    cup && viewerId
      ? cup.rounds
          .flatMap((round) => round)
          .find(
            (tie) =>
              tie.winnerId === null &&
              (tie.aId === viewerId || tie.bId === viewerId) &&
              tie.aId !== null &&
              tie.bId !== null,
          )
      : null;

  // The bracket itself is the source of truth: the final's winnerId decides the banner.
  const championId = cup ? championOf(cup) : null;

  function decideWithoutMatch(roundIndex: number, tieIndex: number, tie: CupTie, label: string) {
    if (!season) return;
    const sides = [tie.aId, tie.bId].filter((id): id is string => id !== null);
    chooseAction({
      title: "Advance without a match?",
      message: `Pick who goes through from ${label}. This can't be undone.`,
      options: [
        ...sides.map((winnerId) => ({
          label: `Advance ${firstName(nameOf(winnerId))}`,
          // Both winners are equally irreversible — neither gets the safe-looking style.
          style: "destructive" as const,
          onPress: () => {
            const key = tieId(roundIndex, tieIndex);
            setBusyTie(key);
            forceAdvanceCup(season.id, roundIndex, tieIndex, winnerId)
              .then(() => {
                toast.success(`${firstName(nameOf(winnerId))} advances from ${label}`);
                return reload();
              })
              .catch((err: unknown) =>
                showAlert("Couldn't advance", err instanceof Error ? err.message : "Try again."),
              )
              .finally(() => setBusyTie(null));
          },
        })),
        { label: "Cancel", style: "cancel" as const },
      ],
    });
  }

  const shape = cup ? cupShape(cup.rounds) : null;
  const total = cup?.rounds.length ?? 0;

  const sourceName = (source: CupSource): string | null =>
    source.kind === "tie" && cup ? cupTieLabel(source.round, source.tie, cup.rounds) : null;

  const rounds: BracketRound[] =
    cup && shape
      ? cup.rounds.map((round, r) => ({
          key: `r${r}`,
          label: cupRoundLabel(r, total),
          shortLabel: cupRoundShort(r, total),
          ties: round.map((tie, t): BracketTie => {
            const label = cupTieLabel(r, t, cup.rounds);
            const sources = shape.sources[r]?.[t] ?? [{ kind: "draw" }, { kind: "draw" }];
            const decided = tie.winnerId !== null;
            const playable = !decided && tie.aId !== null && tie.bId !== null;
            const side = (id: string | null, source: CupSource): BracketSide => {
              const from = sourceName(source);
              return {
                id,
                player: id ? (playerById.get(id) ?? null) : null,
                // A decided tie with an empty side was pushed through by an admin.
                placeholder: id
                  ? "Former player"
                  : decided
                    ? "Bye"
                    : from
                      ? `Winner of ${from}`
                      : "TBD",
              };
            };
            const feeders: BracketTie["feeders"] = [];
            sources.forEach((source, s) => {
              if (source.kind === "tie") {
                feeders.push({ id: tieId(source.round, source.tie), side: s as 0 | 1 });
              }
            });
            return {
              id: tieId(r, t),
              label,
              status: decided ? "decided" : playable ? "open" : "pending",
              result: decided ? "DECIDED" : null,
              sides: [side(tie.aId, sources[0]), side(tie.bId, sources[1])],
              winnerId: tie.winnerId,
              final: r === total - 1,
              feeders,
              footer:
                isAdmin && playable ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    icon="arrowRight"
                    full
                    loading={busyTie === tieId(r, t)}
                    onPress={() => decideWithoutMatch(r, t, tie, label)}
                    accessibilityLabel={`Advance a player from ${label} without a match`}
                  >
                    Advance a player…
                  </Button>
                ) : undefined,
            };
          }),
        }))
      : [];

  const championTie = cup?.rounds[total - 1]?.[0];
  const runnerUpId =
    championId && championTie
      ? championTie.aId === championId
        ? championTie.bId
        : championTie.aId
      : null;

  return (
    <Page
      width="wide"
      refreshing={refreshing}
      onRefresh={reload}
      header={
        <ScreenHeader
          title="Cup"
          subtitle={
            season && cup
              ? `${season.name} · ${championId ? "Complete" : "Knockout in progress"}`
              : season?.name
          }
          onRefresh={reload}
          refreshing={refreshing}
        />
      }
    >
      {error ? (
        <ErrorCard
          message="Couldn't load the cup bracket. Check the connection and retry."
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

      {data && !error && (!season || !cup) ? (
        <EmptyState
          icon="trophy"
          title="No cup running"
          body="An admin can start a mid-season knockout alongside the league table. Everyone enters the random draw; win your tie or you're out."
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

      {cup && season && shape ? (
        <View style={{ gap: spacing.xl }}>
          {championId ? (
            <ChampionHero
              kicker={`CUP WINNER · ${season.name.toUpperCase()}`}
              player={playerById.get(championId)}
              fallbackName="Cup winner"
              line={
                runnerUpId
                  ? `Beat ${firstName(nameOf(runnerUpId))} in the final to lift the cup.`
                  : "Lifted the cup."
              }
              stats={[
                {
                  label: "Ties won",
                  value: cup.rounds.flat().filter((tie) => tie.winnerId === championId).length,
                },
                { label: "Entrants", value: shape.entrants },
              ]}
              seenKey={viewerId ? `cup:${season.id}:${championId}:${viewerId}` : null}
            />
          ) : null}

          {myOpenTie && !championId ? (
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
                    Your cup tie is live
                  </Txt>
                  <Txt size={12} color={colors.textDim} style={{ marginTop: 2 }}>
                    Log it as a normal match — the bracket advances once it&apos;s confirmed.
                  </Txt>
                </View>
                <Icon name="chevron" size={16} color={colors.accent} />
              </Interactive>
            </Reveal>
          ) : null}

          {/* Once there's a winner the champion hero tells this story instead. */}
          {!championId ? (
            <CupSummary cup={cup} entrants={shape.entrants} viewerId={viewerId} />
          ) : null}

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

          <Txt size={11.5} color={colors.textDim} style={styles.faqLine}>
            Any confirmed match between a paired pair advances their tie — including one logged as a
            league game. Cup results also count toward the table and ELO.
          </Txt>
        </View>
      ) : null}
    </Page>
  );
}

/** The final's winner once decided; null while any earlier round is still in play. */
function championOf(cup: CupState): string | null {
  const final = cup.rounds[cup.rounds.length - 1];
  return final?.length === 1 ? final[0].winnerId : null;
}

function roundMeta(round: BracketRound): string | null {
  const open = round.ties.filter((tie) => tie.status === "open").length;
  const decided = round.ties.filter((tie) => tie.status === "decided").length;
  if (decided === round.ties.length) return "Complete";
  if (open) return `${open} of ${round.ties.length} ready to play`;
  return "Waiting on earlier rounds";
}

/** Where the viewer stands while the cup is live: still alive (and where), out, or not drawn. */
function viewerRun(
  cup: CupState,
  viewerId: string | null,
): { value: string; caption: string; icon: IconName; tone: string } {
  const total = cup.rounds.length;
  if (!viewerId) {
    return { value: "—", caption: "Sign in to follow", icon: "users", tone: colors.text };
  }
  // The viewer's latest tie: winners are copied forward immediately, so this is where
  // their run currently stands.
  let found: { round: number; tie: CupTie } | null = null;
  for (let r = 0; r < total; r++) {
    for (const tie of cup.rounds[r]) {
      if (tie.aId === viewerId || tie.bId === viewerId) found = { round: r, tie };
    }
  }
  if (!found) {
    return {
      value: "Not drawn",
      caption: "You're not in this cup",
      icon: "users",
      tone: colors.textDim,
    };
  }
  const label = cupRoundLabel(found.round, total);
  if (found.tie.winnerId && found.tie.winnerId !== viewerId) {
    return { value: "Knocked out", caption: `Out in the ${label}`, icon: "x", tone: colors.loss };
  }
  if (found.tie.aId && found.tie.bId) {
    return {
      value: "Still in",
      caption: `${label} · to play`,
      icon: "swords",
      tone: colors.accent,
    };
  }
  return {
    value: "Still in",
    caption: `Through to the ${label}`,
    icon: "check",
    tone: colors.accent,
  };
}

function CupSummary({
  cup,
  entrants,
  viewerId,
}: {
  cup: CupState;
  entrants: number;
  viewerId: string | null;
}) {
  // Phones keep the three facts on one compact row rather than three stacked cards.
  const { isPhone } = useBreakpoint();
  const total = cup.rounds.length;
  const liveRound = cup.rounds.findIndex((round) => round.some((tie) => tie.winnerId === null));
  const run = viewerRun(cup, viewerId);
  const tiesLeft = cup.rounds.flat().filter((tie) => tie.winnerId === null).length;
  const valueSize = isPhone ? 15 : 18;
  const roundName =
    liveRound >= 0 ? (isPhone ? cupRoundShort : cupRoundLabel)(liveRound, total) : "Complete";
  return (
    <Grid min={isPhone ? 96 : 200} maxColumns={3} gap={isPhone ? spacing.sm : spacing.md}>
      <SummaryTile icon="users" label="Entrants" compact={isPhone}>
        <CountUp value={entrants} from={0} variant="monoBold" size={isPhone ? 18 : 24} />
        <Txt size={11.5} color={colors.textDim} numberOfLines={1}>
          {total} {total === 1 ? "round" : "rounds"}
        </Txt>
      </SummaryTile>
      <SummaryTile icon="calendar" label={isPhone ? "Now" : "Now playing"} compact={isPhone}>
        <Txt variant="head" size={valueSize} numberOfLines={1}>
          {roundName}
        </Txt>
        <Txt size={11.5} color={colors.textDim} numberOfLines={1}>
          {tiesLeft ? `${tiesLeft} ${tiesLeft === 1 ? "tie" : "ties"} left` : "All decided"}
        </Txt>
      </SummaryTile>
      <SummaryTile icon={run.icon} label="Your run" tone={run.tone} compact={isPhone}>
        <Txt variant="head" size={valueSize} color={run.tone} numberOfLines={1}>
          {run.value}
        </Txt>
        <Txt size={11.5} color={colors.textDim} numberOfLines={isPhone ? 2 : 1}>
          {run.caption}
        </Txt>
      </SummaryTile>
    </Grid>
  );
}

function SummaryTile({
  icon,
  label,
  tone = colors.textDim,
  compact,
  children,
}: {
  icon: IconName;
  label: string;
  tone?: string;
  compact: boolean;
  children: ReactNode;
}) {
  return (
    <Reveal style={[styles.tile, compact && styles.tileCompact]}>
      <View style={styles.tileHead}>
        {!compact ? <Icon name={icon} size={14} color={tone} /> : null}
        <Txt variant="head" size={10} color={colors.textDim} style={{ letterSpacing: 1.2 }}>
          {label.toUpperCase()}
        </Txt>
      </View>
      <View style={{ gap: 2 }}>{children}</View>
    </Reveal>
  );
}

const styles = StyleSheet.create({
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
  tile: {
    gap: spacing.sm,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
  },
  tileCompact: { gap: 6, padding: spacing.md },
  tileHead: { flexDirection: "row", alignItems: "center", gap: 6 },
  faqLine: { textAlign: "center", lineHeight: 17, maxWidth: 560, alignSelf: "center" },
});
