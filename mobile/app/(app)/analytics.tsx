/**
 * League analytics — team meta-analytics over the active season's confirmed matches.
 * Answers the questions the per-player screens can't: which teams everyone picks,
 * whether raw team strength still buys results (banded win rates), and whether the
 * auto-matchup engine is doing its job of flattening OVR advantage. Finals ties are
 * excluded everywhere — they decide the bracket, not the league.
 */
import { useCallback } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button, Card, ScreenHeader, SectionLabel, StatCard, Txt } from "@/components";
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
  const { data, loading, error, reload } = useFocusData<AnalyticsData>(
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

  const usage = mostPickedTeams(matches, teamsById);
  const bands = winRateByBand(matches, teamsById);
  const fairness = fairnessBySource(matches, teamsById);
  const bigResults = biggestResults(matches);

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <ScreenHeader title="Analytics" subtitle={season?.name ?? undefined} />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {loading ? <ActivityIndicator color={colors.accent} /> : null}
        {error ? (
          <Card style={{ borderColor: withAlpha(colors.loss, 0.35), marginBottom: spacing.lg }}>
            <Txt color={colors.loss} size={13}>
              Couldn't load league analytics. Check the connection and retry.
            </Txt>
            <Button variant="dark" size="sm" style={{ marginTop: spacing.md }} onPress={reload}>
              Retry
            </Button>
          </Card>
        ) : null}

        {!error && !loading && !season ? (
          <Card style={{ alignItems: "center", paddingVertical: spacing.x2 }}>
            <Txt color={colors.textDim}>No active season to analyse yet.</Txt>
          </Card>
        ) : null}

        {!error && season ? (
          <>
            <UsageSection usage={usage} totalGames={matches.length} />
            <BandSection bands={bands} />
            <FairnessSection fairness={fairness} />
            <BigResultsSection results={bigResults} players={players} />
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

// --- Sections ------------------------------------------------------------------------

function UsageSection({ usage, totalGames }: { usage: TeamUsage[]; totalGames: number }) {
  if (!totalGames) return null;
  return (
    <View style={{ marginBottom: spacing.xl }}>
      <SectionLabel>Most-picked teams</SectionLabel>
      <View style={{ gap: spacing.sm }}>
        {usage.slice(0, 8).map((row, index) => (
          <Card key={row.teamKey} style={styles.row}>
            <Txt variant="monoBold" size={12} color={colors.textFaint} style={styles.rank}>
              {index + 1}
            </Txt>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Txt variant="bodyMedium" size={13} numberOfLines={1}>
                {row.name}
                {row.overall !== null ? ` · ${row.overall}` : ""}
              </Txt>
              <Txt size={10.5} color={colors.textDim}>
                {row.picks} {row.picks === 1 ? "pick" : "picks"} · {row.wins}W {row.draws}D{" "}
                {row.losses}L
              </Txt>
            </View>
            <Txt variant="monoBold" size={16} color={rateColor(row.winRate)}>
              {row.winRate}%
            </Txt>
          </Card>
        ))}
      </View>
    </View>
  );
}

function BandSection({ bands }: { bands: OvrBandStats[] }) {
  return (
    <View style={{ marginBottom: spacing.xl }}>
      <SectionLabel>Win rate by team strength</SectionLabel>
      <Card>
        <Txt size={11.5} color={colors.textDim} style={{ marginBottom: spacing.md }}>
          If the matchup engine works, stronger sides shouldn&apos;t systematically win more.
        </Txt>
        <View style={{ flexDirection: "row", gap: spacing.sm }}>
          {bands.map((band) => (
            <View key={band.key} style={{ flex: 1 }}>
              <StatCard label={band.label} value={`${band.winRate}%`} sub={`${band.picks} picks`} />
            </View>
          ))}
        </View>
      </Card>
    </View>
  );
}

function FairnessSection({ fairness }: { fairness: FairnessBySource }) {
  return (
    <View style={{ marginBottom: spacing.xl }}>
      <SectionLabel>Fixture-engine fairness</SectionLabel>
      <View style={{ gap: spacing.sm }}>
        <FairnessCard title="Dealt fixtures" stats={fairness.fixture} accent />
        <FairnessCard title="Hand-picked (manual + photo)" stats={fairness.manual} />
      </View>
    </View>
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
    <Card style={accent ? { borderColor: withAlpha(colors.accent, 0.35) } : undefined}>
      <View style={styles.fairHead}>
        <Txt variant="head" size={11} color={accent ? colors.accent : colors.textDim}>
          {title.toUpperCase()}
        </Txt>
        <Txt size={10.5} color={colors.textFaint}>
          {stats.ratedGames} rated games · avg gap {stats.avgOvrGap}
        </Txt>
      </View>
      <View style={{ flexDirection: "row", gap: spacing.sm }}>
        <View style={{ flex: 1 }}>
          <StatCard
            label="Stronger side won"
            value={`${stats.higherOvrWinRate}%`}
            sub={`${stats.higherOvrWins}/${stats.decisiveRated} decisive`}
          />
        </View>
        <View style={{ flex: 1 }}>
          <StatCard
            label="Upsets"
            value={`${stats.upsetRate}%`}
            sub={`${stats.upsets} upsets · ${stats.draws} drawn`}
          />
        </View>
      </View>
    </Card>
  );
}

function BigResultsSection({
  results,
  players,
}: {
  results: BigResult[];
  players: Map<string, LeaguePlayer>;
}) {
  if (!results.length) return null;
  return (
    <View style={{ marginBottom: spacing.lg }}>
      <SectionLabel>Biggest results</SectionLabel>
      <View style={{ gap: spacing.sm }}>
        {results.map((result) => {
          // Scorers-of-record are just the two players on the sheet.
          const scorerA = players.get(result.aId);
          const scorerB = players.get(result.bId);
          return (
            <Card key={result.matchId} style={styles.row}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Txt variant="bodyMedium" size={13} numberOfLines={1}>
                  {result.aTeamName} {result.aGoals} – {result.bGoals} {result.bTeamName}
                </Txt>
                <Txt size={10.5} color={colors.textDim} numberOfLines={1}>
                  {[scorerA?.name ?? result.aId, scorerB?.name ?? result.bId]
                    .map((name) => firstName(name))
                    .join(" vs ")}
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
            </Card>
          );
        })}
      </View>
    </View>
  );
}

/** Green when a rate leans winning, red when it leans losing, neutral in between. */
function rateColor(rate: number): string {
  if (rate >= 50) return colors.win;
  if (rate <= 25) return colors.loss;
  return colors.textDim;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.x3 },
  row: {
    minHeight: 54,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  rank: { width: 18, textAlign: "right" },
  fairHead: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    marginBottom: spacing.md,
    gap: spacing.sm,
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
