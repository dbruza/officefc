/**
 * Desktop league table: a full-width, client-side sortable data table with a sticky
 * header (web), hover rows that open the player, and the viewer's row highlighted.
 *
 * Rows come in labelled groups (ranked, placement, unranked) and sorting applies within
 * each group, so re-sorting never mixes provisional players into the ranked table.
 * Lower-priority columns drop out as the table narrows (it measures itself), so the
 * same component reads well from a 1024px laptop to a wide monitor.
 */
import { useMemo, useState } from "react";
import { StyleSheet, View, type LayoutChangeEvent } from "react-native";
import { Avatar } from "./Avatar";
import { FormChips, Movement } from "./chips";
import { Icon } from "./Icon";
import { Interactive } from "./Interactive";
import { CountUp, Reveal } from "./motion";
import { Tag } from "./feedback";
import { Txt } from "./Txt";
import { colors, radius, spacing } from "@/theme";
import { mix, withAlpha } from "@/lib/color";
import { webStyle } from "@/lib/web";
import type { LeaguePlayer, Standing } from "@/lib/league";

type SortKey =
  | "rank"
  | "name"
  | "p"
  | "w"
  | "d"
  | "l"
  | "gf"
  | "ga"
  | "gd"
  | "win"
  | "elo"
  | "move";
type ColumnKey = SortKey | "form";

interface Column {
  key: ColumnKey;
  label: string;
  /** Spoken name — used by the sort buttons and screen readers. */
  title: string;
  /** Fixed width; 0 = the flexible player column. */
  width: number;
  /** Hidden when the table is narrower than this. */
  minTable?: number;
  /** Only meaningful while the season is live (current form, weekly movement). */
  liveOnly?: boolean;
}

const COLUMNS: Column[] = [
  { key: "rank", label: "#", title: "rank", width: 44 },
  { key: "name", label: "Player", title: "player name", width: 0 },
  { key: "p", label: "P", title: "games played", width: 40 },
  { key: "w", label: "W", title: "wins", width: 40 },
  { key: "d", label: "D", title: "draws", width: 40 },
  { key: "l", label: "L", title: "losses", width: 40 },
  { key: "gf", label: "GF", title: "goals for", width: 46, minTable: 900 },
  { key: "ga", label: "GA", title: "goals against", width: 46, minTable: 900 },
  { key: "gd", label: "GD", title: "goal difference", width: 52, minTable: 600 },
  { key: "win", label: "Win %", title: "win rate", width: 64, minTable: 600 },
  {
    key: "form",
    label: "Form",
    title: "last five results",
    width: 116,
    minTable: 760,
    liveOnly: true,
  },
  { key: "elo", label: "ELO", title: "ELO rating", width: 68 },
  {
    key: "move",
    label: "Move",
    title: "places moved this week",
    width: 56,
    minTable: 600,
    liveOnly: true,
  },
];

/** Name and rank read naturally ascending; every stat column starts with the biggest. */
const ASCENDING_FIRST: SortKey[] = ["rank", "name"];

export interface LeagueTableRow {
  player: LeaguePlayer;
  /** Null for members with no confirmed game this season. */
  standing: Standing | null;
  /** Small caption under the name (e.g. "1 more game to rank"). */
  note?: string;
}

export interface LeagueTableGroup {
  key: string;
  /** Group heading row; omitted for the main (ranked) group. */
  title?: string;
  caption?: string;
  rows: LeagueTableRow[];
}

const played = (s: Standing) => s.w + s.d + s.l;

function sortValue(row: LeagueTableRow, key: SortKey, index: number): number | string {
  const s = row.standing;
  if (key === "rank") return index;
  if (key === "name") return row.player.name.toLowerCase();
  if (!s) return Number.NEGATIVE_INFINITY;
  switch (key) {
    case "p":
      return played(s);
    case "w":
      return s.w;
    case "d":
      return s.d;
    case "l":
      return s.l;
    case "gf":
      return s.gf;
    case "ga":
      return s.ga;
    case "gd":
      return s.gf - s.ga;
    case "win":
      return played(s) ? s.w / played(s) : -1;
    case "elo":
      return s.elo;
    case "move":
      return s.move;
  }
}

/** Signed number with a typographic minus, so +/− columns line up. */
const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `\u2212${-n}` : "0");

