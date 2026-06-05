/**
 * M0 showcase — not a final screen. Renders the ported primitives against mock data so
 * the design system can be verified visually (Expo Go / RN Web) before real screens land
 * in M3. The home-style hero hints at the eventual layout.
 */
import { ScrollView, View, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  Txt,
  Card,
  Button,
  StatCard,
  SectionLabel,
  PlayerRow,
  LineChart,
  FormChips,
  EloDelta,
  Avatar,
} from "@/components";
import { colors, spacing, radius } from "@/theme";
import { mix, withAlpha } from "@/lib/color";
import { players, standings, eloHistory } from "@/data/mock";

export default function Showcase() {
  const you = players[0];
  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* header */}
        <View style={styles.headerRow}>
          <View>
            <Txt variant="head" size={10.5} color={colors.textDim} style={{ letterSpacing: 1.6 }}>
              OFFICEFC · SUMMER SHOWDOWN
            </Txt>
            <Txt variant="head" size={24} style={{ marginTop: 2 }}>
              Evening, {you.name.split(" ")[0]}
            </Txt>
          </View>
          <Avatar player={you} size={44} ring jersey />
        </View>

        {/* hero card */}
        <Card style={styles.hero} padded>
          <Txt variant="head" size={10.5} color={colors.textDim} style={{ letterSpacing: 1.6 }}>
            YOUR RATING
          </Txt>
          <View style={styles.heroRow}>
            <Txt variant="monoBold" size={46} color={colors.accent} style={{ letterSpacing: -1.4 }}>
              1558
            </Txt>
            <View style={{ alignItems: "flex-end", gap: 4 }}>
              <Txt variant="head" size={34} style={{ letterSpacing: -1 }}>
                #3
              </Txt>
              <EloDelta delta={11} size={14} />
            </View>
          </View>
          <View style={{ marginTop: spacing.md }}>
            <FormChips results={["L", "W", "L", "D", "W"]} size={24} />
          </View>
        </Card>

        {/* quick stats */}
        <View style={styles.statGrid}>
          <View style={styles.statCell}>
            <StatCard label="Win rate" value="52%" accent />
          </View>
          <View style={styles.statCell}>
            <StatCard label="Streak" value="W2" sub="2 wins on the bounce" />
          </View>
        </View>

        {/* ELO chart */}
        <SectionLabel>Rating over time</SectionLabel>
        <Card style={{ marginBottom: spacing.x2 }} padded>
          <LineChart data={eloHistory} />
        </Card>

        {/* primary CTA */}
        <Button full size="lg" icon="plus" style={{ marginBottom: spacing.x2 }}>
          Log a match
        </Button>

        {/* leaderboard */}
        <SectionLabel
          action={
            <Txt variant="head" size={12} color={colors.accent}>
              See all
            </Txt>
          }
        >
          Top of the table
        </SectionLabel>
        <View style={{ gap: spacing.sm }}>
          {standings.map((row) => (
            <PlayerRow
              key={row.player.id}
              player={row.player}
              rank={row.rank}
              elo={row.elo}
              move={row.move}
              form={row.form}
              you={row.player.isYou}
            />
          ))}
        </View>

        <View style={{ height: spacing.x3 }} />
        <Txt size={11} color={colors.textFaint} style={{ textAlign: "center" }}>
          M0 design-system showcase · primitives ported from the prototype
        </Txt>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.x3 },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.lg,
  },
  hero: {
    backgroundColor: mix(colors.surface, colors.accent, 6),
    borderColor: withAlpha(colors.accent, 0.22),
    borderRadius: radius.xl,
    marginBottom: spacing.lg,
  },
  heroRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    marginTop: 6,
  },
  statGrid: { flexDirection: "row", gap: spacing.md, marginBottom: spacing.x2 },
  statCell: { flex: 1 },
});
