/** Labeled text input, themed to match the dark UI. */
import { useState, type Ref } from "react";
import {
  Pressable,
  View,
  TextInput,
  StyleSheet,
  type TextInputProps,
  type TextStyle,
} from "react-native";
import { Icon } from "./Icon";
import { Txt } from "./Txt";
import { colors, radius, fonts } from "@/theme";
import { withAlpha } from "@/lib/color";
import { webStyle, webTransition } from "@/lib/web";

export interface TextFieldProps extends TextInputProps {
  label?: string;
  /** Optional hint / error shown under the field. */
  hint?: string;
  error?: boolean;
  /** Prefix glyph rendered inside the field (e.g. "@"). */
  prefix?: string;
  /** Password-style field: hides input and adds a show/hide toggle. */
  secure?: boolean;
  /** Forwarded to the inner TextInput (React 19 passes `ref` as a prop) for focus chaining. */
  ref?: Ref<TextInput>;
}

export function TextField({
  label,
  hint,
  error,
  prefix,
  secure,
  style,
  onFocus,
  onBlur,
  ...rest
}: TextFieldProps) {
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(true);
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
          webTransition,
          {
            borderColor: error
              ? colors.loss
              : focused
                ? withAlpha(colors.accent, 0.6)
                : "rgba(255,255,255,0.12)",
          },
          focused &&
            webStyle({
              boxShadow: `0 0 0 3px ${withAlpha(error ? colors.loss : colors.accent, 0.14)}`,
            }),
        ]}
      >
        {prefix ? (
          <Txt variant="mono" size={15} color={colors.textFaint}>
            {prefix}
          </Txt>
        ) : null}
        <TextInput
          accessibilityLabel={label}
          {...rest}
          secureTextEntry={secure ? hidden : rest.secureTextEntry}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          placeholderTextColor={colors.textFaint}
          style={[styles.input, webStyle({ outlineStyle: "none" }) as TextStyle, style]}
        />
        {secure ? (
          <Pressable
            onPress={() => setHidden((value) => !value)}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={hidden ? "Show password" : "Hide password"}
            // hitSlop is ignored on web, so pad the target itself.
            style={{ padding: 6, margin: -6, borderRadius: radius.sm }}
          >
            <Icon name={hidden ? "eye" : "eyeOff"} size={18} color={colors.textDim} />
          </Pressable>
        ) : null}
      </View>
      {hint ? (
        <Txt
          size={11.5}
          color={error ? colors.loss : colors.textDim}
          style={{ marginTop: 5 }}
          accessibilityLiveRegion={error ? "polite" : undefined}
        >
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
