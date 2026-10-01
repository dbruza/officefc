/**
 * Goals input shared by the manual wizard and the photo flow: labelled −/+ buttons, a
 * typed field, Enter to move on (`onSubmitEditing`), and ↑/↓ to step on web. Button and
 * arrow changes roll the digit (new value slides in from below when it goes up, from
 * above when it goes down) so a tap visibly lands; typing doesn't animate, it would
 * jitter under the caret.
 */
import { useEffect, useRef, useState, type Ref } from "react";
import {
  Platform,
  StyleSheet,
  TextInput,
  View,
  type NativeSyntheticEvent,
  type TextInputKeyPressEventData,
  type TextStyle,
} from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { Icon } from "./Icon";
import { Interactive } from "./Interactive";
import { colors, fonts, radius } from "@/theme";
import { webStyle } from "@/lib/web";

export interface ScoreStepperProps {
  value: number;
  onChange: (value: number) => void;
  /** Whose goals these are, for assistive labels: "Sam's goals". */
  label: string;
  /** Digit colour (e.g. accent when the value differs from an AI suggestion). */
  color?: string;
  size?: "md" | "lg";
  max?: number;
  autoFocus?: boolean;
  inputRef?: Ref<TextInput>;
  /** Enter / the keyboard's return key — move to the next field or submit. */
  onSubmitEditing?: () => void;
  returnKeyType?: "next" | "done" | "go";
}

export function ScoreStepper({
  value,
  onChange,
  label,
  color = colors.text,
  size = "md",
  max = 99,
  autoFocus,
  inputRef,
  onSubmitEditing,
  returnKeyType = "next",
}: ScoreStepperProps) {
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState(String(value));
  const reduced = useReducedMotion();
  const offset = useSharedValue(0);
  const previous = useRef(value);
  const typed = useRef(false);
  const dims = size === "lg" ? LG : MD;

  useEffect(() => {
    if (value === previous.current) return;
    const direction = value > previous.current ? 1 : -1;
    previous.current = value;
    if (!focused) setDraft(String(value));
    if (typed.current || reduced) {
      typed.current = false;
      return;
    }
    // Start a little below (up) / above (down) and settle — the "roll".
    offset.value = direction * dims.roll;
    offset.value = withTiming(0, { duration: 240, easing: Easing.out(Easing.cubic) });
  }, [value, focused, reduced, offset, dims.roll]);

  const rollStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: offset.value }],
    opacity: 1 - Math.min(0.7, Math.abs(offset.value) / (dims.roll * 1.4)),
  }));

  const step = (delta: number) => {
    const next = Math.max(0, Math.min(max, value + delta));
    if (next !== value) onChange(next);
  };

  const onKeyPress = (event: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
    const key = event.nativeEvent.key;
    if (key === "ArrowUp" || key === "ArrowDown") {
      event.preventDefault();
      step(key === "ArrowUp" ? 1 : -1);
      setDraft(String(Math.max(0, Math.min(max, value + (key === "ArrowUp" ? 1 : -1)))));
    }
  };

  return (
    <View style={styles.row}>
      <StepButton
        icon="minus"
        size={dims.button}
        label={`Decrease ${label}`}
        disabled={value <= 0}
        onPress={() => step(-1)}
      />
      <Animated.View style={[styles.digitWrap, { height: dims.font * 1.3 }, rollStyle]}>
        <TextInput
          ref={inputRef}
          value={focused ? draft : String(value)}
          onChangeText={(text) => {
            const digits = text.replace(/[^0-9]/g, "").slice(0, 2);
            setDraft(digits);
            typed.current = true;
            const n = digits === "" ? 0 : Math.min(max, Number.parseInt(digits, 10));
            if (n !== value) onChange(n);
            else typed.current = false;
          }}
          onFocus={() => {
            setDraft(String(value));
            setFocused(true);
          }}
          onBlur={() => {
            setFocused(false);
            setDraft(String(value));
          }}
          onKeyPress={onKeyPress}
          onSubmitEditing={onSubmitEditing}
          // Moving on is explicit (focus the next field / submit), so don't blur on Enter.
          // RN-web still reads the legacy prop; native reads submitBehavior.
          submitBehavior={onSubmitEditing ? "submit" : "blurAndSubmit"}
          {...(IS_WEB && onSubmitEditing ? { blurOnSubmit: false } : null)}
          returnKeyType={returnKeyType}
          keyboardType="number-pad"
          inputMode="numeric"
          selectTextOnFocus
          autoFocus={autoFocus}
          accessibilityLabel={label}
          style={[
            styles.input,
            { color, fontSize: dims.font, width: dims.font * 1.7 },
            webStyle({ outlineStyle: "none" }) as TextStyle,
          ]}
        />
      </Animated.View>
      <StepButton
        icon="plus"
        size={dims.button}
        label={`Increase ${label}`}
        disabled={value >= max}
        onPress={() => step(1)}
      />
    </View>
  );
}

function StepButton({
  icon,
  size,
  label,
  disabled,
  onPress,
}: {
  icon: "plus" | "minus";
  size: number;
  label: string;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Interactive
      onPress={onPress}
      disabled={disabled}
      accessibilityLabel={label}
      pressScale={0.9}
      // Keep focus in the score field on web so ↑/↓ and Enter keep working after a click.
      focusable={false}
      style={[
        styles.button,
        { width: size, height: size, borderRadius: size * 0.32 },
        disabled && { opacity: 0.35 },
      ]}
      hoverStyle={{ backgroundColor: colors.surface3, borderColor: colors.lineStrong }}
    >
      <Icon name={icon} size={size * 0.45} stroke={2.6} color={colors.text} />
    </Interactive>
  );
}

const IS_WEB = Platform.OS === "web";
const MD = { button: 38, font: 34, roll: 12 };
const LG = { button: 46, font: 46, roll: 16 };

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    maxWidth: "100%",
  },
  digitWrap: { justifyContent: "center", overflow: "visible" },
  input: {
    minWidth: 0,
    textAlign: "center",
    fontFamily: fonts.monoBold,
    paddingVertical: 0,
    borderRadius: radius.sm,
  },
  button: {
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface2,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
});
