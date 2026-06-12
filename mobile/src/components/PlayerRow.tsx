/** Reusable leaderboard / list row: rank, avatar, name, form-or-record, ELO, movement. */
import { Pressable, View, StyleSheet } from "react-native";
import { Txt } from "./Txt";
import { Avatar } from "./Avatar";
import { RankBadge } from "./RankBadge";
import { FormChips, Movement } from "./chips";
import { colors, radius } from "@/theme";
import { mix, withAlpha } from "@/lib/color";
import type { MatchResult, Player } from "@/types";

export interface PlayerRowProps {
  player: Player;
  /** Omitted for unranked players — renders an em dash. */
  elo?: number;
  rank?: number;
  move?: number;
  record?: { w: number; d: number; l: number };
  form?: MatchResult[];
  you?: boolean;
  compact?: boolean;
  /** Reigning-champion treatment on the avatar (gold ring + trophy badge). */
  champion?: boolean;
  onPress?: () => void;
}

export function PlayerRow({
  player,
  elo,
  rank,
  move,
  record,
  form,
  you,
  compact,
  champion,
  onPress,
}: PlayerRowProps) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        {
          backgroundColor: you ? mix(colors.surface, colors.accent, 9) : colors.surface,
          borderColor: you ? withAlpha(colors.accent, 0.35) : colors.line,
          opacity: pressed ? 0.9 : 1,
        },
      ]}
    >
      {rank ? <RankBadge rank={rank} /> : null}
      <Avatar player={player} size={38} jersey champion={champion} />
      <View style={styles.mid}>
        <View style={styles.nameRow}>
          <Txt variant="bodyMedium" size={14.5} numberOfLines={1} style={{ flexShrink: 1 }}>
            {player.name}
          </Txt>
          {you ? (
            <View style={styles.youTag}>
              <Txt
                variant="monoBold"
                size={8.5}
                color={colors.onAccent}
                style={{ letterSpacing: 1 }}
              >
                YOU
              </Txt>
            </View>
          ) : null}
        </View>
        {!compact ? (
          <View style={{ marginTop: 4 }}>
            {form ? (
              <FormChips results={form} size={16} gap={3} />
            ) : record ? (
              <Txt variant="mono" size={11.5} color={colors.textDim}>
                {record.w}W {record.d}D {record.l}L
              </Txt>
            ) : null}
          </View>
        ) : null}
      </View>
      <View style={styles.right}>
        <Txt
          variant="monoBold"
          size={18}
          color={elo === undefined ? colors.textFaint : colors.text}
          style={{ letterSpacing: -0.4 }}
        >
          {elo ?? "—"}
        </Txt>
        {move !== undefined ? <Movement move={move} /> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    width: "100%",
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderRadius: radius.md,
  },
  mid: { flex: 1, minWidth: 0 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  youTag: {
    backgroundColor: colors.accent,
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 5,
  },
  right: { alignItems: "flex-end", gap: 2 },
});
