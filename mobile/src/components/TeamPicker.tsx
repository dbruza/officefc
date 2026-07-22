import { useMemo, useState } from "react";
import { FlatList, Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { filterTeams, type TeamCategoryFilter, type TeamOverallFilter } from "@/lib/teamSearch";
import type { Team } from "@/lib/league";
import type { Player } from "@/types";
import { colors, radius, spacing } from "@/theme";
import { withAlpha } from "@/lib/color";
import { plural } from "@/lib/format";
import { Avatar } from "./Avatar";
import { Icon } from "./Icon";
import { Txt } from "./Txt";

const CATEGORY_FILTERS: Array<{ value: TeamCategoryFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "men", label: "Clubs" },
  { value: "international", label: "International" },
];

const OVERALL_FILTERS: Array<{ value: TeamOverallFilter; label: string }> = [
  { value: "all", label: "Any OVR" },
  { value: "80+", label: "80+" },
  { value: "75-79", label: "75–79" },
  { value: "70-74", label: "70–74" },
  { value: "under70", label: "<70" },
  { value: "unrated", label: "Unrated" },
];

export interface TeamPickerProps {
  label: string;
  player: Player | null;
  teams: Team[];
  value: Team | null;
  onChange: (team: Team) => void;
}

export function TeamPicker({ label, player, teams, value, onChange }: TeamPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<TeamCategoryFilter>("all");
  const [overall, setOverall] = useState<TeamOverallFilter>("all");

  const results = useMemo(
    () => filterTeams(teams, { query, category, overall }),
    [teams, query, category, overall],
  );

  function showPicker() {
    setQuery("");
    setCategory("all");
    setOverall("all");
    setOpen(true);
  }

  function closePicker() {
    setOpen(false);
  }

  function selectTeam(team: Team) {
    onChange(team);
    closePicker();
  }

  return (
    <View>
      <View style={styles.fieldLabel}>
        <Avatar player={player} size={20} />
        <Txt variant="head" size={11} color={colors.textDim}>
          {label.toUpperCase()}
        </Txt>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${value?.name ?? "No team selected"}`}
        onPress={showPicker}
        style={[styles.teamField, value && styles.teamFieldFilled]}
      >
        <Icon name="jersey" size={17} color={value ? player?.color : colors.textDim} />
        <View style={{ flex: 1 }}>
          <Txt color={value ? colors.text : colors.textDim}>{value?.name ?? "Search teams…"}</Txt>
          {value ? (
            <Txt size={10.5} color={colors.textDim} numberOfLines={1} style={{ marginTop: 2 }}>
              {value.competition}
              {value.overall != null ? ` · OVR ${value.overall}` : " · Custom"}
            </Txt>
          ) : null}
        </View>
        <Icon name="search" size={16} color={colors.textDim} />
      </Pressable>

      <Modal
        visible={open}
        animationType="slide"
        transparent
        statusBarTranslucent
        onRequestClose={closePicker}
      >
        <View style={styles.modalOverlay}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close team picker"
            onPress={closePicker}
            style={StyleSheet.absoluteFill}
          />
          <View style={styles.sheet}>
            <SafeAreaView style={styles.sheetSafe} edges={["bottom"]}>
              <View style={styles.handle} />
              <View style={styles.header}>
                <Pressable onPress={closePicker} style={styles.iconButton}>
                  <Icon name="x" size={20} stroke={2.5} />
                </Pressable>
                <View style={{ flex: 1 }}>
                  <Txt variant="head" size={18}>
                    {label}
                  </Txt>
                  <Txt size={11.5} color={colors.textDim} style={{ marginTop: 2 }}>
                    {plural(results.length, "team")}
                  </Txt>
                </View>
              </View>

              <View style={styles.filters}>
                <View style={styles.searchBox}>
                  <Icon name="search" size={16} color={colors.textDim} />
                  <TextInput
                    value={query}
                    onChangeText={setQuery}
                    placeholder="Search teams"
                    placeholderTextColor={colors.textFaint}
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoFocus
                    style={styles.searchInput}
                  />
                  {query ? (
                    <Pressable onPress={() => setQuery("")}>
                      <Icon name="x" size={16} color={colors.textDim} />
                    </Pressable>
                  ) : null}
                </View>

                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.chipRow}
                >
                  {CATEGORY_FILTERS.map((filter) => (
                    <FilterChip
                      key={filter.value}
                      label={filter.label}
                      selected={category === filter.value}
                      onPress={() => setCategory(filter.value)}
                    />
                  ))}
                </ScrollView>

                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.chipRow}
                >
                  {OVERALL_FILTERS.map((filter) => (
                    <FilterChip
                      key={filter.value}
                      label={filter.label}
                      selected={overall === filter.value}
                      onPress={() => setOverall(filter.value)}
                    />
                  ))}
                </ScrollView>
              </View>

              <FlatList
                style={{ flex: 1 }}
                data={results}
                keyExtractor={(team) => team.id}
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={styles.listContent}
                ListEmptyComponent={
                  <View style={styles.empty}>
                    <Txt variant="head" size={16}>
                      No teams found
                    </Txt>
                    <Txt color={colors.textDim} size={12.5} style={{ marginTop: spacing.sm }}>
                      Try clearing a filter or using a broader search.
                    </Txt>
                  </View>
                }
                renderItem={({ item }) => (
                  <TeamResult
                    team={item}
                    selected={item.id === value?.id}
                    onPress={() => selectTeam(item)}
                  />
                )}
              />
            </SafeAreaView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function FilterChip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, selected && styles.chipSelected]}>
      <Txt size={12} color={selected ? colors.accent : colors.textDim}>
        {label}
      </Txt>
    </Pressable>
  );
}

function TeamResult({
  team,
  selected,
  onPress,
}: {
  team: Team;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={[styles.resultRow, selected && styles.selectedRow]}>
      <View style={styles.overall}>
        <Txt variant="monoBold" size={team.overall == null ? 11 : 18} color={colors.accent}>
          {team.overall ?? "N/A"}
        </Txt>
        <Txt size={8.5} color={colors.textDim}>
          OVR
        </Txt>
      </View>
      <View style={{ flex: 1 }}>
        <Txt variant="bodyMedium" size={14}>
          {team.name}
        </Txt>
        <Txt size={10.5} color={colors.textDim} numberOfLines={1} style={{ marginTop: 3 }}>
          {team.competition}
        </Txt>
        <Txt variant="mono" size={10} color={colors.textFaint} style={{ marginTop: 5 }}>
          {team.category === "custom"
            ? "CUSTOM TEAM"
            : team.overall == null
              ? "RATINGS UNAVAILABLE"
              : `ATK ${team.attack}  MID ${team.midfield}  DEF ${team.defence}`}
        </Txt>
      </View>
      {selected ? <Icon name="check" size={17} color={colors.accent} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fieldLabel: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  teamField: {
    minHeight: 54,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    paddingVertical: 11,
  },
  teamFieldFilled: { borderColor: withAlpha(colors.accent, 0.35) },
  modalOverlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.58)",
  },
  sheet: {
    height: "78%",
    maxHeight: 680,
    backgroundColor: colors.bg,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: colors.line,
    overflow: "hidden",
  },
  sheetSafe: { flex: 1 },
  handle: {
    alignSelf: "center",
    width: 42,
    height: 4,
    marginTop: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.textFaint,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xs,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  filters: {
    gap: spacing.sm,
    padding: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
  },
  searchInput: {
    flex: 1,
    color: colors.text,
    fontSize: 14,
    paddingVertical: 12,
  },
  chipRow: { gap: spacing.sm },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
  },
  chipSelected: {
    borderColor: withAlpha(colors.accent, 0.45),
    backgroundColor: withAlpha(colors.accent, 0.08),
  },
  listContent: { padding: spacing.lg, paddingBottom: spacing.x3 },
  resultRow: {
    minHeight: 82,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  selectedRow: {
    borderColor: withAlpha(colors.accent, 0.45),
    backgroundColor: withAlpha(colors.accent, 0.07),
  },
  overall: {
    width: 48,
    height: 48,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface2,
  },
  empty: { alignItems: "center", paddingVertical: spacing.x3 },
});
