import { useCallback, useState } from "react";
import { ActivityIndicator, Image, ScrollView, StyleSheet, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  Avatar,
  Button,
  Card,
  EloDelta,
  Icon,
  ScreenHeader,
  SectionLabel,
  StatCard,
  Txt,
} from "@/components";
import {
  deleteMatchPhoto,
  explainMatchEloParagraph,
  getLeaguePlayers,
  getMatch,
  getMatchPhotoUrl,
  getSeason,
  type LeagueMatch,
  type LeaguePlayer,
  type Season,
} from "@/lib/league";
// Direct module import: the league barrel isn't extended for every leaf module.
import { castVote, getMatchVotes, type MatchVotes } from "@/lib/league/matchVotes";
import { useAuth } from "@/lib/auth";
import { useFocusData } from "@/lib/useFocusData";
import { colors, radius, spacing } from "@/theme";
import { mix, withAlpha } from "@/lib/color";
import { showAlert } from "@/lib/dialogs";
import { firstName, fmtXg } from "@/lib/format";

interface MatchData {
  match: LeagueMatch | null;
  season: Season | null;
  players: Map<string, LeaguePlayer>;
  photoUrl: string | null;
  photoExpires: number;
  /** Null for finals/unconfirmed matches, or when the votes read failed — hide the card. */
  votes: MatchVotes | null;
}

