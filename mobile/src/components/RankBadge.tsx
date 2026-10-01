/** Numeric rank chip; top-3 get medal colours. */
import { View } from "react-native";
import { Txt } from "./Txt";
import { colors } from "@/theme";

const MEDAL: Record<number, string> = { 1: colors.gold, 2: colors.silver, 3: colors.bronze };

export function RankBadge({ rank, size = 26 }: { rank: number; size?: number }) {
  const medal = rank <= 3;
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: 8,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: medal ? MEDAL[rank] : colors.surface2,
        borderWidth: medal ? 0 : 1,
        borderColor: colors.line,
      }}
    >
      <Txt variant="monoBold" size={size * 0.48} color={medal ? colors.onAccent : colors.textDim}>
        {rank}
      </Txt>
    </View>
  );
}
