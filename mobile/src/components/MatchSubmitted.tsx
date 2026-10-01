/**
 * "Result sent" screen after logging a match (manual, auto-matchup, finals or photo).
 * Celebrates proportionally — confetti only for a win — and shows what confirmation
 * will do: the score ticks up, both ratings tween to their previewed values. Next steps
 * are one tap: Rematch (same opponent/teams, fresh score), View match, Done.
 */
import { StyleSheet, View } from "react-native";
import { Avatar } from "./Avatar";
import { Button } from "./Button";
import { Card } from "./Card";
import { EloDelta } from "./chips";
import { Icon } from "./Icon";
import { Confetti, CountUp, PulseRing, Reveal } from "./motion";
import { Page } from "./Page";
import { Txt } from "./Txt";
import { colors, spacing } from "@/theme";
import { withAlpha } from "@/lib/color";
import { firstName } from "@/lib/format";
import { useBreakpoint } from "@/lib/responsive";
import type { Player } from "@/types";

export interface MatchSubmittedProps {
  me: Player | null;
  opponent: Player;
  myGoals: number;
  opponentGoals: number;
  myTeam?: string;
  opponentTeam?: string;
  myElo: number;
  myDelta: number;
  opponentElo: number;
  opponentDelta: number;
  /** Finals tie label ("Grand Final") — finals never move ELO. */
  finalsLabel?: string | null;
  onRematch?: () => void;
  onView?: () => void;
  onDone: () => void;
}

export function MatchSubmitted({
  me,
  opponent,
  myGoals,
  opponentGoals,
  myTeam,
  opponentTeam,
  myElo,
  myDelta,
  opponentElo,
  opponentDelta,
  finalsLabel,
  onRematch,
  onView,
  onDone,
}: MatchSubmittedProps) {
  const { isTablet } = useBreakpoint();
  const result = myGoals > opponentGoals ? "win" : myGoals < opponentGoals ? "loss" : "draw";
  const tone = result === "win" ? colors.win : result === "loss" ? colors.loss : colors.draw;
  const oppName = firstName(opponent.name);
  const headline =
    result === "win" ? "Win logged!" : result === "draw" ? "Draw logged" : "Result logged";

  const footer = (
    <View style={[styles.footer, isTablet && styles.footerWide]}>
      {onRematch ? (
        <Button
          variant="dark"
          size="lg"
          icon="refresh"
          onPress={onRematch}
          style={isTablet ? undefined : styles.grow}
        >
          Rematch
        </Button>
      ) : null}
      {onView ? (
        <Button
          variant="ghost"
          size="lg"
          icon="arrowRight"
          onPress={onView}
          style={isTablet ? undefined : styles.grow}
        >
          View match
        </Button>
      ) : null}
      <Button
        size="lg"
        icon="check"
        onPress={onDone}
        style={isTablet ? { minWidth: 160 } : styles.doneFull}
      >
        Done
      </Button>
    </View>
  );

  return (
    <Page width="narrow" footer={footer} contentStyle={styles.content}>
      {result === "win" ? <Confetti count={34} spread={190} originY="22%" /> : null}
      <View style={styles.burstWrap}>
        <PulseRing size={104} color={tone} />
        <Reveal
          from="scale"
          duration={420}
          style={[styles.burst, { backgroundColor: withAlpha(tone, 0.14) }]}
        >
          <Icon name={result === "win" ? "trophy" : "check"} size={40} color={tone} stroke={2.4} />
        </Reveal>
      </View>
      <Reveal delay={120}>
        <Txt
          variant="head"
          size={28}
          style={styles.center}
          accessibilityRole="header"
          accessibilityLiveRegion="polite"
        >
          {headline}
        </Txt>
        <Txt color={colors.textDim} style={[styles.center, { marginTop: 6, lineHeight: 20 }]}>
          {finalsLabel
            ? `Sent to ${oppName} — the bracket advances once they confirm.`
            : `Sent to ${oppName} — it counts once they confirm.`}
        </Txt>
      </Reveal>

      <Reveal delay={200} style={styles.scoreRow}>
        <Side player={me} name="You" team={myTeam} />
        <View style={styles.score}>
          <CountUp value={myGoals} from={0} duration={700} variant="monoBold" size={56} />
          <Txt variant="monoBold" size={48} color={colors.textFaint}>
            :
          </Txt>
          <CountUp value={opponentGoals} from={0} duration={700} variant="monoBold" size={56} />
        </View>
        <Side player={opponent} name={oppName} team={opponentTeam} />
      </Reveal>

      <Reveal delay={300}>
        <Card style={styles.eloCard}>
          {finalsLabel ? (
            <View style={styles.eloRow}>
              <Icon name="trophy" size={18} color={colors.gold} />
              <View style={{ flex: 1 }}>
                <Txt variant="head" size={10.5} color={colors.textDim} style={styles.kicker}>
                  {finalsLabel.toUpperCase()}
                </Txt>
                <Txt variant="bodyMedium" size={14} style={{ marginTop: 3 }}>
                  No ELO change — the winner advances
                </Txt>
              </View>
            </View>
          ) : (
            <>
              <Txt variant="head" size={10.5} color={colors.textDim} style={styles.kicker}>
                ELO AFTER CONFIRMATION
              </Txt>
              <EloLine label="You" before={myElo} delta={myDelta} strong entrance />
              <EloLine label={oppName} before={opponentElo} delta={opponentDelta} entrance />
            </>
          )}
        </Card>
      </Reveal>
    </Page>
  );
}

