/**
 * Pressable with the full interaction set: hover (web), press scale, focus-visible ring
 * (global CSS in public/index.html), pointer cursor, and a button role by default.
 * react-native-web passes `hovered`/`focused` to the style callback; native only sees
 * `pressed`, where we fall back to the old opacity dip.
 */
import type { ReactNode } from "react";
import {
  Platform,
  Pressable,
  type PressableProps,
  type PressableStateCallbackType,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { elevation } from "@/theme";
import { webStyle, webTransition } from "@/lib/web";

export interface InteractionState {
  pressed: boolean;
  hovered: boolean;
  focused: boolean;
}

export interface InteractiveProps extends Omit<PressableProps, "style" | "children"> {
  style?: StyleProp<ViewStyle> | ((state: InteractionState) => StyleProp<ViewStyle>);
  /** Merged while the pointer is over it (web). */
  hoverStyle?: StyleProp<ViewStyle>;
  /** Merged while pressed. */
  pressedStyle?: StyleProp<ViewStyle>;
  /** Scale while pressed; pass 1 to disable. */
  pressScale?: number;
  /** Rise 2px with a soft shadow on hover — for cards and tiles. */
  lift?: boolean;
  children?: ReactNode | ((state: InteractionState) => ReactNode);
}

const IS_WEB = Platform.OS === "web";
const hoverShadow = webStyle({ boxShadow: elevation.hover });

function toState(raw: PressableStateCallbackType, disabled: boolean): InteractionState {
  const s = raw as PressableStateCallbackType & { hovered?: boolean; focused?: boolean };
  return {
    pressed: !disabled && s.pressed,
    hovered: !disabled && !!s.hovered,
    focused: !!s.focused,
  };
}

export function Interactive({
  style,
  hoverStyle,
  pressedStyle,
  pressScale = 0.98,
  lift = false,
  disabled,
  accessibilityRole = "button",
  children,
  ...rest
}: InteractiveProps) {
  const isDisabled = !!disabled;
  const a11y = { disabled: isDisabled, ...rest.accessibilityState };
  return (
    <Pressable
      {...rest}
      disabled={disabled}
      accessibilityRole={accessibilityRole}
      accessibilityState={a11y}
      // react-native-web ignores accessibilityState; mirror it as aria-* so selected tabs,
      // busy buttons and disabled controls are announced on web too.
      aria-disabled={a11y.disabled || undefined}
      aria-selected={a11y.selected}
      aria-busy={a11y.busy || undefined}
      aria-checked={a11y.checked}
      aria-expanded={a11y.expanded}
      style={(raw) => {
        const state = toState(raw, isDisabled);
        const transform: ({ translateY: number } | { scale: number })[] = [];
        if (lift && state.hovered && !state.pressed) transform.push({ translateY: -2 });
        if (state.pressed && pressScale !== 1) transform.push({ scale: pressScale });
        return [
          webTransition,
          webStyle({ cursor: isDisabled ? "not-allowed" : "pointer" }),
          typeof style === "function" ? style(state) : style,
          state.hovered && hoverStyle,
          lift && state.hovered && hoverShadow,
          state.pressed && pressedStyle,
          !IS_WEB && state.pressed && { opacity: 0.86 },
          transform.length ? { transform } : null,
        ];
      }}
    >
      {(raw) => {
        const state = toState(raw, isDisabled);
        return typeof children === "function" ? children(state) : children;
      }}
    </Pressable>
  );
}
