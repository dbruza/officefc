/**
 * Admin dashboard. Overview tiles up top answer "what needs me?" at a glance — the season
 * phase with its next valid step, the results queue, the join code and the cup — and the
 * tools below switch with a segmented control (Results carries the queue count, and
 * opens by default when there's a dispute waiting).
 *
 * Seasons and the results queue are loaded here, once, and shared by the tiles and the
 * sections so the two never disagree.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  Button,
  Card,
  CountUp,
  EmptyState,
  Grid,
  Icon,
  Page,
  Reveal,
  ScreenHeader,
  Segmented,
  Skeleton,
  Tag,
  Txt,
  type IconName,
} from "@/components";
import { AdminInvite } from "@/components/AdminInvite";
import { useAuth } from "@/lib/auth";
import { useBreakpoint } from "@/lib/responsive";
import { confirmAction, showAlert } from "@/lib/dialogs";
import { toast } from "@/lib/toast";
import { callableErrorMessage } from "@/lib/authErrors";
import { withAlpha } from "@/lib/color";
import { colors, spacing } from "@/theme";
import {
  getAdminPendingMatches,
  getCup,
  getLeaguePlayers,
  startCup,
  type AdminPendingMatch,
  type CupState,
  type LeaguePlayer,
} from "@/lib/league";
import { SeasonsSection } from "@/screens/admin/SeasonsSection";
import { TeamsSection } from "@/screens/admin/TeamsSection";
import { PendingSection } from "@/screens/admin/PendingSection";
import { MaintenanceSection } from "@/screens/admin/MaintenanceSection";
import { SafetySection } from "@/screens/admin/SafetySection";
import {
  formatDay,
  loadAdminSeasons,
  readySeasons,
  useSeasonActions,
  type AdminSeason,
  type SeasonActions,
} from "@/screens/admin/seasonActions";

type Section = "seasons" | "pending" | "teams" | "safety" | "maintenance";

export default function AdminScreen() {
  const { membership } = useAuth();
  if (membership?.role !== "admin") return <NotAdmin />;
  return <AdminDashboard />;
}

function NotAdmin() {
  const router = useRouter();
  return (
    <Page width="narrow" header={<ScreenHeader title="Admin" />}>
      <EmptyState
        icon="shield"
        title="Admin only"
        body="This area is for league admins. Ask one of them if something on the table needs fixing."
        action={{
          label: "Back to home",
          icon: "home",
          onPress: () => router.replace("/(app)/(tabs)"),
        }}
        style={{ marginTop: spacing.x3 }}
      />
    </Page>
  );
}

function AdminDashboard() {
  const { isDesktop, isPhone, isWide } = useBreakpoint();

  // Seasons
  const [seasons, setSeasons] = useState<AdminSeason[]>([]);
  const [seasonsLoading, setSeasonsLoading] = useState(true);
  const [seasonsError, setSeasonsError] = useState<string | null>(null);
  // Results queue (null until the first load lands, so "all clear" never shows early)
  const [pending, setPending] = useState<AdminPendingMatch[] | null>(null);
  const [players, setPlayers] = useState<Map<string, LeaguePlayer>>(new Map());
  const [pendingLoading, setPendingLoading] = useState(true);
  const [pendingError, setPendingError] = useState<string | null>(null);
  // Cup for the active season (undefined = not loaded)
  const [cup, setCup] = useState<CupState | null | undefined>(undefined);

  // A report push deep-links to ?section=safety.
  const params = useLocalSearchParams<{ section?: string }>();
  const [section, setSection] = useState<Section>(
    params.section === "safety" ? "safety" : "seasons",
  );
  const userPicked = useRef(params.section === "safety");
  const [createRequested, setCreateRequested] = useState(false);
  const createHandled = useCallback(() => setCreateRequested(false), []);
  const [refreshing, setRefreshing] = useState(false);

  const activeSeason = seasons.find((s) => s.active) ?? null;

  const reloadSeasons = useCallback(async () => {
    setSeasonsLoading(true);
    try {
      const list = await loadAdminSeasons();
      setSeasons(list);
      setSeasonsError(null);
      const active = list.find((s) => s.active);
      // getCup swallows read errors (null), so the tile simply reads "not drawn" then.
      setCup(active ? await getCup(active.id) : null);
    } catch {
      setSeasonsError("Couldn't load the seasons. Check your connection and retry.");
    } finally {
      setSeasonsLoading(false);
    }
  }, []);

  const reloadPending = useCallback(async () => {
    setPendingLoading(true);
    try {
      const [queue, roster] = await Promise.all([getAdminPendingMatches(), getLeaguePlayers()]);
      setPending(queue);
      setPlayers(new Map(roster.map((player) => [player.id, player])));
      setPendingError(null);
      // Open on the queue when a dispute is waiting, unless the admin already chose a tab.
      if (!userPicked.current && queue.some((m) => m.status === "disputed")) {
        setSection("pending");
      }
    } catch {
      setPendingError("Couldn't load the results queue. Check your connection and retry.");
    } finally {
      setPendingLoading(false);
    }
  }, []);

  useEffect(() => {
    void reloadSeasons();
    void reloadPending();
  }, [reloadSeasons, reloadPending]);

  const refreshAll = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([reloadSeasons(), reloadPending()]);
    setRefreshing(false);
  }, [reloadSeasons, reloadPending]);

  const pick = (next: Section) => {
    userPicked.current = true;
    setSection(next);
  };

  const actions = useSeasonActions({
    seasons,
    reload: reloadSeasons,
    onCreateNext: () => {
      pick("seasons");
      setCreateRequested(true);
    },
  });

  const pendingCount = pending?.length ?? 0;
  const disputedCount = pending?.filter((m) => m.status === "disputed").length ?? 0;

  const seasonTile = (
    <SeasonPhaseTile
      season={activeSeason}
      seasons={seasons}
      loading={seasonsLoading && seasons.length === 0}
      error={seasons.length === 0 ? seasonsError : null}
      onRetry={() => void reloadSeasons()}
      actions={actions}
      onCreate={() => {
        pick("seasons");
        setCreateRequested(true);
      }}
    />
  );
  const queueTile = (
    <QueueTile
      loading={pending === null}
      error={pending === null ? pendingError : null}
      count={pendingCount}
      disputed={disputedCount}
      compact={isPhone}
      onPress={() => pick("pending")}
    />
  );
  const inviteTile = <AdminInvite variant="tile" style={styles.fill} />;
  const cupTile = (
    <CupTile
      season={activeSeason}
      cup={cup}
      compact={isPhone}
      onChanged={() => void reloadSeasons()}
    />
  );

  return (
    <Page
      width="wide"
      refreshing={refreshing}
      onRefresh={() => void refreshAll()}
      header={
        <ScreenHeader
          title="Admin"
          subtitle="Seasons, results, teams, safety and invites"
          onRefresh={() => void refreshAll()}
          refreshing={refreshing}
        />
      }
    >
      {isPhone ? (
        // Phones: the season tile full width, the two small tiles side by side.
        <View style={{ gap: spacing.md }}>
          <Reveal index={0}>{seasonTile}</Reveal>
          <Grid min={150} maxColumns={2} gap={spacing.md}>
            <Reveal index={1} style={styles.fill}>
              {queueTile}
            </Reveal>
            <Reveal index={2} style={styles.fill}>
              {cupTile}
            </Reveal>
          </Grid>
          <Reveal index={3}>{inviteTile}</Reveal>
        </View>
      ) : (
        // Four across when there's room for all four, otherwise a tidy 2 × 2 (never 3 + 1).
        <Grid min={isWide ? 220 : 280} maxColumns={isWide ? 4 : 2} gap={spacing.md}>
          <Reveal index={0} style={styles.fill}>
            {seasonTile}
          </Reveal>
          <Reveal index={1} style={styles.fill}>
            {queueTile}
          </Reveal>
          <Reveal index={2} style={styles.fill}>
            {inviteTile}
          </Reveal>
          <Reveal index={3} style={styles.fill}>
            {cupTile}
          </Reveal>
        </Grid>
      )}

      <Segmented<Section>
        // Remount when the badge appears or labels change: react-native-web only re-fires
        // onLayout on size changes, so items shifted sideways would leave the pill behind.
        key={`${pendingCount > 0}-${isPhone}`}
        value={section}
        onChange={pick}
        size={isPhone ? "sm" : "md"}
        full={!isDesktop}
        style={styles.tabs}
        options={[
          { value: "seasons", label: "Seasons", icon: isPhone ? undefined : "seasons" },
          {
            value: "pending",
            label: "Results",
            icon: isPhone ? undefined : "inbox",
            badge: pendingCount || undefined,
          },
          { value: "teams", label: "Teams", icon: isPhone ? undefined : "jersey" },
          { value: "safety", label: "Safety", icon: isPhone ? undefined : "shield" },
          {
            value: "maintenance",
            label: isPhone ? "Tools" : "Maintenance",
            icon: isPhone ? undefined : "settings",
          },
        ]}
      />

      <View>
        {section === "seasons" ? (
          <SeasonsSection
            seasons={seasons}
            loading={seasonsLoading}
            error={seasonsError}
            reload={reloadSeasons}
            actions={actions}
            createRequested={createRequested}
            onCreateHandled={createHandled}
          />
        ) : null}
        {section === "pending" ? (
          <PendingSection
            matches={pending}
            players={players}
            loading={pendingLoading}
            error={pendingError}
            reload={reloadPending}
          />
        ) : null}
        {section === "teams" ? <TeamsSection /> : null}
        {section === "safety" ? <SafetySection /> : null}
        {section === "maintenance" ? <MaintenanceSection onDone={() => void refreshAll()} /> : null}
      </View>
    </Page>
  );
}

/** Small uppercase label with an icon, shared by the overview tiles. */
function TileLabel({ icon, children }: { icon: IconName; children: string }) {
  return (
    <View style={styles.tileLabel}>
      <Icon name={icon} size={15} color={colors.textDim} />
      <Txt variant="head" size={11} color={colors.textDim} style={{ letterSpacing: 1.2 }}>
        {children.toUpperCase()}
      </Txt>
    </View>
  );
}

