/**
 * Team field + searchable catalogue picker. Phones get a bottom sheet; from tablet width
 * up it's a centred dialog (a full-width sheet across a desktop monitor reads as broken).
 * Keyboard-first on web: the search box autofocuses, ↑/↓ move the highlight, Enter picks
 * it (the top result by default), Escape closes. `recentTeamIds` seeds a Recent row and
 * `quickPicks` render one-tap chips under the closed field ("Last time: Arsenal").
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  FlatList,
  Modal,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  type NativeSyntheticEvent,
  type TextInputKeyPressEventData,
  type TextStyle,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { filterTeams, type TeamCategoryFilter, type TeamOverallFilter } from "@/lib/teamSearch";
import type { Team } from "@/lib/league";
import type { Player } from "@/types";
import { colors, elevation, radius, spacing } from "@/theme";
import { withAlpha } from "@/lib/color";
import { plural } from "@/lib/format";
import { useBreakpoint } from "@/lib/responsive";
import { webStyle } from "@/lib/web";
import { Avatar } from "./Avatar";
import { IconButton } from "./Button";
import { Icon } from "./Icon";
import { Interactive } from "./Interactive";
import { Reveal } from "./motion";
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

/** Fixed row height (+ gap) so the list can scroll the keyboard highlight into view. */
const ROW_HEIGHT = 78;
const ROW_GAP = spacing.sm;
const LIST_PAD = spacing.lg;

export interface TeamPickerProps {
  label: string;
  player: Player | null;
  teams: Team[];
  value: Team | null;
  onChange: (team: Team) => void;
  /** Teams this player used recently, newest first — shown as a Recent row in the picker. */
  recentTeamIds?: string[];
  /** One-tap suggestions under the closed field (e.g. the opponent's last team vs you). */
  quickPicks?: { label: string; team: Team }[];
  /** Small note under the field ("Your last team"). */
  hint?: string;
}

