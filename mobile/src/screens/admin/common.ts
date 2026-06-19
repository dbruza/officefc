import { StyleSheet } from "react-native";
import { colors, radius, spacing } from "@/theme";

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}

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