const PHASES = [
  { key: "regular", label: "Regular" },
  { key: "finals", label: "Finals" },
  { key: "finalized", label: "Finalized" },
] as const;

function PhaseStepper({ phase }: { phase: AdminSeason["phase"] }) {
  const current = PHASES.findIndex((p) => p.key === phase);
  return (
    <View
      style={styles.stepper}
      accessibilityRole="progressbar"
      accessibilityLabel={`Season phase: ${PHASES[current]?.label}`}
    >
      {PHASES.map((p, i) => {
        const done = i < current;
        const now = i === current;
        return (
          <View key={p.key} style={styles.step}>
            <View style={styles.stepTrack}>
              {i > 0 ? (
                <View
                  style={[
                    styles.stepLine,
                    { backgroundColor: i <= current ? colors.accent : colors.surface2 },
                  ]}
                />
              ) : (
                <View style={styles.stepLineSpacer} />
              )}
              <View style={[styles.stepDot, now && styles.stepDotNow, done && styles.stepDotDone]}>
                {done ? <Icon name="check" size={10} color={colors.onAccent} stroke={3} /> : null}
              </View>
              {i < PHASES.length - 1 ? (
                <View
                  style={[
                    styles.stepLine,
                    { backgroundColor: i < current ? colors.accent : colors.surface2 },
                  ]}
                />
              ) : (
                <View style={styles.stepLineSpacer} />
              )}
            </View>
            <Txt
              variant={now ? "head" : "body"}
              size={11}
              color={now ? colors.text : done ? colors.textDim : colors.textFaint}
              style={{ marginTop: 6 }}
            >
              {p.label}
            </Txt>
          </View>
        );
      })}
    </View>
  );
}