export function TeamPicker({
  label,
  player,
  teams,
  value,
  onChange,
  recentTeamIds,
  quickPicks,
  hint,
}: TeamPickerProps) {
  const { isTablet } = useBreakpoint();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<TeamCategoryFilter>("all");
  const [overall, setOverall] = useState<TeamOverallFilter>("all");
  const [highlight, setHighlight] = useState(0);
  const listRef = useRef<FlatList<Team>>(null);

  const results = useMemo(
    () => filterTeams(teams, { query, category, overall }),
    [teams, query, category, overall],
  );
  const recent = useMemo(() => {
    if (!recentTeamIds?.length) return [];
    const byId = new Map(teams.map((team) => [team.id, team]));
    return recentTeamIds
      .map((id) => byId.get(id))
      .filter((team): team is Team => !!team)
      .slice(0, 6);
  }, [recentTeamIds, teams]);
  const showRecent = recent.length > 0 && !query && category === "all" && overall === "all";

  // A new result set starts the highlight back at the top result.
  useEffect(() => setHighlight(0), [query, category, overall]);

  function showPicker() {
    setQuery("");
    setCategory("all");
    setOverall("all");
    setHighlight(0);
    setOpen(true);
  }

  function selectTeam(team: Team) {
    onChange(team);
    setOpen(false);
  }

  function moveHighlight(delta: number) {
    if (results.length === 0) return;
    const next = Math.max(0, Math.min(results.length - 1, highlight + delta));
    setHighlight(next);
    listRef.current?.scrollToIndex({ index: next, viewPosition: 0.5, animated: true });
  }

  function onSearchKey(event: NativeSyntheticEvent<TextInputKeyPressEventData>) {
    const key = event.nativeEvent.key;
    if (key === "ArrowDown" || key === "ArrowUp") {
      event.preventDefault();
      moveHighlight(key === "ArrowDown" ? 1 : -1);
    }
  }

  const sheet = (
    <View style={styles.sheetInner}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Txt variant="head" size={18} accessibilityRole="header">
            {label}
          </Txt>
          <Txt size={11.5} color={colors.textDim} style={{ marginTop: 2 }}>
            {plural(results.length, "team")}
            {isTablet ? " · ↑↓ to move · Enter to pick · Esc to close" : ""}
          </Txt>
        </View>
        <IconButton
          icon="x"
          accessibilityLabel="Close team picker"
          onPress={() => setOpen(false)}
        />
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
            returnKeyType="done"
            onKeyPress={onSearchKey}
            onSubmitEditing={() => {
              const pick = results[highlight] ?? results[0];
              if (pick) selectTeam(pick);
            }}
            accessibilityLabel={`Search teams for ${label}`}
            style={[styles.searchInput, webStyle({ outlineStyle: "none" }) as TextStyle]}
          />
          {query ? (
            <Interactive
              onPress={() => setQuery("")}
              accessibilityLabel="Clear search"
              style={styles.clear}
              hoverStyle={{ backgroundColor: colors.surface3 }}
            >
              <Icon name="x" size={14} color={colors.textDim} />
            </Interactive>
          ) : null}
        </View>

        {showRecent ? (
          <View style={styles.recentRow}>
            <Txt variant="head" size={10.5} color={colors.textDim} style={styles.recentLabel}>
              RECENT
            </Txt>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chipRow}
              keyboardShouldPersistTaps="handled"
            >
              {recent.map((team) => (
                <FilterChip
                  key={team.id}
                  label={team.overall != null ? `${team.name} · ${team.overall}` : team.name}
                  selected={team.id === value?.id}
                  onPress={() => selectTeam(team)}
                />
              ))}
            </ScrollView>
          </View>
        ) : null}

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipRow}
          keyboardShouldPersistTaps="handled"
        >
          {CATEGORY_FILTERS.map((filter) => (
            <FilterChip
              key={filter.value}
              label={filter.label}
              selected={category === filter.value}
              onPress={() => setCategory(filter.value)}
            />
          ))}
          <View style={styles.chipDivider} />
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
        ref={listRef}
        style={{ flex: 1 }}
        data={results}
        keyExtractor={(team) => team.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.listContent}
        getItemLayout={(_, index) => ({
          length: ROW_HEIGHT + ROW_GAP,
          offset: LIST_PAD + (ROW_HEIGHT + ROW_GAP) * index,
          index,
        })}
        initialNumToRender={12}
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
        renderItem={({ item, index }) => (
          <TeamResult
            team={item}
            selected={item.id === value?.id}
            // Keyboard highlight only where a keyboard is likely (tablet/desktop widths).
            highlighted={isTablet && index === highlight}
            onPress={() => selectTeam(item)}
          />
        )}
      />
    </View>
  );

  return (
    <View>
      <View style={styles.fieldLabel}>
        <Avatar player={player} size={20} />
        <Txt variant="head" size={11} color={colors.textDim} style={{ letterSpacing: 0.6 }}>
          {label.toUpperCase()}
        </Txt>
        {hint ? (
          <Txt size={11} color={colors.textFaint} style={{ marginLeft: "auto" }}>
            {hint}
          </Txt>
        ) : null}
      </View>
      <Interactive
        accessibilityLabel={`${label}: ${value?.name ?? "No team selected"}. Change team`}
        onPress={showPicker}
        pressScale={0.99}
        style={[styles.teamField, value && styles.teamFieldFilled]}
        hoverStyle={{ borderColor: value ? withAlpha(colors.accent, 0.6) : colors.lineStrong }}
      >
        <Icon name="jersey" size={17} color={value ? player?.color : colors.textDim} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt color={value ? colors.text : colors.textDim} numberOfLines={1}>
            {value?.name ?? "Search teams…"}
          </Txt>
          {value ? (
            <Txt size={10.5} color={colors.textDim} numberOfLines={1} style={{ marginTop: 2 }}>
              {value.competition}
              {value.overall != null ? ` · OVR ${value.overall}` : " · Custom"}
            </Txt>
          ) : null}
        </View>
        {value?.overall != null ? (
          <Txt variant="monoBold" size={15} color={colors.accent}>
            {value.overall}
          </Txt>
        ) : null}
        <Icon name="search" size={16} color={colors.textDim} />
      </Interactive>
      {quickPicks?.length ? (
        <View style={styles.quickRow}>
          {quickPicks.map((pick) => (
            <FilterChip
              key={pick.team.id}
              label={pick.label}
              selected={pick.team.id === value?.id}
              onPress={() => onChange(pick.team)}
            />
          ))}
        </View>
      ) : null}

      <Modal
        visible={open}
        animationType={isTablet ? "fade" : "slide"}
        transparent
        statusBarTranslucent
        onRequestClose={() => setOpen(false)}
      >
        <View style={[styles.modalOverlay, isTablet && styles.modalOverlayCentered]}>
          <Interactive
            accessibilityLabel="Close team picker"
            onPress={() => setOpen(false)}
            pressScale={1}
            focusable={false}
            style={[StyleSheet.absoluteFill, webStyle({ cursor: "default" })]}
          />
          {isTablet ? (
            <Reveal
              from="scale"
              duration={200}
              style={[styles.dialog, webStyle({ boxShadow: elevation.overlay })]}
            >
              {sheet}
            </Reveal>
          ) : (
            <View style={styles.sheet}>
              <SafeAreaView style={{ flex: 1 }} edges={["bottom"]}>
                <View style={styles.handle} />
                {sheet}
              </SafeAreaView>
            </View>
          )}
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
    <Interactive
      onPress={onPress}
      accessibilityState={{ selected }}
      pressScale={0.96}
      style={[styles.chip, selected && styles.chipSelected]}
      hoverStyle={selected ? undefined : { borderColor: colors.lineStrong }}
    >
      <Txt size={12} color={selected ? colors.accent : colors.textDim} numberOfLines={1}>
        {label}
      </Txt>
    </Interactive>
  );
}

