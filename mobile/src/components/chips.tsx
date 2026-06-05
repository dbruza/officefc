/** Small inline indicators: form chips, ELO delta, leaderboard movement. */
import { View } from "react-native";
import { Txt } from "./Txt";
import { colors, resultColor } from "@/theme";
import type { MatchResult } from "@/types";

/** A run of W/D/L chips, faded oldest→newest like the prototype. */
export function FormChips({
  results = [],
  size = 22,
  gap = 4,
}: {
  results?: MatchResult[];
  size?: number;
  gap?: number;
}) {
  if (results.length === 0) {
    return (
      <Txt color={colors.textFaint} size={12}>
        No games yet
      </Txt>
    );
  }
  return (
    <View style={{ flexDirection: "row", gap }}>
      {results.map((r, i) => (
        <View
          key={i}
          style={{
            width: size,
            height: size,
            borderRadius: 6,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: resultColor[r],
            opacity: 0.45 + (i + 1) / (results.length * 1.8),
          }}
        >
          <Txt
            variant="monoBold"
            size={Math.round(size * 0.5)}
            color={r === "D" ? "#0a0c10" : colors.onAccent}
          >
            {r}
          </Txt>
        </View>
      ))}
    </View>
  );
}

/** Signed ELO change, coloured by sign. */
export function EloDelta({ delta, size = 13 }: { delta: number; size?: number }) {
  const pos = delta >= 0;
  return (
    <Txt variant="monoBold" size={size} color={pos ? colors.win : colors.loss}>
      {pos ? "▲" : "▼"}
      {pos ? "+" : ""}
      {delta}
    </Txt>
  );
}

/** Rank movement vs. last week. */
export function Movement({ move }: { move?: number }) {
  if (!move) {
    return (
      <Txt variant="mono" size={12} color={colors.textFaint}>
        —
      </Txt>
    );
  }
  const up = move > 0;
  return (
    <Txt variant="monoBold" size={12} color={up ? colors.win : colors.loss}>
      {up ? "▲" : "▼"}
      {Math.abs(move)}
    </Txt>
  );
}
