/** Searchable team selector with an inline popover, shared by the manual and AI logging flows. */
import { useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import { Avatar } from "./Avatar";
import { Icon } from "./Icon";
import { Txt } from "./Txt";
import type { Team } from "@/lib/league";
import { colors, radius, spacing } from "@/theme";
import { withAlpha } from "@/lib/color";
import type { Player } from "@/types";

export function TeamPicker({
  label,
  player,
  teams,
  value,
  onChange,
}: {
  label: string;
  player: Player | null;
  teams: Team[];
  value: Team | null;
  onChange: (team: Team) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const filtered = teams.filter((team) => team.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <View>
      <View style={styles.fieldLabel}>
        <Avatar player={player} size={20} />
        <Txt variant="head" size={11} color={colors.textDim}>
          {label.toUpperCase()}
        </Txt>
      </View>
      <Pressable
        onPress={() => setOpen((current) => !current)}
        style={[styles.teamField, value && styles.teamFieldFilled]}
      >
        <Icon name="jersey" size={17} color={value ? player?.color : colors.textDim} />
        <Txt color={value ? colors.text : colors.textDim} style={{ flex: 1 }}>
          {value?.name ?? "Search teams…"}
        </Txt>
        <Icon name={open ? "up" : "search"} size={16} color={colors.textDim} />
      </Pressable>
      {open ? (
        <View style={styles.teamPopover}>
          <View style={styles.searchBox}>
            <Icon name="search" size={15} color={colors.textDim} />
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Type a team name"
              placeholderTextColor={colors.textFaint}
              autoFocus
              style={styles.searchInput}
            />
          </View>
          <View style={{ gap: 4 }}>
            {filtered.map((team) => (
              <Pressable
                key={team.id}
                onPress={() => {
                  onChange(team);
                  setOpen(false);
                  setSearch("");
                }}
                style={[styles.teamOption, value?.id === team.id && styles.teamOptionActive]}
              >
                <Icon name="jersey" size={15} color={colors.textDim} />
                <Txt size={13.5} style={{ flex: 1 }}>
                  {team.name}
                </Txt>
                {value?.id === team.id ? (
                  <Icon name="check" size={14} color={colors.accent} />
                ) : null}
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}
    </View>
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
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
  },
  teamFieldFilled: { borderColor: withAlpha(colors.accent, 0.35) },
  teamPopover: {
    marginTop: spacing.sm,
    padding: spacing.sm,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.sm,
    backgroundColor: colors.bg,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  searchInput: {
    flex: 1,
    color: colors.text,
    fontSize: 13.5,
    paddingVertical: 10,
  },
  teamOption: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 9,
    borderRadius: radius.sm,
  },
  teamOptionActive: { backgroundColor: withAlpha(colors.accent, 0.08) },
});
