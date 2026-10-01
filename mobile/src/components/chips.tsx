/** Small inline indicators: form chips, ELO delta, leaderboard movement. */
import { View } from "react-native";
import { Txt } from "./Txt";
import { Reveal } from "./motion";
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
    <View
      style={{ flexDirection: "row", gap }}
      accessible
      accessibilityLabel={`Form: ${results.join(" ")}`}
    >
      {results.map((r, i) => (
        <Reveal key={i} from="scale" index={i} delay={80} duration={260}>
          <View
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
            <Txt variant="monoBold" size={Math.round(size * 0.5)} color={colors.onAccent}>
              {r}
            </Txt>
          </View>
        </Reveal>
      ))}
    </View>
  );
}

/**
 * Signed ELO change, coloured by sign (a zero change reads as a neutral ±0). No arrow:
 * ▲/▼ are reserved for rank movement, so "+12" can't be misread as "up 12 places".
 */
export function EloDelta({ delta, size = 13 }: { delta: number; size?: number }) {
  if (delta === 0) {
    return (
      <Txt variant="monoBold" size={size} color={colors.textDim}>
        ±0
      </Txt>
    );
  }
  const pos = delta > 0;
  return (
    <Txt variant="monoBold" size={size} color={pos ? colors.win : colors.loss}>
      {pos ? `+${delta}` : `−${Math.abs(delta)}`}
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
