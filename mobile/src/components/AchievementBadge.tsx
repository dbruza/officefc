/** A profile achievement tile — unlock state, accent icon, progress toward the goal. */
import { StyleSheet, View } from "react-native";
import { Icon } from "./Icon";
import { Txt } from "./Txt";
import { colors, radius } from "@/theme";
import { withAlpha } from "@/lib/color";
import type { Achievement } from "@/lib/awards";

export function AchievementBadge({ achievement }: { achievement: Achievement }) {
  const locked = !achievement.unlocked;
  return (
    <View
      style={[
        styles.card,
        { borderColor: locked ? colors.line : withAlpha(achievement.accent, 0.35) },
      ]}
    >
      <View style={styles.head}>
        <View
          style={[
            styles.iconTile,
            locked
              ? { backgroundColor: colors.surface2, borderColor: colors.line }
              : {
                  backgroundColor: withAlpha(achievement.accent, 0.14),
                  borderColor: withAlpha(achievement.accent, 0.3),
                },
          ]}
        >
          <Icon
            name={achievement.icon}
            size={21}
            color={locked ? colors.textFaint : achievement.accent}
          />
        </View>
        {achievement.unlocked ? (
          <View style={[styles.check, { backgroundColor: achievement.accent }]}>
            <Icon name="check" size={13} stroke={3} color={colors.onAccent} />
          </View>
        ) : (
          <Txt variant="monoBold" size={11} color={colors.textDim}>
            {achievement.cur}/{achievement.goal}
          </Txt>
        )}
      </View>
      <View style={{ minWidth: 0 }}>
        <Txt
          variant="head"
          size={13.5}
          color={locked ? colors.textDim : colors.text}
          numberOfLines={1}
        >
          {achievement.name}
        </Txt>
        <Txt size={11} color={colors.textFaint} style={{ marginTop: 1 }}>
          {achievement.desc}
        </Txt>
      </View>
      {locked && !achievement.oneShot ? (
        <View style={styles.track}>
          <View
            style={[
              styles.fill,
              { width: `${achievement.pct}%`, backgroundColor: achievement.accent },
            ]}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderRadius: radius.lg,
    paddingVertical: 13,
    paddingHorizontal: 12,
    gap: 9,
    minWidth: 0,
  },
  head: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  iconTile: {
    width: 40,
    height: 40,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  check: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  track: {
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.surface2,
    overflow: "hidden",
  },
  fill: {
    height: "100%",
    borderRadius: radius.pill,
    opacity: 0.75,
  },
});