function Side({ player, name, team }: { player: Player | null; name: string; team?: string }) {
  return (
    <View style={styles.side}>
      <Avatar player={player} size={48} jersey />
      <Txt variant="bodyMedium" size={13} style={{ marginTop: spacing.sm }} numberOfLines={1}>
        {name}
      </Txt>
      {team ? (
        <Txt size={11} color={colors.textDim} numberOfLines={1} style={{ marginTop: 2 }}>
          {team}
        </Txt>
      ) : null}
    </View>
  );
}

/**
 * "You  1532 → 1544  ▲+12" — one player's rating before → after a result. With `entrance`
 * the after-value tweens up from `before` on mount (success screen); otherwise it ticks
 * from whatever it showed last, so live previews follow each score edit.
 */
export function EloLine({
  label,
  before,
  delta,
  strong,
  entrance,
}: {
  label: string;
  before: number;
  delta: number;
  strong?: boolean;
  entrance?: boolean;
}) {
  return (
    <View style={styles.eloLine}>
      <Txt size={13} color={strong ? colors.text : colors.textDim} style={{ flex: 1 }}>
        {label}
      </Txt>
      <Txt variant="mono" size={strong ? 13.5 : 12.5} color={colors.textDim}>
        {before} →{" "}
      </Txt>
      <CountUp
        value={before + delta}
        from={entrance ? before : undefined}
        duration={entrance ? 1100 : 500}
        variant="monoBold"
        size={strong ? 17 : 13.5}
        color={strong ? colors.text : colors.textDim}
      />
      <View style={{ width: 58, alignItems: "flex-end" }}>
        <EloDelta delta={delta} size={12} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { alignItems: "center", paddingTop: spacing.x3 },
  burstWrap: {
    width: 110,
    height: 110,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.lg,
  },
  burst: {
    width: 92,
    height: 92,
    borderRadius: 46,
    alignItems: "center",
    justifyContent: "center",
  },
  center: { textAlign: "center" },
  scoreRow: {
    flexDirection: "row",
    alignItems: "center",
    width: "100%",
    maxWidth: 460,
    marginTop: spacing.x2,
    gap: spacing.sm,
  },
  score: { flexDirection: "row", alignItems: "center", gap: 4 },
  side: { flex: 1, alignItems: "center", minWidth: 0 },
  eloCard: { width: "100%", maxWidth: 460, marginTop: spacing.x2, gap: spacing.md },
  eloRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  eloLine: { flexDirection: "row", alignItems: "baseline" },
  kicker: { letterSpacing: 1.2 },
  footer: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  footerWide: { justifyContent: "flex-end", paddingBottom: spacing.lg },
  grow: { flexGrow: 1, flexBasis: 0 },
  doneFull: { width: "100%" },
});
