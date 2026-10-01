/**
 * Match detail. Where a `match_pending` push lands, so when the viewer is the named
 * opponent of a result awaiting confirmation it carries a pinned Confirm / Dispute bar
 * (same resolve path as the inbox). Shows the result, both rating moves (previewed while
 * pending), the "why it moved" breakdown, stats, the stats photo (capped, true aspect,
 * click to zoom) and the MVP vote. Desktop splits into two columns under the hero.
 */
import { useCallback, useState } from "react";
import { StyleSheet, View } from "react-native";
import { type Href, useLocalSearchParams, useRouter } from "expo-router";
import {
  Avatar,
  Button,
  Card,
  Columns,
  CountUp,
  EloDelta,
  EmptyState,
  ErrorCard,
  Icon,
  Page,
  Reveal,
  ScreenHeader,
  SectionLabel,
  SkeletonCard,
  StatCard,
  Tag,
  Txt,
} from "@/components";
import { VerdictActions } from "@/components/MatchVerdict";
import { PhotoThumb } from "@/components/PhotoLightbox";
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
// Direct module imports: the league barrel isn't extended for every leaf module.
import { castVote, getMatchVotes, type MatchVotes } from "@/lib/league/matchVotes";
import { getPendingImpacts, type PendingImpact } from "@/lib/league/pendingImpact";
import { useAuth } from "@/lib/auth";
import { useFocusData } from "@/lib/useFocusData";
import { colors, radius, spacing } from "@/theme";
import { mix, withAlpha } from "@/lib/color";
import { confirmAction } from "@/lib/dialogs";
import { friendlyError } from "@/lib/friendlyError";
import { toast } from "@/lib/toast";
import { useBreakpoint } from "@/lib/responsive";
import { firstName, fmtXg } from "@/lib/format";
import { timeAgo } from "@/lib/when";

interface MatchData {
  match: LeagueMatch | null;
  season: Season | null;
  players: Map<string, LeaguePlayer>;
  photoUrl: string | null;
  photoExpires: number;
  /** Null for finals/unconfirmed matches, or when the votes read failed — hide the card. */
  votes: MatchVotes | null;
  /** Rating preview while the result awaits confirmation. */
  preview: PendingImpact | null;
}