function TeamResult({
  team,
  selected,
  highlighted,
  onPress,
}: {
  team: Team;
  selected: boolean;
  highlighted: boolean;
  onPress: () => void;
}) {
  return (
    <Interactive
      onPress={onPress}
      accessibilityLabel={`${team.name}${team.overall != null ? `, overall ${team.overall}` : ""}`}
      accessibilityState={{ selected }}
      pressScale={0.99}
      style={[
        styles.resultRow,
        highlighted && styles.highlightedRow,
        selected && styles.selectedRow,
      ]}
      hoverStyle={{ backgroundColor: colors.surface2, borderColor: colors.lineStrong }}
    >
      <View style={styles.overall}>
        <Txt variant="monoBold" size={team.overall == null ? 11 : 18} color={colors.accent}>
          {team.overall ?? "N/A"}
        </Txt>
        <Txt size={8.5} color={colors.textDim}>
          OVR
        </Txt>
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt variant="bodyMedium" size={14} numberOfLines={1}>
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
      {highlighted && !selected ? (
        <Txt variant="mono" size={10} color={colors.textFaint}>
          ↵
        </Txt>
      ) : null}
    </Interactive>
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
  quickRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.sm },
  modalOverlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.58)",
  },
  modalOverlayCentered: { justifyContent: "center", alignItems: "center", padding: spacing.x2 },
  sheet: {
    height: "82%",
    maxHeight: 700,
    backgroundColor: colors.bg,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: colors.line,
    overflow: "hidden",
  },
  dialog: {
    width: "100%",
    maxWidth: 560,
    height: "80%",
    maxHeight: 720,
    backgroundColor: colors.bg,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    overflow: "hidden",
  },
  sheetInner: { flex: 1 },
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
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
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
  clear: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  recentRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  recentLabel: { letterSpacing: 1 },
  chipRow: { gap: spacing.sm, alignItems: "center" },
  chipDivider: { width: 1, height: 18, backgroundColor: colors.line, marginHorizontal: 2 },
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
  listContent: { padding: LIST_PAD, paddingBottom: spacing.x3 },
  resultRow: {
    height: ROW_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    marginBottom: ROW_GAP,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  highlightedRow: { borderColor: colors.lineStrong, backgroundColor: colors.surface2 },
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
