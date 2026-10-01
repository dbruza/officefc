/**
 * What's new: the release history, newest first. Releases this device hasn't opened yet
 * get a NEW badge (last-seen version in AsyncStorage); opening the screen marks them read.
 */
import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { Card, EmptyState, Page, Reveal, ScreenHeader, Tag, Txt } from "@/components";
import { CHANGELOG, type ChangelogEntry } from "@/lib/changelog";
import { isUnseen, markChangelogSeen, useChangelogLastSeen } from "@/lib/changelogSeen";
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
  const { lastSeen, loaded } = useChangelogLastSeen();
  // Snapshot the unread set on first load so badges stay put while the user reads,
  // even though we mark everything seen straight away.
  const [unseen, setUnseen] = useState<ReadonlySet<string> | null>(null);

  useEffect(() => {
    if (!loaded || unseen !== null) return;
    setUnseen(new Set(entries.filter((e) => isUnseen(e.version, lastSeen)).map((e) => e.version)));
    void markChangelogSeen();
  }, [loaded, lastSeen, unseen, entries]);

  const newCount = unseen?.size ?? 0;

  return (
    <Page
      width="narrow"
      header={
        <ScreenHeader
          title="What's new"
          subtitle={
            entries.length
              ? `${entries.length} release${entries.length === 1 ? "" : "s"}${
                  newCount ? ` · ${newCount} new since you last looked` : ""
                }`
              : undefined
          }
        />
      }
      contentStyle={{ gap: spacing.md }}
    >
      {entries.length === 0 ? (
        <EmptyState icon="sparkle" title="No release notes yet" />
      ) : (
        entries.map((entry, index) => {
          const isNew = unseen?.has(entry.version) ?? false;
          const card = (
            <Card style={isNew ? { borderColor: withAlpha(colors.accent, 0.55) } : undefined}>
              <View style={styles.headerRow}>
                <Txt
                  variant="monoBold"
                  size={15}
                  color={isNew ? colors.accent : colors.text}
                  accessibilityRole="header"
                >
                  v{entry.version}
                </Txt>
                {isNew ? <Tag tone="accent">NEW</Tag> : null}
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
                      <View style={styles.bullet} />
                      <Txt size={13} color={colors.text} style={styles.itemText}>
                        {item}
                      </Txt>
                    </View>
                  ))}
                </View>
              ))}
            </Card>
          );
          // Stagger the first screenful; older releases just appear.
          return index < 8 ? (
            <Reveal key={entry.version} index={index}>
              {card}
            </Reveal>
          ) : (
            <View key={entry.version}>{card}</View>
          );
        })
      )}
    </Page>
  );
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  section: { marginTop: spacing.md },
  item: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.xs },
  itemText: { flex: 1, lineHeight: 19 },
  bullet: {
    width: 4,
    height: 4,
    borderRadius: 2,
    marginTop: 8,
    backgroundColor: withAlpha(colors.textDim, 0.6),
  },
});