function daysLeft(end: Date | null): string | null {
  if (!end) return null;
  const days = Math.ceil((end.getTime() - Date.now()) / 86_400_000);
  if (days < 0) return "ended";
  if (days === 0) return "ends today";
  return `${days} day${days === 1 ? "" : "s"} left`;
}

function SeasonPhaseTile({
  season,
  seasons,
  loading,
  error,
  onRetry,
  actions,
  onCreate,
}: {
  season: AdminSeason | null;
  seasons: AdminSeason[];
  loading: boolean;
  /** First load failed — don't claim "no active season" when we simply don't know. */
  error: string | null;
  onRetry: () => void;
  actions: SeasonActions;
  onCreate: () => void;
}) {
  const router = useRouter();
  const busy = actions.busy !== null;
  const busyFor = (action: string) =>
    actions.busy?.id === season?.id && actions.busy?.action === action;

  if (loading) {
    return (
      <Card style={[styles.tile, styles.fill]}>
        <TileLabel icon="seasons">Season</TileLabel>
        <Skeleton width="60%" height={18} />
        <Skeleton width="80%" height={30} />
        <Skeleton width={120} height={30} />
      </Card>
    );
  }

  if (error) {
    return (
      <Card style={[styles.tile, styles.fill]}>
        <TileLabel icon="seasons">Season</TileLabel>
        <Txt size={12.5} color={colors.loss} style={{ lineHeight: 18 }}>
          {error}
        </Txt>
        <Button size="sm" variant="dark" icon="refresh" onPress={onRetry}>
          Retry
        </Button>
      </Card>
    );
  }

  if (!season) {
    const next = readySeasons(seasons)[0];
    return (
      <Card style={[styles.tile, styles.fill, styles.warnTile]}>
        <TileLabel icon="seasons">Season</TileLabel>
        <View>
          <Txt variant="head" size={16}>
            No active season
          </Txt>
          <Txt size={12} color={colors.textDim} style={{ marginTop: 3, lineHeight: 17 }}>
            Matches can't be logged until one is active.
          </Txt>
        </View>
        {next ? (
          <Button
            size="sm"
            icon="check"
            loading={busyFor("activate")}
            disabled={busy}
            onPress={() => actions.activate(next)}
          >
            {`Activate ${next.name}`}
          </Button>
        ) : (
          <Button size="sm" icon="plus" onPress={onCreate}>
            Create a season
          </Button>
        )}
      </Card>
    );
  }

  const left = daysLeft(season.end);
  return (
    <Card style={[styles.tile, styles.fill]}>
      <View style={styles.tileTop}>
        <TileLabel icon="seasons">Season</TileLabel>
        <Tag tone={season.phase === "finals" ? "gold" : "accent"}>
          {season.phase === "finals" ? "FINALS" : "LIVE"}
        </Tag>
      </View>
      <View>
        <Txt variant="head" size={16} numberOfLines={1}>
          {season.name}
        </Txt>
        <Txt variant="mono" size={11} color={colors.textDim} style={{ marginTop: 3 }}>
          Ends {formatDay(season.end)}
          {left ? ` · ${left}` : ""}
        </Txt>
      </View>
      <PhaseStepper phase={season.phase} />
      <View style={styles.tileActions}>
        {season.phase === "regular" ? (
          <Button
            size="sm"
            icon="trophy"
            loading={busyFor("finals")}
            disabled={busy}
            onPress={() => actions.startFinals(season)}
          >
            Start finals
          </Button>
        ) : (
          <Button
            size="sm"
            variant="dark"
            icon="trophy"
            onPress={() => router.push("/(app)/finals")}
          >
            Bracket
          </Button>
        )}
        <Button
          size="sm"
          variant={season.phase === "finals" ? "primary" : "ghost"}
          loading={busyFor("finalize")}
          disabled={busy}
          onPress={() => actions.finalize(season)}
        >
          Finalize
        </Button>
      </View>
    </Card>
  );
}

