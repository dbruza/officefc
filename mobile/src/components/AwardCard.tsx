/**
 * A season-award row: accent icon tile, title + stat, winner + context. Tappable (hover
 * + press feedback) only when the award points at a specific match; otherwise a plain
 * row, so nothing pretends to be clickable.
 */
import { StyleSheet, View } from "react-native";
import { Avatar } from "./Avatar";
import { Icon } from "./Icon";
import { Interactive } from "./Interactive";
import { Txt } from "./Txt";
import { colors, radius } from "@/theme";
import { withAlpha } from "@/lib/color";
import { firstName } from "@/lib/format";
import { AWARD_META, type SeasonAward } from "@/lib/awards";
import type { Player } from "@/types";

export function AwardCard({
  award,
  winner,
  onPress,
}: {
  award: SeasonAward;
  winner: Player | undefined;
  onPress?: (award: SeasonAward) => void;
}) {
  const meta = AWARD_META[award.key];
  const tappable = Boolean(award.matchId && onPress);
  if (!winner) return null;
  const content = (
    <>
      <View
        style={[
          styles.iconTile,
          {
            backgroundColor: withAlpha(meta.accent, 0.14),
            borderColor: withAlpha(meta.accent, 0.32),
          },
        ]}
      >
        <Icon name={meta.icon} size={22} color={meta.accent} />
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
        <View style={styles.line}>
          <Txt variant="head" size={14} numberOfLines={1} style={{ flexShrink: 1 }}>
            {meta.title}
          </Txt>
          <Txt variant="monoBold" size={17} color={meta.accent}>
            {award.stat}
          </Txt>
        </View>
        <View style={styles.line}>
          <Txt
            size={11.5}
            color={colors.textFaint}
            numberOfLines={1}
            style={{ flexShrink: 1, marginRight: 8 }}
          >
            {meta.desc}
          </Txt>
          <View style={styles.winner}>
            <Avatar player={winner} size={19} />
            <Txt variant="bodyMedium" size={12}>
              {firstName(winner.name)}
            </Txt>
            <Txt variant="head" size={9.5} color={colors.textDim} style={styles.statLabel}>
              {award.statLabel.toUpperCase()}
            </Txt>
          </View>
        </View>
      </View>
    </>
  );
  if (!tappable) {
    return <View style={styles.card}>{content}</View>;
  }
  return (
    <Interactive
      onPress={() => onPress?.(award)}
      accessibilityRole="link"
      accessibilityLabel={`${meta.title}: ${winner.name}, ${award.stat} ${award.statLabel}. Open the match`}
      pressScale={0.99}
      style={styles.card}
      hoverStyle={styles.cardHover}
    >
      {content}
    </Interactive>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 11,
    paddingHorizontal: 13,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
  },
  cardHover: {
    backgroundColor: colors.surface2,
    borderColor: colors.lineStrong,
  },
  iconTile: {
    width: 42,
    height: 42,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  line: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  winner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  statLabel: {
    letterSpacing: 0.6,
  },
});
