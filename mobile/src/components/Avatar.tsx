/** Player avatar — initials on a colour gradient, with an optional jersey badge. */
import { useId } from "react";
import { View, StyleSheet } from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { Txt } from "./Txt";
import { Icon } from "./Icon";
import { colors } from "@/theme";
import { shade, withAlpha } from "@/lib/color";
import { initialsOf, type Player } from "@/types";

export interface AvatarProps {
  player: Player | null | undefined;
  size?: number;
  ring?: boolean;
  jersey?: boolean;
  /** Reigning-champion treatment: gold ring + trophy badge. */
  champion?: boolean;
}

export function Avatar({
  player,
  size = 40,
  ring = false,
  jersey = false,
  champion = false,
}: AvatarProps) {
  const uniqueId = useId().replace(/:/g, "");
  if (!player) return null;
  const fs = Math.round(size * 0.38);
  const initials = player.initials ?? initialsOf(player.name);
  const gradId = `av-${player.id}-${uniqueId}`;

  return (
    <View style={{ width: size, height: size, flexShrink: 0 }}>
      <View
        style={[
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            alignItems: "center",
            justifyContent: "center",
            overflow: "hidden",
          },
          (ring || champion) && {
            borderWidth: 2,
            borderColor: champion ? colors.gold : player.color,
          },
        ]}
      >
        {/* gradient fill behind the initials */}
        <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
          <Defs>
            <LinearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0" stopColor={player.color} />
              <Stop offset="1" stopColor={shade(player.color, -28)} />
            </LinearGradient>
          </Defs>
          <Rect x="0" y="0" width={size} height={size} fill={`url(#${gradId})`} />
        </Svg>
        <Txt variant="head" color={colors.onAccent} size={fs} style={{ letterSpacing: -0.4 }}>
          {initials}
        </Txt>
      </View>
      {jersey && (
        <View style={styles.jersey}>
          <Txt variant="monoBold" color={colors.textDim} size={9}>
            {player.jersey}
          </Txt>
        </View>
      )}
      {champion && (
        <View style={styles.trophy}>
          <Icon name="trophy" size={9.5} color={colors.gold} stroke={2.5} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  jersey: {
    position: "absolute",
    bottom: -3,
    right: -3,
    minWidth: 16,
    height: 16,
    paddingHorizontal: 3,
    borderRadius: 8,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: "center",
    justifyContent: "center",
  },
  trophy: {
    position: "absolute",
    top: -3,
    right: -3,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: withAlpha(colors.gold, 0.45),
    alignItems: "center",
    justifyContent: "center",
  },
});