function QueueTile({
  loading,
  error,
  count,
  disputed,
  compact,
  onPress,
}: {
  loading: boolean;
  error: string | null;
  count: number;
  disputed: number;
  /** Half-width phone tile: shorter copy. */
  compact?: boolean;
  onPress: () => void;
}) {
  const clear = !loading && !error && count === 0;
  return (
    <Card
      onPress={onPress}
      accessibilityLabel={
        loading
          ? "Results queue, loading"
          : `Results queue: ${count} waiting, ${disputed} disputed. Review`
      }
      style={[styles.tile, styles.fill, disputed > 0 && styles.alertTile]}
    >
      <TileLabel icon="inbox">{compact ? "Results" : "Results queue"}</TileLabel>
      {loading ? (
        <>
          <Skeleton width={56} height={34} />
          <Skeleton width="70%" height={12} />
        </>
      ) : error ? (
        <Txt size={12.5} color={colors.loss} style={{ lineHeight: 18 }}>
          {error}
        </Txt>
      ) : (
        <View style={styles.queueRow}>
          <CountUp
            value={count}
            from={0}
            variant="monoBold"
            size={36}
            color={clear ? colors.textDim : colors.text}
          />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Txt size={12.5} color={colors.textDim}>
              {clear ? "All clear" : compact ? "waiting" : "waiting for review"}
            </Txt>
            {disputed > 0 ? (
              <Txt variant="head" size={12.5} color={colors.loss}>
                {disputed} disputed
              </Txt>
            ) : null}
          </View>
        </View>
      )}
      <View style={styles.tileLink}>
        <Txt variant="head" size={12.5} color={colors.accent}>
          {clear ? "Open queue" : "Review"}
        </Txt>
        <Icon name="arrowRight" size={14} color={colors.accent} />
      </View>
    </Card>
  );
}