export default function MatchDetailRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const viewerId = user?.uid ?? null;
  const { isDesktop } = useBreakpoint();
  const [deleting, setDeleting] = useState(false);
  const [photoHidden, setPhotoHidden] = useState(false);

  const {
    data,
    refreshing,
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
      const preview =
        result && result.status === "pending_confirmation"
          ? ((await getPendingImpacts([result]).catch(() => null))?.get(result.id) ?? null)
          : null;
      return {
        match: result,
        season,
        players: new Map(roster.map((player) => [player.id, player])),
        photoUrl,
        photoExpires,
        votes,
        preview,
      };
    }, [id, viewerId]),
  );
  const match = data?.match ?? null;
  const season = data?.season ?? null;
  const players = data?.players ?? new Map<string, LeaguePlayer>();
  const votes = data?.votes ?? null;
  const preview = data?.preview ?? null;
  const photoUrl = photoHidden ? null : (data?.photoUrl ?? null);
  const photoExpires = data?.photoExpires ?? 0;

  const a = match ? players.get(match.aId) : null;
  const b = match ? players.get(match.bId) : null;
  const pending = match?.status === "pending_confirmation";
  const viewerIsParticipant = !!match && (viewerId === match.aId || viewerId === match.bId);
  const awaitingViewer = pending && viewerIsParticipant && match?.submittedBy !== viewerId;
  const viewerSubmitted = !!match && match.submittedBy === viewerId;
  const submitter = match ? players.get(match.submittedBy) : null;
  const opponentOfViewer = match
    ? players.get(viewerId === match.aId ? match.bId : match.aId)
    : null;

  const subtitle = match
    ? `${formatDate(match.date)}${season ? ` · ${season.name}` : ""}`
    : undefined;

  const handleDeletePhoto = () =>
    confirmAction({
      title: "Delete this photo?",
      message:
        "The stats screenshot is removed for everyone. The score and stats you submitted stay. This can't be undone.",
      confirmLabel: "Delete photo",
      destructive: true,
      onConfirm: async () => {
        setDeleting(true);
        try {
          await deleteMatchPhoto(id);
          setPhotoHidden(true);
          toast.success("Photo deleted");
          void reload();
        } catch (err) {
          toast.error(friendlyError(err, "Couldn't delete the photo. Try again in a moment."));
        } finally {
          setDeleting(false);
        }
      },
    });

  const header = (
    <ScreenHeader
      title="Match detail"
      subtitle={subtitle}
      onRefresh={() => void reload()}
      refreshing={refreshing}
    />
  );

  const verdictBar =
    awaitingViewer && match ? (
      <View style={[styles.verdictBar, isDesktop && styles.verdictBarDesktop]}>
        <Txt
          size={12.5}
          color={colors.textDim}
          style={isDesktop ? { flex: 1, lineHeight: 18 } : { marginBottom: spacing.sm }}
        >
          {submitter ? firstName(submitter.name) : "Your opponent"} logged this result. Confirm it
          to put it in the table, or dispute it for an admin to settle.
        </Txt>
        <View style={isDesktop ? { width: 400 } : undefined}>
          <VerdictActions
            matchId={match.id}
            opponentName={opponentOfViewer ? firstName(opponentOfViewer.name) : "your opponent"}
            size="lg"
            onResolved={() => void reload()}
            confirmMessage={
              preview
                ? `Result confirmed · your ELO ${
                    viewerId === match.aId ? preview.aEloBefore : preview.bEloBefore
                  } → ${
                    viewerId === match.aId
                      ? preview.aEloBefore + preview.aDelta
                      : preview.bEloBefore + preview.bDelta
                  }`
                : "Result confirmed — it's in the table."
            }
          />
        </View>
      </View>
    ) : undefined;

  // `loading` only flips once the fetch is scheduled; no data and no error means "loading".
  if (!data && !loadFailed) {
    return (
      <Page header={header} width="default">
        <View style={{ gap: spacing.md }}>
          <SkeletonCard height={200} />
          <Columns at="desktop" gap={spacing.md}>
            <SkeletonCard height={120} />
            <SkeletonCard height={120} />
          </Columns>
          <SkeletonCard height={180} />
        </View>
      </Page>
    );
  }

  if (loadFailed && !data) {
    return (
      <Page header={header} width="narrow">
        <ErrorCard
          message="Couldn't load this match. Check your connection and retry."
          onRetry={() => void reload()}
          retrying={refreshing}
        />
      </Page>
    );
  }

  if (!match || !a || !b) {
    return (
      <Page header={header} width="narrow">
        <EmptyState
          icon="info"
          title="Match not found"
          body="It may have been voided or removed by an admin."
          action={{
            label: "Your games",
            icon: "list",
            onPress: () => router.replace("/(app)/games" as Href),
          }}
        />
      </Page>
    );
  }

  const aDelta = match.aDelta ?? (preview && !preview.finals ? preview.aDelta : null);
  const bDelta = match.bDelta ?? (preview && !preview.finals ? preview.bDelta : null);

  const ratings = (
    <Reveal delay={80}>
      <View style={styles.statRow}>
        <View style={{ flex: 1 }}>
          <EloCard player={a} match={match} side="a" preview={preview} />
        </View>
        <View style={{ flex: 1 }}>
          <EloCard player={b} match={match} side="b" preview={preview} />
        </View>
      </View>
      {match.status === "confirmed" && match.eloExplain ? (
        <EloExplainPanel match={match} playerA={a} playerB={b} />
      ) : null}
    </Reveal>
  );

  const details = (
    <Reveal delay={140}>
      <SectionLabel>Stats screen</SectionLabel>
      <StatsPanel match={match} />

      {photoUrl ? (
        <View style={{ marginTop: spacing.x2 }}>
          <SectionLabel
            action={
              viewerSubmitted ? (
                <Button
                  variant="danger"
                  size="sm"
                  icon="x"
                  onPress={handleDeletePhoto}
                  loading={deleting}
                >
                  Delete photo
                </Button>
              ) : undefined
            }
          >
            Stats photo
          </SectionLabel>
          <PhotoThumb uri={photoUrl} maxHeight={360} label="Stats photo" />
          <Txt size={10.5} color={colors.textFaint} style={{ marginTop: 6 }}>
            Private link — expires {new Date(photoExpires).toLocaleTimeString()}. Reopen the match
            to refresh it.
          </Txt>
        </View>
      ) : null}

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
    </Reveal>
  );

  return (
    <Page
      header={header}
      footer={verdictBar}
      width="default"
      onRefresh={() => void reload()}
      refreshing={refreshing}
    >
      <Reveal from="scale">
        <View style={[styles.hero, isDesktop && styles.heroDesktop]}>
          <PlayerSide
            player={a}
            team={match.aTeam}
            delta={aDelta}
            winner={match.aGoals > match.bGoals}
            pending={pending}
            size={isDesktop ? 72 : 54}
          />
          <View style={styles.score}>
            <Txt variant="monoBold" size={isDesktop ? 64 : 48} style={{ letterSpacing: -2 }}>
              {match.aGoals}
              <Txt variant="monoBold" size={isDesktop ? 58 : 44} color={colors.textFaint}>
                :
              </Txt>
              {match.bGoals}
            </Txt>
            <StatusTag match={match} />
          </View>
          <PlayerSide
            player={b}
            team={match.bTeam}
            delta={bDelta}
            winner={match.bGoals > match.aGoals}
            pending={pending}
            size={isDesktop ? 72 : 54}
          />
        </View>
      </Reveal>

      <StatusBanner
        match={match}
        viewerSubmitted={viewerSubmitted}
        awaitingViewer={awaitingViewer}
        opponentName={opponentOfViewer ? firstName(opponentOfViewer.name) : "your opponent"}
      />

      <Columns at="desktop" gap={spacing.x2} style={{ marginTop: spacing.lg }}>
        {ratings}
        {details}
      </Columns>
    </Page>
  );
}

