/**
 * Shared admin styles. (Error copy lives in `callableErrorMessage` in @/lib/authErrors —
 * raw Firebase messages never reach the screen.)
 */
import { StyleSheet } from "react-native";
import { colors, radius, spacing } from "@/theme";

export const formStyles = StyleSheet.create({
  input: {
    color: colors.text,
    fontSize: 14,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    marginBottom: spacing.sm,
  },
});
