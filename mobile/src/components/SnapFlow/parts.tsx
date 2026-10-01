/** Building blocks shared by the photo-flow steps: header, progress, footer, stat inputs. */
import { useEffect, useState, type ReactNode } from "react";
import { TextInput, View, type TextStyle } from "react-native";
import Animated, { type CSSAnimationKeyframes } from "react-native-reanimated";
// Primitives by path, not the barrel: the barrel re-exports SnapFlow (require cycle).
import { Button, IconButton } from "../Button";
import { ErrorCard } from "../feedback";
import { EASE_OUT } from "../motion";
import { Txt } from "../Txt";
import { colors, spacing } from "@/theme";
import { useBreakpoint } from "@/lib/responsive";
import { webStyle } from "@/lib/web";
import { parseStatInput } from "./helpers";
import { styles } from "./styles";

export const STEP_LABELS = ["Your side", "Opponent", "Teams", "Verify & submit"];

export function SnapHeader({
  onClose,
  progress,
  children,
}: {
  onClose: () => void;
  /** Index into STEP_LABELS; omitted on capture / processing. */
  progress?: number;
  children?: ReactNode;
}) {
  const { isDesktop } = useBreakpoint();
  return (
    <View>
      <View style={[styles.headerRow, isDesktop && styles.headerRowDesktop]}>
        <IconButton icon="x" accessibilityLabel="Close" onPress={onClose} iconSize={20} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt
            variant="head"
            size={isDesktop ? 26 : 21}
            accessibilityRole="header"
            numberOfLines={1}
            style={isDesktop ? { letterSpacing: -0.3 } : undefined}
          >
            Log a match
          </Txt>
          <Txt size={12} color={colors.textDim} style={{ marginTop: 2 }} numberOfLines={1}>
            {progress != null
              ? `Photo · Step ${progress + 1} of ${STEP_LABELS.length} · ${STEP_LABELS[progress]}`
              : "From a photo of the stats screen"}
          </Txt>
        </View>
      </View>
      {progress != null ? <ProgressBar current={progress} total={STEP_LABELS.length} /> : null}
      {children}
    </View>
  );
}

// Each step mounts its own page, so the newest segment fills with a one-shot animation
// rather than a transition (there's no previous width to transition from).
const FILL: CSSAnimationKeyframes = { from: { width: "0%" }, to: { width: "100%" } };

/** Segmented progress; the segment for the current step fills in as the step opens. */
export function ProgressBar({ current, total }: { current: number; total: number }) {
  return (
    <View
      style={styles.track}
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 1, max: total, now: current + 1 }}
    >
      {Array.from({ length: total }, (_, i) => (
        <View key={i} style={styles.trackSeg}>
          {i < current ? <View style={[styles.trackFill, { width: "100%" }]} /> : null}
          {i === current ? (
            <Animated.View
              style={{
                ...styles.trackFill,
                width: "100%",
                animationName: FILL,
                animationDuration: 420,
                animationDelay: 60,
                animationTimingFunction: EASE_OUT,
                animationFillMode: "backwards",
              }}
            />
          ) : null}
        </View>
      ))}
    </View>
  );
}

export function FlowFooter({
  onBack,
  onNext,
  nextLabel = "Continue",
  nextDisabled,
  hideNext,
  loading,
  error,
  onRetry,
  backLabel = "Back",
}: {
  onBack: () => void;
  onNext?: () => void;
  nextLabel?: string;
  nextDisabled?: boolean;
  hideNext?: boolean;
  loading?: boolean;
  /** Shown above the buttons so a failed submit is always visible. */
  error?: string | null;
  onRetry?: () => void;
  backLabel?: string;
}) {
  const { isDesktop } = useBreakpoint();
  const submit = nextLabel.startsWith("Submit");
  return (
    <View style={[styles.footer, isDesktop && styles.footerDesktop]}>
      {error ? (
        <ErrorCard
          message={error}
          onRetry={onRetry}
          retrying={loading}
          style={{ marginBottom: spacing.md }}
        />
      ) : null}
      <View style={styles.footerRow}>
        {isDesktop ? <View style={{ flex: 1 }} /> : null}
        <Button variant={isDesktop ? "ghost" : "dark"} size="lg" icon="back" onPress={onBack}>
          {backLabel}
        </Button>
        {!hideNext && onNext ? (
          <Button
            size="lg"
            icon={submit ? "check" : "arrowRight"}
            onPress={onNext}
            disabled={nextDisabled}
            loading={loading}
            style={isDesktop ? { minWidth: 200 } : { flexGrow: 1 }}
          >
            {nextLabel}
          </Button>
        ) : null}
      </View>
    </View>
  );
}

/**
 * Numeric stat field that keeps the typed text while focused, so "1." can become "1.5"
 * (parsing every keystroke used to snap "1." back to "1"). Each complete number is
 * committed as it's typed — a tap on Submit with the keyboard still up keeps the value.
 */
export function StatInput({
  value,
  onChange,
  decimal,
  label,
  color = colors.text,
}: {
  value: number | null;
  onChange: (value: number | null) => void;
  decimal?: boolean;
  label: string;
  color?: string;
}) {
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState(value != null ? String(value) : "");
  useEffect(() => {
    if (!focused) setDraft(value != null ? String(value) : "");
  }, [value, focused]);
  return (
    <TextInput
      value={draft}
      onChangeText={(text) => {
        const clean = decimal ? text.replace(/[^0-9.,]/g, "") : text.replace(/[^0-9]/g, "");
        setDraft(clean);
        onChange(parseStatInput(clean));
      }}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false);
        const parsed = parseStatInput(draft);
        onChange(parsed);
        setDraft(parsed != null ? String(parsed) : "");
      }}
      placeholder="—"
      placeholderTextColor={colors.textFaint}
      keyboardType={decimal ? "decimal-pad" : "number-pad"}
      inputMode={decimal ? "decimal" : "numeric"}
      selectTextOnFocus
      accessibilityLabel={label}
      style={[
        styles.statInput,
        { color },
        focused && { borderColor: colors.lineStrong },
        webStyle({ outlineStyle: "none" }) as TextStyle,
      ]}
    />
  );
}

/** "You / Opp" stat grid row: label, my value, their value. */
export function StatEditRow({
  label,
  myValue,
  oppValue,
  onChangeMy,
  onChangeOpp,
  oppName,
  decimal,
  myColor,
  oppColor,
}: {
  label: string;
  myValue: number | null;
  oppValue: number | null;
  onChangeMy: (v: number | null) => void;
  onChangeOpp: (v: number | null) => void;
  oppName: string;
  decimal?: boolean;
  myColor?: string;
  oppColor?: string;
}) {
  return (
    <View style={styles.statEditRow}>
      <Txt size={12.5} color={colors.textDim} style={styles.statLabel}>
        {label}
      </Txt>
      <View style={styles.statEditFields}>
        <StatInput
          value={myValue}
          onChange={onChangeMy}
          decimal={decimal}
          label={`Your ${label.toLowerCase()}`}
          color={myColor}
        />
        <StatInput
          value={oppValue}
          onChange={onChangeOpp}
          decimal={decimal}
          label={`${oppName}'s ${label.toLowerCase()}`}
          color={oppColor}
        />
      </View>
    </View>
  );
}
