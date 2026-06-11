/** Silverware podium — trophy over the champion, silver/bronze medal blocks beside. */
import { Pressable, StyleSheet, View } from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { Avatar } from "./Avatar";
import { Icon, type IconName } from "./Icon";
import { Txt } from "./Txt";
import { colors } from "@/theme";
import { mix, withAlpha } from "@/lib/color";
import { firstName } from "@/lib/format";
import type { Player } from "@/types";

export const MEDAL: Record<number, { color: string; label: string; icon: IconName }> = {
  1: { color: "#ffd24a", label: "Champion", icon: "trophy" },
  2: { color: "#cdd6e0", label: "Runner-up", icon: "medal" },
  3: { color: "#e0935b", label: "Third", icon: "medal" },
};

export interface PodiumEntry {
  player: Player;
  elo: number;
}

const BLOCK_HEIGHT: Record<number, number> = { 1: 92, 2: 64, 3: 48 };

/** `entries` is the top three in rank order; renders silver–gold–bronze. */
export function Podium({
  entries,
  onPick,
}: {
  entries: PodiumEntry[];
  onPick?: (playerId: string) => void;
}) {
  if (entries.length < 3) return null;
  const lineup = [
    { entry: entries[1], rank: 2 },
    { entry: entries[0], rank: 1 },
    { entry: entries[2], rank: 3 },
  ];
  return (
    <View style={styles.row}>
      {lineup.map(({ entry, rank }) => {
        const medal = MEDAL[rank];
        return (
          <Pressable
            key={entry.player.id}
            onPress={onPick ? () => onPick(entry.player.id) : undefined}
            style={styles.column}
          >
            <View style={styles.trophySlot}>
              {rank === 1 ? <Icon name="trophy" size={22} color={medal.color} /> : null}
            </View>
            <Avatar player={entry.player} size={rank === 1 ? 54 : 44} ring jersey />
            <View style={styles.nameBlock}>
              <Txt variant="bodyMedium" size={12.5} numberOfLines={1}>
                {firstName(entry.player.name)}
              </Txt>
              <Txt variant="monoBold" size={11} color={colors.textDim}>
                {entry.elo}
              </Txt>
            </View>
            <View
              style={[
                styles.block,
                { height: BLOCK_HEIGHT[rank], borderColor: withAlpha(medal.color, 0.3) },
              ]}
            >
              <Svg width="100%" height="100%" style={StyleSheet.absoluteFill}>
                <Defs>
                  <LinearGradient id={`podium-${rank}`} x1="0" y1="0" x2="0" y2="1">
                    <Stop offset="0" stopColor={mix(colors.surface2, medal.color, 20)} />
                    <Stop offset="1" stopColor={colors.surface} />
                  </LinearGradient>
                </Defs>
                <Rect x="0" y="0" width="100%" height="100%" fill={`url(#podium-${rank})`} />
              </Svg>
              <Txt
                variant="monoBold"
                size={rank === 1 ? 26 : 20}
                color={medal.color}
                style={{ lineHeight: rank === 1 ? 26 : 20 }}
              >
                {rank}
              </Txt>
              <Icon name={medal.icon} size={15} color={medal.color} />
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 9,
  },
  column: {
    flex: 1,
    alignItems: "center",
    gap: 7,
  },
  trophySlot: {
    height: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  nameBlock: {
    alignItems: "center",
    alignSelf: "stretch",
  },
  block: {
    alignSelf: "stretch",
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    borderWidth: 1,
    borderBottomWidth: 0,
    overflow: "hidden",
    alignItems: "center",
    gap: 4,
    paddingTop: 9,
  },
});
