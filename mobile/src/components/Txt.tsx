/**
 * Themed Text. RN has no CSS classes, so font-family + base colour are applied here.
 * `variant` maps to the prototype's type roles; `mono` swaps to tabular JetBrains Mono.
 */
import { Text, TextProps, StyleSheet } from "react-native";
import { colors, fonts } from "@/theme";

type Variant = "body" | "bodyMedium" | "head" | "headSemi" | "mono" | "monoBold";

export interface TxtProps extends TextProps {
  variant?: Variant;
  color?: string;
  size?: number;
  /** Convenience: render with the mono family (overrides variant family). */
  mono?: boolean;
}

const familyFor: Record<Variant, string> = {
  body: fonts.body,
  bodyMedium: fonts.bodyMedium,
  head: fonts.head,
  headSemi: fonts.headSemi,
  mono: fonts.mono,
  monoBold: fonts.monoBold,
};

export function Txt({ variant = "body", color, size, mono, style, ...rest }: TxtProps) {
  const family = mono ? fonts.mono : familyFor[variant];
  return (
    <Text
      {...rest}
      style={[
        styles.base,
        { fontFamily: family, color: color ?? colors.text },
        size != null && { fontSize: size },
        style,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  base: {
    fontSize: 14,
    color: colors.text,
  },
});
