/**
 * Scaffold for auth/onboarding screens. Phone: safe-area, keyboard-aware single column
 * with the footer pinned. Tablet: the same content in a centred card. Desktop (≥1024):
 * split screen — brand panel left, ~420px form card right.
 *
 * On web the body is a real <form>: Enter in the last field submits natively and
 * password managers see a genuine submission (they ignore click handlers on divs).
 */
import {
  Children,
  createContext,
  createElement,
  useContext,
  useMemo,
  useRef,
  type ComponentType,
  type ReactNode,
  type Ref,
} from "react";
import {
  View,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  type TextInput,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AuthBrandPanel } from "./AuthBrandPanel";
import { Button, type ButtonProps } from "./Button";
import { Icon } from "./Icon";
import { Reveal } from "./motion";
import { TextField, type TextFieldProps } from "./TextField";
import { Txt } from "./Txt";
import { colors, radius, spacing } from "@/theme";
import { useBreakpoint } from "@/lib/responsive";
import { useDocumentTitle, webStyle } from "@/lib/web";

const IS_WEB = Platform.OS === "web";

export function BrandMark() {
  return (
    <View style={styles.brand}>
      <Icon name="ball" size={20} color={colors.accent} stroke={2.2} />
      <Txt variant="head" size={15} style={{ letterSpacing: 2 }}>
        OFFICE
        <Txt variant="head" size={15} color={colors.accent}>
          FC
        </Txt>
      </Txt>
    </View>
  );
}

/**
 * TextField with a `ref` to its input, for focus chaining (email → password). React 19
 * passes `ref` through as a prop and TextField spreads the rest onto its TextInput, so
 * only the type needs widening here.
 */
export const RefTextField = TextField as ComponentType<TextFieldProps & { ref?: Ref<TextInput> }>;

/**
 * `onSubmitEditing` for a form's LAST field. Native: submit directly. Web: leave Enter
 * to the browser so the <form> submits for real (react-native-web would otherwise
 * swallow the keypress with preventDefault).
 */
export function submitOnEnter(submit: () => void): (() => void) | undefined {
  return IS_WEB ? undefined : submit;
}

interface FormContextValue {
  submit: () => void;
}

const FormContext = createContext<FormContextValue | null>(null);

// Visually hidden but still "rendered", so browsers treat it as the default button for
// implicit submission (some skip display:none buttons).
const HIDDEN_SUBMIT = {
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  border: 0,
  opacity: 0,
} as const;

/**
 * Web: a real <form> (display: contents, so it adds no box to the flex layout) with a
 * hidden submit button. Native: just the children. Either way, `SubmitButton`s inside
 * submit through it.
 */
export function Form({ onSubmit, children }: { onSubmit: () => void; children: ReactNode }) {
  const formRef = useRef<HTMLFormElement | null>(null);
  const handler = useRef(onSubmit);
  handler.current = onSubmit;
  const value = useMemo<FormContextValue>(
    () => ({
      submit: () => {
        const form = formRef.current;
        // requestSubmit fires a genuine submit event (password managers listen for it).
        if (form && typeof form.requestSubmit === "function") form.requestSubmit();
        else handler.current();
      },
    }),
    [],
  );
  return (
    <FormContext.Provider value={value}>
      {IS_WEB
        ? createElement(
            "form",
            {
              ref: formRef,
              noValidate: true,
              style: { display: "contents" },
              onSubmit: (event: { preventDefault: () => void }) => {
                event.preventDefault();
                handler.current();
              },
            },
            children,
            createElement("button", {
              type: "submit",
              tabIndex: -1,
              "aria-hidden": true,
              style: HIDDEN_SUBMIT,
            }),
          )
        : children}
    </FormContext.Provider>
  );
}

/** Primary button that submits the surrounding `Form` (falls back to `onPress`). */
export function SubmitButton({ onPress, ...props }: ButtonProps) {
  const form = useContext(FormContext);
  return <Button full size="lg" {...props} onPress={form ? form.submit : onPress} />;
}

/** First-run steps, in order, for the "Step n of 4" indicator. */
const STEPS = ["Account", "Verify email", "Profile", "Join"] as const;