export function LeagueTable({
  groups,
  live,
  youId,
  championId,
  onOpen,
}: {
  groups: LeagueTableGroup[];
  /** Live season: adds the form + movement columns. */
  live: boolean;
  youId?: string | null;
  championId?: string | null;
  onOpen: (uid: string) => void;
}) {
  const [width, setWidth] = useState(0);
  const [sort, setSort] = useState<{ key: SortKey; asc: boolean }>({ key: "rank", asc: true });

  // Before the first measure assume a roomy table; onLayout corrects it a frame later.
  const tableWidth = width || 1100;
  const columns = COLUMNS.filter(
    (col) => (!col.liveOnly || live) && (!col.minTable || tableWidth >= col.minTable),
  );

  const sortedGroups = useMemo(
    () =>
      groups.map((group) => {
        const indexed = group.rows.map((row, index) => ({ row, index }));
        indexed.sort((a, b) => {
          const va = sortValue(a.row, sort.key, a.index);
          const vb = sortValue(b.row, sort.key, b.index);
          const cmp =
            typeof va === "string" && typeof vb === "string"
              ? va.localeCompare(vb)
              : (va as number) - (vb as number);
          // Ties fall back to table order so equal rows never shuffle between sorts.
          return (sort.asc ? cmp : -cmp) || a.index - b.index;
        });
        return { ...group, rows: indexed.map(({ row }) => row) };
      }),
    [groups, sort],
  );

  const toggleSort = (key: SortKey) =>
    setSort((prev) =>
      prev.key === key ? { key, asc: !prev.asc } : { key, asc: ASCENDING_FIRST.includes(key) },
    );

  const filled = sortedGroups.filter((group) => group.rows.length > 0);
  const lastGroup = filled[filled.length - 1]?.key;
  let rowIndex = 0;

  return (
    <View
      style={styles.table}
      onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
    >
      <View style={[styles.headRow, stickyHead]} accessibilityRole="header">
        {columns.map((col) => {
          const cellStyle = [styles.cell, cellWidth(col), col.key === "name" && styles.nameCell];
          if (col.key === "form") {
            return (
              <View key={col.key} style={cellStyle}>
                <Txt variant="head" size={10.5} color={colors.textFaint} style={styles.headLabel}>
                  {col.label.toUpperCase()}
                </Txt>
              </View>
            );
          }
          const key = col.key;
          const active = sort.key === key;
          return (
            <Interactive
              key={key}
              onPress={() => toggleSort(key)}
              accessibilityLabel={`Sort by ${col.title}${active ? (sort.asc ? ", ascending" : ", descending") : ""}`}
              accessibilityState={{ selected: active }}
              pressScale={1}
              style={[cellStyle, styles.headButton]}
              hoverStyle={{ backgroundColor: colors.surface2 }}
            >
              {({ hovered }) => (
                <>
                  <Txt
                    variant="head"
                    size={10.5}
                    color={active ? colors.accent : hovered ? colors.text : colors.textFaint}
                    style={styles.headLabel}
                    numberOfLines={1}
                  >
                    {col.label.toUpperCase()}
                  </Txt>
                  {active ? (
                    <View style={!sort.asc && styles.flip}>
                      <Icon name="up" size={11} stroke={2.6} color={colors.accent} />
                    </View>
                  ) : null}
                </>
              )}
            </Interactive>
          );
        })}
      </View>

      {sortedGroups.map((group) =>
        group.rows.length === 0 ? null : (
          <View key={group.key}>
            {group.title ? (
              <View style={styles.groupRow} accessibilityRole="header">
                <Txt variant="head" size={10.5} color={colors.textDim} style={styles.headLabel}>
                  {group.title.toUpperCase()}
                </Txt>
                {group.caption ? (
                  <Txt variant="mono" size={11} color={colors.textFaint}>
                    {group.caption}
                  </Txt>
                ) : null}
              </View>
            ) : null}
            {group.rows.map((row, i) => {
              const last = group.key === lastGroup && i === group.rows.length - 1;
              return (
                <Reveal key={row.player.id} index={rowIndex++} from="fade" duration={320}>
                  <TableRow
                    row={row}
                    columns={columns}
                    you={row.player.id === youId}
                    champion={row.player.id === championId}
                    last={last}
                    onOpen={onOpen}
                  />
                </Reveal>
              );
            })}
          </View>
        ),
      )}
    </View>
  );
}

