import { ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Card, ScreenHeader, Txt } from "@/components";
import { CHANGELOG, type ChangelogEntry } from "@/lib/changelog";
import { withAlpha } from "@/lib/color";
import { colors, spacing } from "@/theme";

/** Section-kind → label colour (accent/gold/draw/dim — deliberately not W/D/L). */
const kindColor: Record<ChangelogEntry["sections"][number]["kind"], string> = {
  Added: colors.accent,
  Changed: colors.gold,
  Fixed: colors.draw,
  Removed: colors.textDim,
  Other: colors.textFaint,
};

function formatDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default function ChangelogRoute() {
  const entries = CHANGELOG;
  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <ScreenHeader
        title="What's new"
        subtitle={
          entries.length ? `${entries.length} release${entries.length === 1 ? "" : "s"}` : undefined
        }
        back
      />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {entries.length === 0 ? (
          <Txt size={13} color={colors.textDim}>
            No changelog entries yet.
          </Txt>
        ) : (
          entries.map((entry, index) => {
            const isNew = index === 0;
            return (
              <Card
                key={entry.version}
                style={isNew ? { borderColor: withAlpha(colors.accent, 0.55) } : undefined}
              >
                <View style={styles.headerRow}>
                  <Txt variant="monoBold" size={15} color={isNew ? colors.accent : colors.text}>
                    v{entry.version}
                  </Txt>
                  {isNew ? (
                    <View style={styles.chip}>
                      <Txt variant="monoBold" size={10} color={colors.onAccent}>
                        NEW
                      </Txt>
                    </View>
                  ) : null}
                  <Txt size={11.5} color={colors.textDim} style={{ marginLeft: "auto" }}>
                    {formatDate(entry.date)}
                  </Txt>
                </View>
                {entry.sections.map((section) => (
                  <View key={section.kind} style={styles.section}>
                    <Txt variant="monoBold" size={10.5} color={kindColor[section.kind]}>
                      {section.kind.toUpperCase()}
                    </Txt>
                    {section.items.map((item, itemIndex) => (
                      <View key={itemIndex} style={styles.item}>
                        <View
                          style={[
                            styles.bullet,
                            { backgroundColor: withAlpha(colors.textDim, 0.6) },
                          ]}
                        />
                        <Txt size={12.5} color={colors.text} style={{ flex: 1 }}>
                          {item}
                        </Txt>
                      </View>
                    ))}
                  </View>
                ))}
              </Card>
            );
          })
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.x3,
    gap: spacing.md,
  },
  headerRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  chip: {
    backgroundColor: colors.accent,
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 2,
    overflow: "hidden",
  },
  section: { marginTop: spacing.md },
  item: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.xs },
  bullet: {
    width: 4,
    height: 4,
    borderRadius: 2,
    marginTop: 8,
  },
});
