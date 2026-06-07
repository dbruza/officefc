/** Labeled text input, themed to match the dark UI. */
import { useState } from "react";
import { View, TextInput, StyleSheet, type TextInputProps } from "react-native";
import { Txt } from "./Txt";
import { colors, radius, fonts } from "@/theme";
import { withAlpha } from "@/lib/color";

export interface TextFieldProps extends TextInputProps {
  label?: string;
  /** Optional hint / error shown under the field. */
  hint?: string;
  error?: boolean;
  /** Prefix glyph rendered inside the field (e.g. "@"). */
  prefix?: string;
}

export function TextField({ label, hint, error, prefix, style, onFocus, onBlur, ...rest }: TextFieldProps) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.wrap}>
      {label ? (
        <Txt variant="head" size={11} color={colors.textDim} style={styles.label}>
          {label.toUpperCase()}
        </Txt>
      ) : null}
      <View
        style={[
          styles.field,
          { borderColor: error ? colors.loss : focused ? withAlpha(colors.accent, 0.6) : colors.line },
        ]}
      >
        {prefix ? (
          <Txt variant="mono" size={15} color={colors.textFaint}>
            {prefix}
          </Txt>
        ) : null}
        <TextInput
          {...rest}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          placeholderTextColor={colors.textFaint}
          style={[styles.input, style]}
        />
      </View>
      {hint ? (
        <Txt size={11.5} color={error ? colors.loss : colors.textDim} style={{ marginTop: 5 }}>
          {hint}
        </Txt>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: "100%" },
  label: { letterSpacing: 1.2, marginBottom: 7 },
  field: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  input: {
    flex: 1,
    color: colors.text,
    fontFamily: fonts.body,
    fontSize: 15,
  },
});
