/** One row in the season's recent-results feed: both players, score, ELO swings. */
import { Pressable, StyleSheet, View } from "react-native";
import { Avatar } from "./Avatar";
import { EloDelta } from "./chips";
import { Txt } from "./Txt";
import { colors, radius } from "@/theme";
import { firstName } from "@/lib/format";
import type { LeagueMatch } from "@/lib/league";
import type { Player } from "@/types";

function Side({
  player,
  win,
  delta,
  end = false,
}: {
  player: Player;
  win: boolean;
  delta: number | null;
  end?: boolean;
}) {
  return (
    <View style={[styles.side, end && { flexDirection: "row-reverse" }]}>
      <Avatar player={player} size={30} ring={win} />
      <View style={{ minWidth: 0, alignItems: end ? "flex-end" : "flex-start" }}>
        <Txt
          variant={win ? "head" : "bodyMedium"}
          size={13}
          color={win ? colors.text : colors.textDim}
          numberOfLines={1}
        >
          {firstName(player.name)}
        </Txt>
        <View style={{ marginTop: 1 }}>{delta !== null ? <EloDelta delta={delta} /> : null}</View>
      </View>
    </View>
  );
}

export function SeasonMatchRow({
  match,
  playerA,
  playerB,
  onPress,
}: {
  match: LeagueMatch;
  playerA: Player;
  playerB: Player;
  onPress?: () => void;
}) {
  const aWin = match.aGoals > match.bGoals;
  const bWin = match.bGoals > match.aGoals;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.row, pressed && { opacity: 0.9 }]}>
      <Side player={playerA} win={aWin} delta={match.aDelta} />
      <View style={styles.centre}>
        <Txt variant="monoBold" size={19} numberOfLines={1}>
          <Txt variant="monoBold" size={19} color={aWin ? colors.text : colors.textDim}>
            {match.aGoals}
          </Txt>
          <Txt variant="monoBold" size={19} color={colors.textFaint}>
            –
          </Txt>
          <Txt variant="monoBold" size={19} color={bWin ? colors.text : colors.textDim}>
            {match.bGoals}
          </Txt>
        </Txt>
        <Txt size={9.5} color={colors.textFaint} numberOfLines={1} style={{ marginTop: 3 }}>
          {match.date
            ? match.date.toLocaleDateString("en-GB", { day: "numeric", month: "short" })
            : "—"}
        </Txt>
      </View>
      <Side player={playerB} win={bWin} delta={match.bDelta} end />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 9,
    paddingHorizontal: 12,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
  },
  side: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  centre: {
    minWidth: 62,
    flexShrink: 0,
    alignItems: "center",
  },
});