function StatusTag({ match }: { match: LeagueMatch }) {
  if (match.status === "confirmed") {
    return (
      <Txt variant="head" size={9.5} color={colors.textDim} style={styles.kicker}>
        FULL TIME
      </Txt>
    );
  }
  const tone = match.status === "pending_confirmation" ? "accent" : "loss";
  const label =
    match.status === "pending_confirmation"
      ? "AWAITING CONFIRMATION"
      : match.status === "disputed"
        ? "DISPUTED"
        : "VOIDED";
  return (
    <View style={{ marginTop: 4 }}>
      <Tag tone={tone}>{label}</Tag>
    </View>
  );
}

/** One line under the hero explaining where a non-final result stands. */
function StatusBanner({
  match,
  viewerSubmitted,
  awaitingViewer,
  opponentName,
}: {
  match: LeagueMatch;
  viewerSubmitted: boolean;
  awaitingViewer: boolean;
  opponentName: string;
}) {
  let icon: "clock" | "info" | "flame" = "clock";
  let text: string | null = null;
  if (match.status === "pending_confirmation") {
    text = awaitingViewer
      ? "This result needs your verdict — it doesn't count until you confirm it."
      : viewerSubmitted
        ? `Sent ${timeAgo(match.date)} — waiting for ${opponentName} to confirm. Nothing counts until they do.`
        : "Awaiting confirmation from the opponent.";
  } else if (match.status === "disputed") {
    icon = "flame";
    text = "Disputed — an admin will review it and settle the score. Ratings are unaffected.";
  } else if (match.status === "voided") {
    icon = "info";
    text = "Voided by an admin — this result doesn't count.";
  }
  if (!text) return null;
  const warn = match.status !== "pending_confirmation";
  return (
    <Reveal delay={60}>
      <View
        style={[
          styles.banner,
          warn && {
            borderColor: withAlpha(colors.loss, 0.35),
            backgroundColor: withAlpha(colors.loss, 0.06),
          },
        ]}
        accessibilityRole="summary"
      >
        <Icon name={icon} size={16} color={warn ? colors.loss : colors.accent} />
        <Txt size={13} color={colors.text} style={{ flex: 1, lineHeight: 18 }}>
          {text}
        </Txt>
      </View>
    </Reveal>
  );
}

function EloCard({
  player,
  match,
  side,
  preview,
}: {
  player: LeaguePlayer;
  match: LeagueMatch;
  side: "a" | "b";
  preview: PendingImpact | null;
}) {
  const before = side === "a" ? match.aEloBefore : match.bEloBefore;
  const after = side === "a" ? match.aEloAfter : match.bEloAfter;
  const delta = side === "a" ? match.aDelta : match.bDelta;
  if (before !== null && after !== null) {
    return (
      <StatCard label={`${firstName(player.name)} ELO`} accent={(delta ?? 0) >= 0}>
        <CountUp
          value={after}
          from={before}
          duration={1000}
          variant="monoBold"
          size={30}
          color={(delta ?? 0) >= 0 ? colors.accent : colors.text}
          style={{ lineHeight: 31, letterSpacing: -0.6 }}
        />
        <Txt size={11.5} color={colors.textDim}>
          {before} → {after}
        </Txt>
      </StatCard>
    );
  }
  if (preview && match.status === "pending_confirmation") {
    const pBefore = side === "a" ? preview.aEloBefore : preview.bEloBefore;
    const pDelta = side === "a" ? preview.aDelta : preview.bDelta;
    return (
      <StatCard
        label={`${firstName(player.name)} ELO`}
        value={preview.finals ? pBefore : pBefore + pDelta}
        sub={
          preview.finals
            ? "Finals — no ELO change"
            : `${pBefore} → ${pBefore + pDelta} if confirmed`
        }
      />
    );
  }
  return (
    <StatCard
      label={`${firstName(player.name)} ELO`}
      value="—"
      sub={match.status === "pending_confirmation" ? "Pending confirmation" : "Not rated"}
    />
  );
}

