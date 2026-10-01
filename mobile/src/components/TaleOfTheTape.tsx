/**
 * Head-to-head "tale of the tape": the series score (counting up), a wins/draws/losses
 * share bar from the left player's point of view, and mirrored stat bars that grow out
 * from the centre — the leader's bar in accent, the other muted.
 */
import { StyleSheet, View } from "react-native";
import { CountUp, Reveal } from "./motion";
import { GrowBar, ShareBar } from "./GrowBar";
import { Txt } from "./Txt";
import { colors, spacing } from "@/theme";

export interface TapeRow {
  key: string;
  label: string;
  a: number;
  b: number;
  /** Display text when the raw number isn't the right label (e.g. "4–1", "+12"). */
  aText?: string;
  bText?: string;
}

export function TaleOfTheTape({
  aName,
  bName,
  wins,
  draws,
  losses,
  rows,
  showScore = true,
  footnote,
}: {
  aName: string;
  bName: string;
  /** Series record from the LEFT player's point of view. */
  wins: number;
  draws: number;
  losses: number;
  rows: TapeRow[];
  /** Phones show the score in the banner above instead. */
  showScore?: boolean;
  footnote?: string;
}) {
  const played = wins + draws + losses;
  return (
    <View style={{ gap: spacing.lg }}>
      {showScore ? (
        <View style={styles.score} accessibilityLabel={`${wins} wins to ${losses}, ${draws} drawn`}>
          <View style={styles.scoreLine}>
            <CountUp
              value={wins}
              from={0}
              variant="monoBold"
              size={56}
              color={wins > losses ? colors.accent : colors.text}
              style={styles.scoreNum}
            />
            <Txt variant="monoBold" size={40} color={colors.textFaint}>
              –
            </Txt>
            <CountUp
              value={losses}
              from={0}
              variant="monoBold"
              size={56}
              color={losses > wins ? colors.accent : colors.text}
              style={styles.scoreNum}
            />
          </View>
          <Txt variant="head" size={10.5} color={colors.textDim} style={styles.kicker}>
            {draws} DRAWN · {played} PLAYED
          </Txt>
        </View>
      ) : null}

      {played > 0 ? (
        <View style={{ gap: spacing.sm }}>
          <ShareBar
            height={10}
            delay={150}
            parts={[
              { key: "w", value: wins, color: colors.win },
              { key: "d", value: draws, color: colors.draw },
              { key: "l", value: losses, color: colors.loss },
            ]}
          />
          <View style={styles.legend}>
            <Txt size={11.5} color={colors.textDim} numberOfLines={1} style={{ flexShrink: 1 }}>
              <Txt variant="monoBold" size={11.5} color={colors.win}>
                {Math.round((wins / played) * 100)}%
              </Txt>{" "}
              {aName}
            </Txt>
            <Txt size={11.5} color={colors.textFaint}>
              {Math.round((draws / played) * 100)}% drawn
            </Txt>
            <Txt
              size={11.5}
              color={colors.textDim}
              numberOfLines={1}
              style={{ flexShrink: 1, textAlign: "right" }}
            >
              {bName}{" "}
              <Txt variant="monoBold" size={11.5} color={colors.loss}>
                {Math.round((losses / played) * 100)}%
              </Txt>
            </Txt>
          </View>
        </View>
      ) : null}

      <View style={{ gap: spacing.md }}>
        {rows.map((row, i) => (
          <Reveal key={row.key} index={i} delay={120} from="fade">
            <MirrorRow row={row} delay={200 + i * 70} />
          </Reveal>
        ))}
      </View>

      {footnote ? (
        <Txt size={10.5} color={colors.textFaint} style={{ textAlign: "center" }}>
          {footnote}
        </Txt>
      ) : null}
    </View>
  );
}

function MirrorRow({ row, delay }: { row: TapeRow; delay: number }) {
  // Bars scale to the row's leader; negatives (ELO swing) draw no bar but keep their text.
  const top = Math.max(row.a, row.b, 0);
  const aShare = top > 0 ? Math.max(0, row.a) / top : 0;
  const bShare = top > 0 ? Math.max(0, row.b) / top : 0;
  const aLeads = row.a > row.b;
  const bLeads = row.b > row.a;
  const muted = colors.surface3;
  return (
    <View>
      <Txt variant="head" size={10} color={colors.textDim} style={styles.rowLabel}>
        {row.label.toUpperCase()}
      </Txt>
      <View style={styles.mirror}>
        <Txt
          variant="monoBold"
          size={15}
          color={aLeads ? colors.text : colors.textDim}
          style={[styles.value, { textAlign: "right" }]}
        >
          {row.aText ?? row.a}
        </Txt>
        <GrowBar
          value={aShare}
          from="right"
          height={8}
          delay={delay}
          color={aLeads ? colors.accent : muted}
          track="transparent"
          style={{ flex: 1 }}
        />
        <View style={styles.spine} />
        <GrowBar
          value={bShare}
          from="left"
          height={8}
          delay={delay}
          color={bLeads ? colors.accent : muted}
          track="transparent"
          style={{ flex: 1 }}
        />
        <Txt
          variant="monoBold"
          size={15}
          color={bLeads ? colors.text : colors.textDim}
          style={styles.value}
        >
          {row.bText ?? row.b}
        </Txt>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  score: { alignItems: "center" },
  scoreLine: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  scoreNum: { lineHeight: 64, letterSpacing: -1 },
  kicker: { letterSpacing: 1.2, marginTop: 2 },
  legend: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  rowLabel: { textAlign: "center", letterSpacing: 1.2, marginBottom: 6 },
  mirror: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  value: { width: 48 },
  spine: { width: 2, height: 16, borderRadius: 1, backgroundColor: colors.lineStrong },
});