export default function MatchDetailRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const viewerId = user?.uid ?? null;
  const [deleting, setDeleting] = useState(false);
  const [photoHidden, setPhotoHidden] = useState(false);

  const {
    data,
    loading,
    error: loadFailed,
    reload,
  } = useFocusData<MatchData>(
    `match:${id}`,
    useCallback(async () => {
      const [result, roster] = await Promise.all([getMatch(id), getLeaguePlayers()]);
      const season = result ? await getSeason(result.seasonId) : null;
      let photoUrl: string | null = null;
      let photoExpires = 0;
      if (result?.source === "ai_assisted" && result.photoPath) {
        try {
          const photo = await getMatchPhotoUrl(id);
          photoUrl = photo.url;
          photoExpires = photo.expiresAt;
        } catch {
          photoUrl = null;
        }
      }
      // Votes are a nice-to-have beside the result itself: a failed read must not take
      // down the whole screen, so degrade to "no MVP card" instead of surfacing an error.
      const votes: MatchVotes | null =
        result && result.status === "confirmed"
          ? await getMatchVotes(id, viewerId).catch(() => null)
          : null;
      return {
        match: result,
        season,
        players: new Map(roster.map((player) => [player.id, player])),
        photoUrl,
        photoExpires,
        votes,
      };
    }, [id, viewerId]),
  );
  const match = data?.match ?? null;
  const season = data?.season ?? null;
  const players = data?.players ?? new Map<string, LeaguePlayer>();
  const votes = data?.votes ?? null;
  const photoUrl = photoHidden ? null : (data?.photoUrl ?? null);
  const photoExpires = data?.photoExpires ?? 0;
  const error = loadFailed ? "Couldn't load this match." : null;

  const handleDeletePhoto = async () => {
    setDeleting(true);
    try {
      await deleteMatchPhoto(id);
      setPhotoHidden(true);
      void reload();
    } catch {
      showAlert("Could not delete photo", "Try again or ask an admin.");
    } finally {
      setDeleting(false);
    }
  };

  const a = match ? players.get(match.aId) : null;
  const b = match ? players.get(match.bId) : null;
  const subtitle = match
    ? `${formatDate(match.date)}${season ? ` · ${season.name}` : ""}`
    : undefined;

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <ScreenHeader title="Match detail" subtitle={subtitle} />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {loading ? <ActivityIndicator color={colors.accent} /> : null}
        {error ? (
          <Card>
            <Txt color={colors.loss}>{error}</Txt>
            <Button variant="dark" size="sm" style={{ marginTop: spacing.md }} onPress={reload}>
              Retry
            </Button>
          </Card>
        ) : null}
        {!loading && !match ? (
          <Card style={{ alignItems: "center" }}>
            <Icon name="info" color={colors.textDim} />
            <Txt variant="head" size={16} style={{ marginTop: spacing.sm }}>
              Match not found
            </Txt>
          </Card>
        ) : null}
        {match && a && b ? (
          <>
            <View style={styles.hero}>
              <PlayerSide
                player={a}
                team={match.aTeam}
                delta={match.aDelta}
                winner={match.aGoals > match.bGoals}
              />
              <View style={styles.score}>
                <Txt variant="monoBold" size={48} style={{ letterSpacing: -2 }}>
                  {match.aGoals}
                  <Txt variant="monoBold" size={44} color={colors.textFaint}>
                    :
                  </Txt>
                  {match.bGoals}
                </Txt>
                <Txt variant="head" size={9.5} color={colors.textDim} style={styles.kicker}>
                  {match.status === "confirmed"
                    ? "FULL TIME"
                    : match.status.replace("_", " ").toUpperCase()}
                </Txt>
              </View>
              <PlayerSide
                player={b}
                team={match.bTeam}
                delta={match.bDelta}
                winner={match.bGoals > match.aGoals}
              />
            </View>

            <View style={styles.statRow}>
              <View style={{ flex: 1 }}>
                <StatCard
                  label={`${firstName(a.name)} ELO`}
                  value={match.aEloAfter ?? "—"}
                  sub={
                    match.aEloBefore !== null && match.aEloAfter !== null
                      ? `${match.aEloBefore} → ${match.aEloAfter}`
                      : "Pending confirmation"
                  }
                  accent={(match.aDelta ?? 0) >= 0}
                />
              </View>
              <View style={{ flex: 1 }}>
                <StatCard
                  label={`${firstName(b.name)} ELO`}
                  value={match.bEloAfter ?? "—"}
                  sub={
                    match.bEloBefore !== null && match.bEloAfter !== null
                      ? `${match.bEloBefore} → ${match.bEloAfter}`
                      : "Pending confirmation"
                  }
                  accent={(match.bDelta ?? 0) >= 0}
                />
              </View>
            </View>

            {match.status === "confirmed" && match.eloExplain ? (
              <EloExplainPanel match={match} playerA={a} playerB={b} />
            ) : null}

            {photoUrl ? (
              <View style={{ marginTop: spacing.x2 }}>
                <SectionLabel
                  action={
                    <Button
                      variant="dark"
                      size="sm"
                      onPress={handleDeletePhoto}
                      disabled={deleting}
                    >
                      {deleting ? "Deleting…" : "Delete photo"}
                    </Button>
                  }
                >
                  Stats photo
                </SectionLabel>
                <Image source={{ uri: photoUrl }} style={styles.photo} resizeMode="contain" />
                <Txt size={10} color={colors.textDim} style={{ marginTop: 4 }}>
                  Signed URL expires {new Date(photoExpires).toLocaleTimeString()}. Open again to
                  refresh.
                </Txt>
              </View>
            ) : null}

            <View style={{ marginTop: spacing.x2 }}>
              <SectionLabel>Stats screen</SectionLabel>
              <StatsPanel match={match} />
            </View>

            {votes !== null && !votes.isFinals ? (
              <MvpVoteCard
                matchId={id}
                votes={votes}
                playerA={a}
                playerB={b}
                viewerId={viewerId}
                onVoted={() => void reload()}
              />
            ) : null}
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function PlayerSide({
  player,
  team,
  delta,
  winner,
}: {
  player: LeaguePlayer;
  team: string;
  delta: number | null;
  winner: boolean;
}) {
  return (
    <View style={styles.playerSide}>
      <Avatar player={player} size={54} ring={winner} jersey />
      <Txt variant="bodyMedium" size={13.5} style={{ marginTop: spacing.sm }} numberOfLines={1}>
        {firstName(player.name)}
      </Txt>
      <View style={styles.team}>
        <Icon name="jersey" size={11} color={colors.textDim} />
        <Txt size={10.5} color={colors.textDim} numberOfLines={1}>
          {team}
        </Txt>
      </View>
      {delta !== null ? (
        <View style={{ marginTop: 5 }}>
          <EloDelta delta={delta} size={12} />
        </View>
      ) : null}
    </View>
  );
}

function StatsPanel({ match }: { match: LeagueMatch }) {
  const a = match.aStats;
  const b = match.bStats;
  const hasStats =
    a?.possession != null ||
    b?.possession != null ||
    a?.shots != null ||
    b?.shots != null ||
    a?.shotsOnTarget != null ||
    b?.shotsOnTarget != null ||
    a?.xg != null ||
    b?.xg != null;

  if (!hasStats) {
    return (
      <Card style={styles.noStats}>
        <Icon
          name={match.source === "ai_assisted" ? "photo" : "edit"}
          size={24}
          color={colors.textDim}
        />
        <View style={{ flex: 1 }}>
          <Txt variant="head" size={14}>
            {match.source === "ai_assisted" ? "Photo processed" : "Manual result"}
          </Txt>
          <Txt size={12} color={colors.textDim} style={{ marginTop: 3 }}>
            Detailed match stats were not recorded for this result.
          </Txt>
        </View>
      </Card>
    );
  }

  const possession = a?.possession ?? null;
  return (
    <Card style={styles.statsPanel}>
      <View style={styles.statsHeading}>
        <Txt variant="head" size={9.5} color={colors.textDim} style={styles.kicker}>
          FULL TIME · STATS
        </Txt>
        <Icon name="photo" size={15} color={colors.textDim} />
      </View>
      {possession !== null ? (
        <View style={{ marginBottom: spacing.md }}>
          <StatsRow
            label="Possession"
            a={`${possession}%`}
            b={`${b?.possession ?? 100 - possession}%`}
          />
          <View style={styles.possessionTrack}>
            <View
              style={[
                styles.possessionFill,
                { width: `${Math.max(0, Math.min(100, possession))}%` },
              ]}
            />
          </View>
        </View>
      ) : null}
      <View style={{ gap: spacing.sm }}>
        <StatsRow label="Shots" a={a?.shots ?? "—"} b={b?.shots ?? "—"} />
        <StatsRow label="On target" a={a?.shotsOnTarget ?? "—"} b={b?.shotsOnTarget ?? "—"} />
        {(a?.xg != null || b?.xg != null) && (
          <StatsRow label="Expected goals" a={fmtXg(a?.xg)} b={fmtXg(b?.xg)} />
        )}
        <StatsRow label="Goals" a={match.aGoals} b={match.bGoals} />
      </View>
    </Card>
  );
}

function signed(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

function kCell(k: number): string {
  return k > 32 ? `${k} ·P` : String(k);
}

/** One player's prose block: name kicker + the sentences the copy generator
 *  built from this match's own eloExplain numbers. */
function EloExplainPanel({
  match,
  playerA,
  playerB,
}: {
  match: LeagueMatch;
  playerA: LeaguePlayer;
  playerB: LeaguePlayer;
}) {
  const ex = match.eloExplain;
  if (!ex || match.aDelta === null || match.bDelta === null) return null;
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  // Null for matches confirmed before eloExplain/persisted ratings existed —
  // those fall back to the numbers table alone.
  const paragraph = explainMatchEloParagraph(
    match,
    firstName(playerA.name),
    firstName(playerB.name),
  );
  const provisional = ex.aK > 32 || ex.bK > 32;
  return (
    <View style={{ marginTop: spacing.x2 }}>
      <SectionLabel>Why the rating moved</SectionLabel>
      <Card style={styles.statsPanel}>
        {paragraph ? (
          <Txt
            size={11.5}
            color={colors.textDim}
            style={{ lineHeight: 16.5, marginBottom: spacing.md }}
          >
            {paragraph}
          </Txt>
        ) : null}
        <View style={{ gap: spacing.sm }}>
          <StatsRow label="Win chance" a={pct(ex.aExpected)} b={pct(ex.bExpected)} />
          <StatsRow label="Share of the game" a={pct(ex.perfA)} b={pct(ex.perfB)} />
          {ex.aTeamAdj !== 0 ? (
            <StatsRow label="Team handicap" a={signed(ex.aTeamAdj)} b={signed(ex.bTeamAdj)} />
          ) : null}
          {ex.aPremierAdj !== 0 ? (
            <StatsRow
              label="Premier handicap"
              a={signed(ex.aPremierAdj)}
              b={signed(ex.bPremierAdj)}
            />
          ) : null}
          {provisional ? <StatsRow label="K-factor" a={kCell(ex.aK)} b={kCell(ex.bK)} /> : null}
          <StatsRow label="ELO change" a={signed(match.aDelta)} b={signed(match.bDelta)} />
        </View>
      </Card>
    </View>
  );
}

function StatsRow({ label, a, b }: { label: string; a: string | number; b: string | number }) {
  return (
    <View style={styles.statsRow}>
      <Txt variant="monoBold" size={12}>
        {a}
      </Txt>
      <Txt variant="head" size={9.5} color={colors.textDim} style={styles.kicker}>
        {label.toUpperCase()}
      </Txt>
      <Txt variant="monoBold" size={12} style={{ textAlign: "right" }}>
        {b}
      </Txt>
    </View>
  );
}

function formatDate(date: Date | null): string {
  return date
    ? date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
    : "Date pending";
}

/** Per-match MVP card. Participants vote within 48h of confirmation (either player is a
 *  valid candidate, never yourself); everyone sees the tally. Finals matches and unconfirmed
 *  matches never reach here — the route hides the card before rendering it. */
function MvpVoteCard({
  matchId,
  votes,
  playerA,
  playerB,
  viewerId,
  onVoted,
}: {
  matchId: string;
  votes: MatchVotes;
  playerA: LeaguePlayer;
  playerB: LeaguePlayer;
  /** The signed-in viewer's uid, or null (read-only tally). */
  viewerId: string | null;
  onVoted: () => void;
}) {
  const [submitting, setSubmitting] = useState<"a" | "b" | null>(null);
  const isParticipant = viewerId !== null && (viewerId === playerA.id || viewerId === playerB.id);
  const windowOpen = votes.closesAt !== null && Date.now() < votes.closesAt;

  const handleVote = async (candidateId: string) => {
    if (!viewerId || submitting) return;
    setSubmitting(candidateId === playerA.id ? "a" : "b");
    try {
      await castVote(matchId, candidateId);
      onVoted();
    } catch {
      showAlert("Vote not counted", "Voting may have closed — try again in a moment.");
    } finally {
      setSubmitting(null);
    }
  };

  const rows: Array<{ id: string; name: string; count: number }> = [
    { id: playerA.id, name: firstName(playerA.name), count: votes.summary.tally[playerA.id] ?? 0 },
    { id: playerB.id, name: firstName(playerB.name), count: votes.summary.tally[playerB.id] ?? 0 },
  ];
  const total = Math.max(votes.summary.totalVotes, 1);
  // Voting UI stays up for the whole window so a participant can CHANGE their pick;
  // the server accepts the overwrite until the 48h gate shuts.
  const mayVote = isParticipant && windowOpen;

  return (
    <View style={{ marginTop: spacing.x2 }}>
      <SectionLabel
        action={
          <Txt size={10} color={colors.textDim}>
            {windowOpen && votes.closesAt !== null
              ? `Closes ${new Date(votes.closesAt).toLocaleString()}`
              : "Voting closed"}
          </Txt>
        }
      >
        Man of the match
      </SectionLabel>
      <Card style={styles.statsPanel}>
        {mayVote ? (
          <>
            <Txt size={11.5} color={colors.textDim} style={{ marginBottom: spacing.md }}>
              Who was the man of the match?
            </Txt>
            <View style={styles.voteButtons}>
              <Button
                variant="dark"
                size="sm"
                onPress={() => handleVote(playerA.id)}
                disabled={viewerId === playerA.id || submitting !== null}
              >
                {submitting === "a" ? "Voting…" : firstName(playerA.name)}
              </Button>
              <Button
                variant="dark"
                size="sm"
                onPress={() => handleVote(playerB.id)}
                disabled={viewerId === playerB.id || submitting !== null}
              >
                {submitting === "b" ? "Voting…" : firstName(playerB.name)}
              </Button>
            </View>
            <Txt size={10} color={colors.textDim} style={{ marginTop: spacing.sm }}>
              Can&apos;t vote for yourself
              {votes.myCandidateId !== null ? " · tap again to change your vote" : ""}
            </Txt>
          </>
        ) : null}
        {isParticipant && votes.myCandidateId !== null ? (
          <Txt size={11} color={colors.textDim} style={{ marginTop: mayVote ? spacing.sm : 0 }}>
            You voted for{" "}
            {rows.find((row) => row.id === votes.myCandidateId)?.name ??
              "a player no longer listed"}
            .
          </Txt>
        ) : null}
        <View style={{ marginTop: mayVote ? spacing.md : 0, gap: 5 }}>
          {rows.map((row) => (
            <TallyRow key={row.id} label={row.name} count={row.count} total={total} />
          ))}
        </View>
        <Txt size={11} color={colors.textDim} style={{ marginTop: spacing.sm }}>
          {votes.summary.totalVotes === 0
            ? "No votes yet."
            : votes.summary.leaderId === null
              ? "Tie"
              : `${rows.find((row) => row.id === votes.summary.leaderId)?.name ?? "Leader"} leads`}
          {" · "}
          {votes.summary.totalVotes} {votes.summary.totalVotes === 1 ? "vote" : "votes"}
        </Txt>
      </Card>
    </View>
  );
}

/** One candidate's share-of-votes bar with their count at the end. */
function TallyRow({ label, count, total }: { label: string; count: number; total: number }) {
  const pct = Math.round((count / total) * 100);
  return (
    <View style={{ marginTop: 5 }}>
      <StatsRow label="" a={label} b={`${count}`} />
      <View style={[styles.possessionTrack, styles.tallyTrack]}>
        <View style={[styles.possessionFill, { width: `${Math.max(0, Math.min(100, pct))}%` }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.x3 },
  hero: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 190,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.x2,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: mix(colors.surface, "#243347", 24),
  },
  playerSide: { flex: 1, alignItems: "center", minWidth: 0 },
  team: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
    marginTop: 3,
    maxWidth: 96,
  },
  score: { alignItems: "center", paddingHorizontal: 2 },
  kicker: { letterSpacing: 1.15 },
  statRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md },
  noStats: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  statsPanel: {
    backgroundColor: mix(colors.surface, "#17304a", 18),
    borderColor: withAlpha(colors.accent, 0.13),
  },
  statsHeading: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.md,
  },
  statsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  possessionTrack: {
    height: 6,
    marginTop: 5,
    borderRadius: radius.pill,
    overflow: "hidden",
    backgroundColor: colors.surface2,
  },
  possessionFill: { height: "100%", backgroundColor: colors.accent },
  photo: {
    width: "100%",
    aspectRatio: 900 / 1280,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    marginTop: spacing.sm,
  },
  voteButtons: { flexDirection: "row", gap: spacing.sm },
  tallyTrack: { height: 4, marginTop: 3, opacity: 0.7 },
});