function TableRow({
  row,
  columns,
  you,
  champion,
  last,
  onOpen,
}: {
  row: LeagueTableRow;
  columns: Column[];
  you: boolean;
  champion: boolean;
  last: boolean;
  onOpen: (uid: string) => void;
}) {
  const s = row.standing;
  const games = s ? played(s) : 0;
  const label = [
    row.player.name,
    you ? "(you)" : null,
    s && s.ranked ? `rank ${s.rank}` : null,
    s ? `${games} played, ${s.w} won, ${s.d} drawn, ${s.l} lost` : "no games yet",
    s ? `${s.elo} ELO` : null,
  ]
    .filter(Boolean)
    .join(", ");

  const num = (value: string | number, color: string = colors.text) => (
    <Txt variant="mono" size={13} color={color}>
      {value}
    </Txt>
  );

  const cell = (col: Column) => {
    if (col.key === "rank") {
      return s?.ranked ? (
        <Txt variant="monoBold" size={13} color={medalColor(s.rank) ?? colors.textDim}>
          {s.rank}
        </Txt>
      ) : (
        num("–", colors.textFaint)
      );
    }
    if (col.key === "name") {
      return (
        <>
          <Avatar player={row.player} size={30} champion={champion} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <View style={styles.nameLine}>
              <Txt variant="bodyMedium" size={14} numberOfLines={1} style={{ flexShrink: 1 }}>
                {row.player.name}
              </Txt>
              {you ? <Tag tone="accent">YOU</Tag> : null}
            </View>
            {row.note ? (
              <Txt size={11.5} color={colors.textFaint} numberOfLines={1}>
                {row.note}
              </Txt>
            ) : null}
          </View>
        </>
      );
    }
    if (!s) return num("—", colors.textFaint);
    switch (col.key) {
      case "p":
        return num(games, colors.textDim);
      case "w":
        return num(s.w);
      case "d":
        return num(s.d);
      case "l":
        return num(s.l);
      case "gf":
        return num(s.gf, colors.textDim);
      case "ga":
        return num(s.ga, colors.textDim);
      case "gd": {
        const gd = s.gf - s.ga;
        return num(signed(gd), gd > 0 ? colors.win : gd < 0 ? colors.loss : colors.textDim);
      }
      case "win":
        return num(games ? `${Math.round((s.w / games) * 100)}%` : "—", colors.textDim);
      case "form":
        return s.form.length ? (
          <FormChips results={s.form} size={17} gap={3} />
        ) : (
          num("—", colors.textFaint)
        );
      case "elo":
        return <CountUp value={s.elo} variant="monoBold" size={15} />;
      case "move":
        return <Movement move={s.move} />;
    }
  };

  return (
    <Interactive
      onPress={() => onOpen(row.player.id)}
      accessibilityRole="link"
      accessibilityLabel={label}
      pressScale={1}
      style={[styles.row, you && styles.youRow, last && styles.lastRow]}
      hoverStyle={{
        backgroundColor: you ? mix(colors.surface, colors.accent, 15) : colors.surface2,
      }}
    >
      {you ? <View style={styles.youBar} /> : null}
      {columns.map((col) => (
        <View
          key={col.key}
          style={[styles.cell, cellWidth(col), col.key === "name" && styles.nameCell]}
        >
          {cell(col)}
        </View>
      ))}
    </Interactive>
  );
}

function medalColor(rank: number): string | null {
  return rank === 1 ? colors.gold : rank === 2 ? colors.silver : rank === 3 ? colors.bronze : null;
}

const cellWidth = (col: Column) => (col.width ? { width: col.width } : { flex: 1, minWidth: 160 });

// Web: keep the column headings in view while a long table scrolls under them.
const stickyHead = webStyle({ position: "sticky", top: 0 });

const styles = StyleSheet.create({
  table: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
  },
  headRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.sm,
    height: 40,
    zIndex: 2,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
  },
  headButton: {
    flexDirection: "row",
    gap: 3,
    height: 30,
    borderRadius: radius.sm,
  },
  headLabel: { letterSpacing: 1 },
  flip: { transform: [{ rotate: "180deg" }] },
  cell: {
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
  },
  nameCell: {
    justifyContent: "flex-start",
    gap: spacing.md,
    paddingHorizontal: spacing.sm,
  },
  nameLine: { flexDirection: "row", alignItems: "center", gap: 7 },
  groupRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
    backgroundColor: mix(colors.surface, colors.bg, 40),
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 54,
    paddingHorizontal: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  youRow: { backgroundColor: mix(colors.surface, colors.accent, 8) },
  youBar: {
    position: "absolute",
    left: 0,
    top: 8,
    bottom: 8,
    width: 3,
    borderRadius: 2,
    backgroundColor: withAlpha(colors.accent, 0.9),
  },
  lastRow: {
    borderBottomWidth: 0,
    borderBottomLeftRadius: radius.lg,
    borderBottomRightRadius: radius.lg,
  },
});
