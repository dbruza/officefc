/** Scaffold for auth/onboarding screens: safe-area, keyboard-aware, centered column. */
import { ReactNode } from "react";
import { View, ScrollView, KeyboardAvoidingView, Platform, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Txt } from "./Txt";
import { Icon } from "./Icon";
import { colors, spacing } from "@/theme";

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

export interface FormScreenProps {
  title: string;
  subtitle?: string;
  children: ReactNode;
  /** Pinned content at the bottom (e.g. a secondary link). */
  footer?: ReactNode;
}

export function FormScreen({ title, subtitle, children, footer }: FormScreenProps) {
  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <BrandMark />
          <Txt variant="head" size={26} style={{ marginTop: spacing.x2 }}>
            {title}
          </Txt>
          {subtitle ? (
            <Txt size={14} color={colors.textDim} style={{ marginTop: 6, lineHeight: 20 }}>
              {subtitle}
            </Txt>
          ) : null}
          <View style={styles.body}>{children}</View>
        </ScrollView>
        {footer ? <View style={styles.footer}>{footer}</View> : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  brand: { flexDirection: "row", alignItems: "center", gap: 8 },
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: {
    flexGrow: 1,
    justifyContent: "center",
    paddingHorizontal: spacing.x2,
    paddingVertical: spacing.x3,
  },
  body: { marginTop: spacing.x2, gap: spacing.lg },
  footer: { paddingHorizontal: spacing.x2, paddingBottom: spacing.lg },
});
