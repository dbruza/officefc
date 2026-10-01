/**
 * League analytics — team meta-analytics over the active season's confirmed matches.
 * Answers the questions the per-player screens can't: which teams everyone picks,
 * whether raw team strength still buys results (banded win rates), and whether the
 * auto-matchup engine is doing its job of flattening OVR advantage. Finals ties are
 * excluded everywhere — they decide the bracket, not the league.
 *
 * Desktop splits into two columns (team usage | strength + fairness + big results);
 * every rate is drawn as a bar that grows in once the data lands.
 */
import { useCallback, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { type Href, useRouter } from "expo-router";
import {
  Card,
  Columns,
  CountUp,
  EmptyState,
  ErrorCard,
  Grid,
  Interactive,
  Page,
  Reveal,
  ScreenHeader,
  SectionLabel,
  SkeletonCard,
  SkeletonRows,
  Txt,
} from "@/components";
import { GrowBar } from "@/components/GrowBar";
import {
  getActiveSeason,
  getLeaguePlayers,
  getTeams,
  type LeaguePlayer,
  type Season,
  type Team,
} from "@/lib/league";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { asNullableDate } from "@/lib/league/firestoreMap";
import {
  biggestResults,
  fairnessBySource,
  isRegularMatch,
  mostPickedTeams,
  winRateByBand,
  type BigResult,
  type FairnessBySource,
  type MetaMatch,
  type OvrBandStats,
  type TeamUsage,
} from "@/lib/stats/teamMeta";
import { useFocusData } from "@/lib/useFocusData";
import { colors, radius, spacing } from "@/theme";
import { withAlpha } from "@/lib/color";
import { firstName } from "@/lib/format";

interface AnalyticsData {
  season: Season | null;
  matches: MetaMatch[];
  teamsById: Map<string, Team>;
  players: Map<string, LeaguePlayer>;
}

/** Raw match-doc read for analytics: the client mapper collapses `source` to
 *  manual/ai_assisted and drops the finals flag, both load-bearing here. */
async function getRawSeasonMatches(seasonId: string): Promise<MetaMatch[]> {
  const snap = await getDocs(
    query(
      collection(db, "matches"),
      where("seasonId", "==", seasonId),
      where("status", "==", "confirmed"),
    ),
  );
  return snap.docs
    .map((matchDoc) => {
      const data = matchDoc.data();
      return {
        id: matchDoc.id,
        aId: String(data.aId),
        bId: String(data.bId),
        aTeamId: String(data.aTeamId),
        bTeamId: String(data.bTeamId),
        aTeam: String(data.aTeam ?? ""),
        bTeam: String(data.bTeam ?? ""),
        aGoals: Number(data.aGoals),
        bGoals: Number(data.bGoals),
        source: typeof data.source === "string" ? data.source : null,
        finals: data.finals === true,
        date: asNullableDate(data.date),
      };
    })
    .sort((a, b) => (a.date?.getTime() ?? 0) - (b.date?.getTime() ?? 0));
}

export default function AnalyticsRoute() {
  const router = useRouter();
  const { data, refreshing, error, reload } = useFocusData<AnalyticsData>(
    "analytics",
    useCallback(async () => {
      const season = await getActiveSeason();
      const [rawMatches, catalogue, roster] = await Promise.all([
        season ? getRawSeasonMatches(season.id) : Promise.resolve([] as MetaMatch[]),
        getTeams(),
        getLeaguePlayers(),
      ]);
      return {
        season,
        matches: rawMatches,
        teamsById: new Map(catalogue.map((team) => [team.id, team])),
        players: new Map(roster.map((player) => [player.id, player])),
      };
    }, []),
  );

  const season = data?.season ?? null;
  const matches = data?.matches ?? [];
  const teamsById = data?.teamsById ?? new Map<string, Team>();
  const players = data?.players ?? new Map<string, LeaguePlayer>();

  const regular = matches.filter(isRegularMatch);
  const usage = mostPickedTeams(matches, teamsById);
  const bands = winRateByBand(matches, teamsById);
  const fairness = fairnessBySource(matches, teamsById);
  const bigResults = biggestResults(matches);
  const goals = regular.reduce((sum, match) => sum + match.aGoals + match.bGoals, 0);
  // Tenths so the count-up can tween a one-decimal average as an integer.
  const goalsPerGameTenths = regular.length ? Math.round((goals / regular.length) * 10) : 0;

  const openMatch = (matchId: string) =>
    router.push({ pathname: "/(app)/match/[id]", params: { id: matchId } } as Href);

  return (
    <Page
      refreshing={refreshing}
      onRefresh={reload}
      header={
        <ScreenHeader
          title="Analytics"
          subtitle={season?.name ?? undefined}
          onRefresh={reload}
          refreshing={refreshing}
        />
      }
    >
      {error ? (
        <ErrorCard
          message="Couldn't load league analytics. Check the connection and retry."
          onRetry={reload}
          retrying={refreshing}
          style={{ marginBottom: spacing.lg }}
        />
      ) : null}

      {!data && !error ? (
        <View style={{ gap: spacing.lg }}>
          <Grid min={180} maxColumns={3}>
            <SkeletonCard height={96} />
            <SkeletonCard height={96} />
            <SkeletonCard height={96} />
          </Grid>
          <Columns ratio={[1, 1]}>
            <SkeletonRows count={6} height={54} />
            <View style={{ gap: spacing.md }}>
              <SkeletonCard height={180} />
              <SkeletonCard height={180} />
            </View>
          </Columns>
        </View>
      ) : null}

      {data && !error && !season ? (
        <EmptyState
          icon="grid"
          title="No active season"
          body="Analytics cover the active season. They'll appear once an admin starts one."
        />
      ) : null}

      {data && season && regular.length === 0 && !error ? (
        <EmptyState
          icon="grid"
          title="Nothing to analyse yet"
          body="Team picks, win rates by strength and fixture fairness fill in as confirmed league matches land this season."
          action={{ label: "Log a match", icon: "plus", onPress: () => router.push("/log-match") }}
        />
      ) : null}

      {data && season && regular.length > 0 ? (
        <View style={{ gap: spacing.x2 }}>
          <Grid min={180} maxColumns={3}>
            <KpiTile label="Matches analysed" index={0}>
              <CountUp value={regular.length} from={0} variant="monoBold" size={30} />
            </KpiTile>
            <KpiTile label="Teams used" index={1}>
              <CountUp value={usage.length} from={0} variant="monoBold" size={30} />
            </KpiTile>
            <KpiTile label="Goals per game" index={2}>
              <CountUp
                value={goalsPerGameTenths}
                from={0}
                variant="monoBold"
                size={30}
                format={(n) => (n / 10).toFixed(1)}
              />
            </KpiTile>
          </Grid>

          <Columns ratio={[1, 1]}>
            <UsageSection usage={usage} />
            <View style={{ gap: spacing.x2 }}>
              <BandSection bands={bands} />
              <FairnessSection fairness={fairness} />
              <BigResultsSection results={bigResults} players={players} onOpen={openMatch} />
            </View>
          </Columns>
        </View>
      ) : null}
    </Page>
  );
}

// --- Sections ------------------------------------------------------------------------

function KpiTile({
  label,
  index,
  children,
}: {
  label: string;
  index: number;
  children: ReactNode;
}) {
  return (
    <Reveal index={index} style={styles.kpi}>
      <Txt variant="head" size={10.5} color={colors.textDim} style={styles.eyebrow}>
        {label.toUpperCase()}
      </Txt>
      {children}
    </Reveal>
  );
}

function UsageSection({ usage }: { usage: TeamUsage[] }) {
  const rows = usage.slice(0, 10);
  const top = rows[0]?.picks ?? 1;
  return (
    <Reveal>
      <SectionLabel>Most-picked teams</SectionLabel>
      <Card padded={false}>
        {rows.map((row, index) => (
          <View key={row.teamKey} style={[styles.usageRow, index > 0 && styles.divider]}>
            <Txt variant="monoBold" size={12} color={colors.textFaint} style={styles.rank}>
              {index + 1}
            </Txt>
            <View style={{ flex: 1, minWidth: 0, gap: 5 }}>
              <View style={styles.usageHead}>
                <Txt variant="bodyMedium" size={13.5} numberOfLines={1} style={{ flexShrink: 1 }}>
                  {row.name}
                </Txt>
                {row.overall !== null ? (
                  <Txt variant="mono" size={11} color={colors.textFaint}>
                    {row.overall}
                  </Txt>
                ) : null}
              </View>
              <GrowBar
                value={row.picks / top}
                height={5}
                delay={120 + Math.min(index, 8) * 50}
                color={withAlpha(colors.accent, 0.55)}
              />
              <Txt size={11} color={colors.textDim}>
                {row.picks} {row.picks === 1 ? "pick" : "picks"} · {row.wins}W {row.draws}D{" "}
                {row.losses}L
              </Txt>
            </View>
            <View style={styles.rateCol}>
              <Txt variant="monoBold" size={16} color={rateColor(row.winRate)}>
                {row.winRate}%
              </Txt>
              <Txt size={10} color={colors.textFaint}>
                win rate
              </Txt>
            </View>
          </View>
        ))}
      </Card>
    </Reveal>
  );
}

function BandSection({ bands }: { bands: OvrBandStats[] }) {
  return (
    <Reveal index={1}>
      <SectionLabel>Win rate by team strength</SectionLabel>
      <Card style={{ gap: spacing.md }}>
        <Txt size={12} color={colors.textDim} style={{ lineHeight: 17 }}>
          If the matchup engine works, stronger sides shouldn&apos;t systematically win more.
        </Txt>
        {bands.map((band, i) => (
          <View key={band.key} style={styles.meterRow}>
            <Txt variant="monoBold" size={12} color={colors.textDim} style={styles.meterLabel}>
              {band.label}
            </Txt>
            <GrowBar
              value={band.picks ? band.winRate / 100 : 0}
              height={10}
              delay={160 + i * 70}
              color={rateColor(band.winRate)}
              style={{ flex: 1 }}
            />
            <View style={styles.meterValue}>
              <Txt variant="monoBold" size={13} color={band.picks ? colors.text : colors.textFaint}>
                {band.picks ? `${band.winRate}%` : "—"}
              </Txt>
              <Txt size={10} color={colors.textFaint}>
                {band.picks} {band.picks === 1 ? "pick" : "picks"}
              </Txt>
            </View>
          </View>
        ))}
      </Card>
    </Reveal>
  );
}

function FairnessSection({ fairness }: { fairness: FairnessBySource }) {
  return (
    <Reveal index={2}>
      <SectionLabel>Fixture-engine fairness</SectionLabel>
      <View style={{ gap: spacing.sm }}>
        <FairnessCard title="Dealt fixtures" stats={fairness.fixture} accent />
        <FairnessCard title="Hand-picked (manual + photo)" stats={fairness.manual} />
      </View>
    </Reveal>
  );
}

function FairnessCard({
  title,
  stats,
  accent = false,
}: {
  title: string;
  stats: FairnessBySource["fixture"];
  accent?: boolean;
}) {
  return (
    <Card style={[{ gap: spacing.md }, accent && { borderColor: withAlpha(colors.accent, 0.35) }]}>
      <View style={styles.fairHead}>
        <Txt
          variant="head"
          size={11}
          color={accent ? colors.accent : colors.textDim}
          style={styles.eyebrow}
        >
          {title.toUpperCase()}
        </Txt>
        <Txt size={10.5} color={colors.textFaint}>
          {stats.ratedGames} rated · avg gap {stats.avgOvrGap}
        </Txt>
      </View>
      {stats.ratedGames === 0 ? (
        <Txt size={12} color={colors.textDim}>
          No games with both team ratings known yet.
        </Txt>
      ) : (
        <>
          <FairnessMeter
            label="Stronger side won"
            rate={stats.higherOvrWinRate}
            detail={`${stats.higherOvrWins}/${stats.decisiveRated} decisive`}
            color={colors.textDim}
            delay={200}
          />
          <FairnessMeter
            label="Upsets"
            rate={stats.upsetRate}
            detail={`${stats.upsets} upsets · ${stats.draws} drawn`}
            color={colors.gold}
            delay={280}
          />
        </>
      )}
    </Card>
  );
}

function FairnessMeter({
  label,
  rate,
  detail,
  color,
  delay,
}: {
  label: string;
  rate: number;
  detail: string;
  color: string;
  delay: number;
}) {
  return (
    <View style={{ gap: 6 }}>
      <View style={styles.fairLine}>
        <Txt size={12.5}>{label}</Txt>
        <Txt size={11} color={colors.textFaint} style={{ flex: 1 }} numberOfLines={1}>
          {detail}
        </Txt>
        <Txt variant="monoBold" size={14}>
          {rate}%
        </Txt>
      </View>
      <GrowBar value={rate / 100} height={8} delay={delay} color={color} />
    </View>
  );
}

function BigResultsSection({
  results,
  players,
  onOpen,
}: {
  results: BigResult[];
  players: Map<string, LeaguePlayer>;
  onOpen: (matchId: string) => void;
}) {
  if (!results.length) return null;
  return (
    <Reveal index={3}>
      <SectionLabel>Biggest results</SectionLabel>
      <Card padded={false}>
        {results.map((result, index) => {
          // Scorers-of-record are just the two players on the sheet.
          const names = [players.get(result.aId)?.name, players.get(result.bId)?.name].map((name) =>
            firstName(name ?? "Former player"),
          );
          return (
            <Interactive
              key={result.matchId}
              onPress={() => onOpen(result.matchId)}
              accessibilityRole="link"
              style={[styles.resultRow, index > 0 && styles.divider]}
              hoverStyle={{ backgroundColor: colors.surface2 }}
              pressScale={1}
            >
              <View style={{ flex: 1, minWidth: 0 }}>
                <Txt variant="bodyMedium" size={13} numberOfLines={1}>
                  {result.aTeamName}{" "}
                  <Txt variant="monoBold" size={13}>
                    {result.aGoals}–{result.bGoals}
                  </Txt>{" "}
                  {result.bTeamName}
                </Txt>
                <Txt size={11} color={colors.textDim} numberOfLines={1}>
                  {names.join(" vs ")}
                  {result.date
                    ? ` · ${result.date.toLocaleDateString("en-GB", {
                        day: "numeric",
                        month: "short",
                      })}`
                    : ""}
                </Txt>
              </View>
              <View style={styles.marginChip}>
                <Txt variant="monoBold" size={12} color={colors.onAccent}>
                  +{result.margin}
                </Txt>
              </View>
            </Interactive>
          );
        })}
      </Card>
    </Reveal>
  );
}

/** Green when a rate leans winning, red when it leans losing, neutral in between. */
function rateColor(rate: number): string {
  if (rate >= 50) return colors.win;
  if (rate <= 25) return colors.loss;
  return colors.textDim;
}

const styles = StyleSheet.create({
  eyebrow: { letterSpacing: 1.2 },
  kpi: {
    gap: spacing.xs,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
  },
  divider: { borderTopWidth: 1, borderTopColor: colors.line },
  usageRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  usageHead: { flexDirection: "row", alignItems: "baseline", gap: 6 },
  rank: { width: 18, textAlign: "right" },
  rateCol: { alignItems: "flex-end", minWidth: 52 },
  meterRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  meterLabel: { width: 46 },
  meterValue: { width: 56, alignItems: "flex-end" },
  fairHead: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  fairLine: { flexDirection: "row", alignItems: "baseline", gap: spacing.sm },
  resultRow: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  marginChip: {
    minWidth: 34,
    height: 26,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
  },
});