function StepIndicator({ step, spaced }: { step: number; spaced: boolean }) {
  return (
    <View
      style={[styles.steps, spaced && { marginTop: spacing.x2 }]}
      accessibilityRole="progressbar"
      accessibilityLabel={`Step ${step} of ${STEPS.length}: ${STEPS[step - 1]}`}
      accessibilityValue={{ min: 1, max: STEPS.length, now: step }}
    >
      <View style={styles.stepBars}>
        {STEPS.map((label, i) => (
          <View
            key={label}
            style={[
              styles.stepBar,
              { backgroundColor: i < step ? colors.accent : colors.surface2 },
              i === step - 1 && webStyle({ boxShadow: `0 0 10px ${colors.accent}55` }),
            ]}
          />
        ))}
      </View>
      <Txt variant="mono" size={11} color={colors.textDim} style={{ letterSpacing: 0.6 }}>
        STEP {step} OF {STEPS.length} ·{" "}
        <Txt variant="monoBold" size={11} color={colors.text}>
          {STEPS[step - 1]?.toUpperCase()}
        </Txt>
      </Txt>
    </View>
  );
}

export interface FormScreenProps {
  title: string;
  subtitle?: string;
  children: ReactNode;
  /** Secondary content (e.g. "New here? Create an account"). Pinned to the bottom on phones. */
  footer?: ReactNode;
  /**
   * Submit handler. When given, the body becomes a <form> on web: Enter in the last
   * field (see `submitOnEnter`) and `SubmitButton` both route here.
   */
  onSubmit?: () => void;
  /** First-run progress (1–4): sign-up → verify email → profile → join. */
  step?: number;
  /** Browser tab title; defaults to `title`. */
  documentTitle?: string;
}

export function FormScreen({
  title,
  subtitle,
  children,
  footer,
  onSubmit,
  step,
  documentTitle,
}: FormScreenProps) {
  const { isTablet, isDesktop } = useBreakpoint();
  useDocumentTitle(documentTitle ?? title);

  // Fields assemble top-down. Children keep their slot (conditionals render null), so
  // keys stay stable and an error line appearing never remounts the inputs below it.
  const fields = Children.map(children, (child, i) =>
    child == null || child === false ? (
      child
    ) : (
      <Reveal index={i} delay={160}>
        {child}
      </Reveal>
    ),
  );
  const body = onSubmit ? <Form onSubmit={onSubmit}>{fields}</Form> : fields;

  const content = (
    <View style={[styles.column, isTablet && styles.card]}>
      {isDesktop ? null : (
        <Reveal from="fade">
          <BrandMark />
        </Reveal>
      )}
      {step ? <StepIndicator step={step} spaced={!isDesktop} /> : null}
      <Reveal delay={60}>
        <Txt
          variant="head"
          size={isTablet ? 28 : 26}
          accessibilityRole="header"
          style={[{ letterSpacing: -0.4 }, !isDesktop && !step && { marginTop: spacing.x2 }]}
        >
          {title}
        </Txt>
        {subtitle ? (
          <Txt size={14} color={colors.textDim} style={{ marginTop: 6, lineHeight: 20 }}>
            {subtitle}
          </Txt>
        ) : null}
      </Reveal>
      <View style={styles.body}>{body}</View>
      {isTablet && footer ? <View style={styles.cardFooter}>{footer}</View> : null}
    </View>
  );

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <View style={[styles.split, isDesktop && styles.splitRow]}>
        {isDesktop ? <AuthBrandPanel /> : null}
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <ScrollView
            contentContainerStyle={[styles.scroll, isTablet && styles.scrollCentered]}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {content}
          </ScrollView>
          {!isTablet && footer ? <View style={styles.footer}>{footer}</View> : null}
        </KeyboardAvoidingView>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  brand: { flexDirection: "row", alignItems: "center", gap: 8 },
  safe: { flex: 1, backgroundColor: colors.bg },
  split: { flex: 1 },
  splitRow: { flexDirection: "row" },
  scroll: {
    flexGrow: 1,
    justifyContent: "center",
    paddingHorizontal: spacing.x2,
    paddingVertical: spacing.x3,
  },
  scrollCentered: { alignItems: "center", paddingVertical: spacing.x4 },
  column: { width: "100%" },
  card: {
    maxWidth: 440,
    padding: spacing.x3,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    ...webStyle({ boxShadow: "0 24px 64px rgba(0,0,0,0.35)" }),
  },
  steps: { marginBottom: spacing.lg, gap: 8 },
  stepBars: { flexDirection: "row", gap: 6 },
  stepBar: { flex: 1, height: 4, borderRadius: 2 },
  body: { marginTop: spacing.x2, gap: spacing.lg },
  cardFooter: {
    marginTop: spacing.x2,
    paddingTop: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  footer: { paddingHorizontal: spacing.x2, paddingBottom: spacing.lg },
});