function PlayerSide({
  player,
  team,
  delta,
  winner,
  pending,
  size,
}: {
  player: LeaguePlayer;
  team: string;
  delta: number | null;
  winner: boolean;
  pending: boolean;
  size: number;
}) {
  return (
    <View style={styles.playerSide}>
      <Avatar player={player} size={size} ring={winner} jersey />
      <Txt variant="bodyMedium" size={14} style={{ marginTop: spacing.sm }} numberOfLines={1}>
        {firstName(player.name)}
      </Txt>
      <View style={styles.team}>
        <Icon name="jersey" size={11} color={colors.textDim} />
        <Txt size={11} color={colors.textDim} numberOfLines={1}>
          {team}
        </Txt>
      </View>
      {delta !== null ? (
        <View style={{ marginTop: 5, flexDirection: "row", alignItems: "center", gap: 4 }}>
          <EloDelta delta={delta} size={12} />
          {pending ? (
            <Txt size={10} color={colors.textFaint}>
              preview
            </Txt>
          ) : null}
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
      <EmptyState
        compact
        icon={match.source === "ai_assisted" ? "photo" : "edit"}
        title={match.source === "ai_assisted" ? "Photo processed" : "Manual result"}
        body="Detailed match stats were not recorded for this result."
      />
    );
  }

  const possession = a?.possession ?? null;
  return (
    <Card style={styles.statsPanel}>
      <View style={styles.statsHeading}>
        <Txt variant="head" size={9.5} color={colors.textDim} style={styles.kicker}>
          FULL TIME · STATS
        </Txt>
        {match.source === "ai_assisted" ? <Tag tone="accent">AI</Tag> : null}
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
        {(a?.saves != null || b?.saves != null) && (
          <StatsRow label="Saves" a={a?.saves ?? "—"} b={b?.saves ?? "—"} />
        )}
        {(a?.ballRecoveryTime != null || b?.ballRecoveryTime != null) && (
          <StatsRow
            label="Ball recovery (s)"
            a={a?.ballRecoveryTime ?? "—"}
            b={b?.ballRecoveryTime ?? "—"}
          />
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
            size={12}
            color={colors.textDim}
            style={{ lineHeight: 18, marginBottom: spacing.md }}
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
      <Txt variant="monoBold" size={12.5}>
        {a}
      </Txt>
      <Txt variant="head" size={9.5} color={colors.textDim} style={styles.kicker}>
        {label.toUpperCase()}
      </Txt>
      <Txt variant="monoBold" size={12.5} style={{ textAlign: "right" }}>
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
      toast.success(
        `Vote counted for ${firstName(candidateId === playerA.id ? playerA.name : playerB.name)}`,
      );
      onVoted();
    } catch (err) {
      toast.error(
        friendlyError(err, "Vote not counted — voting may have closed. Try again in a moment."),
      );
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
          <Txt size={10.5} color={colors.textDim}>
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
            <Txt size={12} color={colors.textDim} style={{ marginBottom: spacing.md }}>
              Who was the man of the match?
            </Txt>
            <View style={styles.voteButtons}>
              {[playerA, playerB].map((player, index) => (
                <Button
                  key={player.id}
                  variant={votes.myCandidateId === player.id ? "primary" : "dark"}
                  size="sm"
                  icon={votes.myCandidateId === player.id ? "check" : "star"}
                  onPress={() => handleVote(player.id)}
                  disabled={
                    viewerId === player.id ||
                    (submitting !== null && submitting !== (index === 0 ? "a" : "b"))
                  }
                  loading={submitting === (index === 0 ? "a" : "b")}
                >
                  {firstName(player.name)}
                </Button>
              ))}
            </View>
            <Txt size={10.5} color={colors.textDim} style={{ marginTop: spacing.sm }}>
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
  heroDesktop: { minHeight: 240, paddingHorizontal: spacing.x4 },
  playerSide: { flex: 1, alignItems: "center", minWidth: 0 },
  team: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
    marginTop: 3,
    maxWidth: 160,
  },
  score: { alignItems: "center", paddingHorizontal: 2 },
  kicker: { letterSpacing: 1.15 },
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    marginTop: spacing.md,
    padding: spacing.md,
    paddingLeft: spacing.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: withAlpha(colors.accent, 0.3),
    backgroundColor: withAlpha(colors.accent, 0.06),
  },
  statRow: { flexDirection: "row", gap: spacing.sm },
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
  voteButtons: { flexDirection: "row", gap: spacing.sm },
  tallyTrack: { height: 4, marginTop: 3, opacity: 0.7 },
  verdictBarDesktop: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.x2,
    paddingBottom: spacing.lg,
  },
  verdictBar: {
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    backgroundColor: colors.bg,
  },
});
