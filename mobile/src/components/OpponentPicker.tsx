/**
 * "Who did you play?" — shared by the manual/auto wizard and the photo flow. Opponents
 * you've played most recently come first (then most often), a search box narrows the
 * list (Enter picks the top match), and a tap selects-and-advances via `onSelect`. Phones
 * get a list of rows; desktop a grid of tiles, so a 12-player league fits on one screen.
 */
import { useMemo, useState } from "react";
import { StyleSheet, TextInput, View, type TextStyle } from "react-native";
import { Avatar } from "./Avatar";
import { Icon } from "./Icon";
import { Interactive } from "./Interactive";
import { EmptyState } from "./feedback";
import { Reveal } from "./motion";
import { Grid } from "./Page";
import { SectionLabel } from "./SectionLabel";
import { Txt } from "./Txt";
import type { LeaguePlayer } from "@/lib/league";
import type { OpponentHistory } from "@/lib/matchHistory";
import { colors, radius, spacing } from "@/theme";
import { withAlpha } from "@/lib/color";
import { useBreakpoint } from "@/lib/responsive";
import { timeAgo } from "@/lib/when";
import { webStyle } from "@/lib/web";

export interface OpponentPickerProps {
  players: LeaguePlayer[];
  ratingByUid: Map<string, number>;
  history?: Map<string, OpponentHistory>;
  selectedId: string | null;
  onSelect: (player: LeaguePlayer) => void;
}

/** Search only earns its space once the list stops fitting at a glance. */
const SEARCH_THRESHOLD = 5;

export function OpponentPicker({
  players,
  ratingByUid,
  history,
  selectedId,
  onSelect,
}: OpponentPickerProps) {
  const { isDesktop, isWeb } = useBreakpoint();
  const [query, setQuery] = useState("");

  const sorted = useMemo(() => {
    const meta = (id: string) => history?.get(id);
    return [...players].sort((a, b) => {
      const recency = (meta(b.id)?.lastAt ?? 0) - (meta(a.id)?.lastAt ?? 0);
      if (recency !== 0) return recency;
      const frequency = (meta(b.id)?.count ?? 0) - (meta(a.id)?.count ?? 0);
      return frequency !== 0 ? frequency : a.name.localeCompare(b.name);
    });
  }, [players, history]);

  const needle = query.trim().toLowerCase();
  const filtered = needle
    ? sorted.filter(
        (p) => p.name.toLowerCase().includes(needle) || p.handle.toLowerCase().includes(needle),
      )
    : sorted;
  const recent = needle ? [] : filtered.filter((p) => history?.has(p.id));
  const others = needle ? filtered : filtered.filter((p) => !history?.has(p.id));
  const sectioned = recent.length > 0 && others.length > 0;

  if (players.length === 0) {
    return (
      <EmptyState
        icon="users"
        title="No one to play yet"
        body="Invite another player to the league before logging a match."
      />
    );
  }

  const renderTiles = (list: LeaguePlayer[], offset: number) => {
    const tiles = list.map((player, i) => (
      <OpponentOption
        key={player.id}
        player={player}
        elo={ratingByUid.get(player.id) ?? 1500}
        meta={history?.get(player.id)}
        selected={player.id === selectedId}
        onPress={() => onSelect(player)}
        index={offset + i}
        tile={isDesktop}
      />
    ));
    return isDesktop ? (
      <Grid min={230} maxColumns={3} gap={spacing.sm}>
        {tiles}
      </Grid>
    ) : (
      <View style={{ gap: spacing.sm }}>{tiles}</View>
    );
  };

  return (
    <View style={{ gap: spacing.md }}>
      {players.length > SEARCH_THRESHOLD ? (
        <View style={styles.search}>
          <Icon name="search" size={16} color={colors.textDim} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search players"
            placeholderTextColor={colors.textFaint}
            autoCapitalize="none"
            autoCorrect={false}
            // Desktop: type a name straight away. Phones: don't pop the keyboard over the list.
            autoFocus={isWeb && isDesktop}
            returnKeyType="go"
            onSubmitEditing={() => {
              if (filtered[0]) onSelect(filtered[0]);
            }}
            accessibilityLabel="Search players"
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
      ) : null}

      {filtered.length === 0 ? (
        <EmptyState compact icon="search" title={`No players match “${query.trim()}”`} />
      ) : sectioned ? (
        <>
          <View>
            <SectionLabel>Recent opponents</SectionLabel>
            {renderTiles(recent, 0)}
          </View>
          <View>
            <SectionLabel>Everyone else</SectionLabel>
            {renderTiles(others, recent.length)}
          </View>
        </>
      ) : (
        renderTiles(filtered, 0)
      )}
    </View>
  );
}

function OpponentOption({
  player,
  elo,
  meta,
  selected,
  onPress,
  index,
  tile,
}: {
  player: LeaguePlayer;
  elo: number;
  meta?: OpponentHistory;
  selected: boolean;
  onPress: () => void;
  index: number;
  tile: boolean;
}) {
  const played = meta
    ? `${meta.count} ${meta.count === 1 ? "game" : "games"}${meta.lastAt ? ` · ${timeAgo(meta.lastAt)}` : ""}`
    : `@${player.handle}`;
  return (
    <Reveal from="up" index={index} duration={260}>
      <Interactive
        onPress={onPress}
        accessibilityRole="radio"
        accessibilityState={{ checked: selected }}
        accessibilityLabel={`${player.name}, ELO ${elo}`}
        lift={tile}
        style={[styles.row, tile && styles.tile, selected && styles.rowActive]}
        hoverStyle={selected ? undefined : { borderColor: colors.lineStrong }}
      >
        <Avatar player={player} size={tile ? 40 : 42} jersey />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt variant="bodyMedium" size={14.5} numberOfLines={1}>
            {player.name}
          </Txt>
          <Txt
            variant="mono"
            size={11.5}
            color={colors.textDim}
            style={{ marginTop: 3 }}
            numberOfLines={1}
          >
            {elo} · {played}
          </Txt>
        </View>
        {selected ? (
          <Reveal from="scale" duration={220} style={styles.check}>
            <Icon name="check" size={13} color={colors.onAccent} stroke={3} />
          </Reveal>
        ) : null}
      </Interactive>
    </Reveal>
  );
}

const styles = StyleSheet.create({
  search: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
  },
  searchInput: { flex: 1, color: colors.text, fontSize: 14.5, paddingVertical: 12 },
  clear: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  tile: { minHeight: 68 },
  rowActive: {
    borderColor: withAlpha(colors.accent, 0.55),
    backgroundColor: withAlpha(colors.accent, 0.07),
  },
  check: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
});