/** Round the cup is in: the first round with an undecided, playable tie. */
function cupRoundLabel(cup: CupState): string {
  if (cup.status === "complete") return "Complete";
  const index = cup.rounds.findIndex((round) =>
    round.some((tie) => tie.winnerId === null && tie.aId && tie.bId),
  );
  const total = cup.rounds.length;
  return index >= 0 ? `Round ${index + 1} of ${total}` : "Live";
}

function CupTile({
  season,
  cup,
  compact,
  onChanged,
}: {
  season: AdminSeason | null;
  cup: CupState | null | undefined;
  /** Half-width phone tile: no explainer line. */
  compact?: boolean;
  onChanged: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const status = useMemo(() => {
    if (!season) return { title: "No active season", body: "A cup needs an active season." };
    if (cup === undefined) return null;
    if (cup === null)
      return { title: "Not drawn", body: "Knockout for every member, played alongside the table." };
    return {
      title: cupRoundLabel(cup),
      body:
        cup.status === "live" ? "Cup games count toward ELO and the table." : "The cup is decided.",
    };
  }, [season, cup]);

  function confirmStart() {
    if (!season) return;
    confirmAction({
      title: "Draw the mid-season cup?",
      message: `Draws a random knockout bracket from every member for ${season.name}. Cup games count toward ELO and the table. The draw can't be redone.`,
      confirmLabel: "Draw cup",
      destructive: true,
      onConfirm: async () => {
        setBusy(true);
        try {
          await startCup(season.id);
          toast.success("Cup drawn", {
            action: { label: "Bracket", onPress: () => router.push("/(app)/cup") },
          });
          onChanged();
        } catch (error: unknown) {
          showAlert("Couldn't draw the cup", callableErrorMessage(error));
        } finally {
          setBusy(false);
        }
      },
    });
  }

  return (
    <Card style={[styles.tile, styles.fill]}>
      <View style={styles.tileTop}>
        <TileLabel icon="trophy">{compact ? "Cup" : "Mid-season cup"}</TileLabel>
        {cup && cup.status === "live" ? <Tag tone="gold">LIVE</Tag> : null}
      </View>
      {status === null ? (
        <>
          <Skeleton width="50%" height={18} />
          <Skeleton width="80%" height={12} />
        </>
      ) : (
        <View>
          <Txt variant="head" size={16}>
            {status.title}
          </Txt>
          {compact ? null : (
            <Txt size={12} color={colors.textDim} style={{ marginTop: 3, lineHeight: 17 }}>
              {status.body}
            </Txt>
          )}
        </View>
      )}
      {season && cup ? (
        <Button size="sm" variant="dark" icon="trophy" onPress={() => router.push("/(app)/cup")}>
          {compact ? "Bracket" : "View bracket"}
        </Button>
      ) : season && cup === null ? (
        <Button size="sm" variant="dark" icon="dice" loading={busy} onPress={confirmStart}>
          Draw cup
        </Button>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  tabs: { marginTop: spacing.x2, marginBottom: spacing.x2 },
  tile: { gap: spacing.md },
  tileTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  tileLabel: { flexDirection: "row", alignItems: "center", gap: 6 },
  tileActions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: "auto" },
  tileLink: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: "auto" },
  warnTile: { borderColor: withAlpha(colors.gold, 0.45) },
  alertTile: { borderColor: withAlpha(colors.loss, 0.45) },
  queueRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  stepper: { flexDirection: "row" },
  step: { flex: 1, alignItems: "center" },
  stepTrack: { flexDirection: "row", alignItems: "center", alignSelf: "stretch" },
  stepLine: { flex: 1, height: 2, borderRadius: 1 },
  stepLineSpacer: { flex: 1 },
  stepDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: colors.surface3,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  stepDotNow: {
    borderColor: colors.accent,
    backgroundColor: withAlpha(colors.accent, 0.2),
  },
  stepDotDone: { borderColor: colors.accent, backgroundColor: colors.accent },
});
