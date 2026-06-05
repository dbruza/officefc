/** Player avatar — initials on a colour gradient, with an optional jersey badge. */
import { View, StyleSheet } from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { Txt } from "./Txt";
import { colors } from "@/theme";
import { shade } from "@/lib/color";
import { initialsOf, type Player } from "@/types";

export interface AvatarProps {
  player: Player | null | undefined;
  size?: number;
  ring?: boolean;
  jersey?: boolean;
}

export function Avatar({ player, size = 40, ring = false, jersey = false }: AvatarProps) {
  if (!player) return null;
  const fs = Math.round(size * 0.38);
  const initials = player.initials ?? initialsOf(player.name);
  const gradId = `av-${player.id}`;

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
          ring && {
            borderWidth: 2,
            borderColor: player.color,
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
});
