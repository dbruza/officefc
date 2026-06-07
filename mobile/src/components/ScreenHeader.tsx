import { ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { Icon } from "./Icon";
import { Txt } from "./Txt";
import { colors, radius, spacing } from "@/theme";

export function ScreenHeader({
  title,
  subtitle,
  back = true,
  right,
}: {
  title: string;
  subtitle?: string;
  back?: boolean;
  right?: ReactNode;
}) {
  const router = useRouter();
  return (
    <View style={styles.row}>
      {back ? (
        <Pressable onPress={() => router.back()} style={styles.back}>
          <Icon name="back" size={20} />
        </Pressable>
      ) : null}
      <View style={styles.copy}>
        <Txt variant="head" size={21} numberOfLines={1}>
          {title}
        </Txt>
        {subtitle ? (
          <Txt size={12} color={colors.textDim} style={{ marginTop: 2 }} numberOfLines={1}>
            {subtitle}
          </Txt>
        ) : null}
      </View>
      {right}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  back: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  copy: { flex: 1, minWidth: 0 },
});
