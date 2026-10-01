/**
 * Profile section: the teams a player uses, their favourite, and how each one performs.
 * Rows are read-only facts (no team pages yet), so they're plain views, not pressables.
 */
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { Card } from "./Card";
import { FormChips } from "./chips";
import { EmptyState } from "./feedback";
import { Icon } from "./Icon";
import { Interactive } from "./Interactive";
import { Txt } from "./Txt";
import { colors, radius, spacing } from "@/theme";
import { withAlpha } from "@/lib/color";
import { plural } from "@/lib/format";
import type { TeamRecord, TeamRecordSummary } from "@/lib/teamRecord";

const COLLAPSED_COUNT = 5;

function signedElo(value: number): string {
  return `${value > 0 ? "+" : ""}${value}`;
}

/** Colour a team by its record, the same way the head-to-head rows read. */
function recordColor(team: TeamRecord): string {
  if (team.w > team.l) return colors.win;
  if (team.w < team.l) return colors.loss;
  return colors.text;
}

/** The crest already carries the OVR, so the line under the name stays on the competition. */
function subtitle(team: TeamRecord): string {
  if (team.competition) return team.competition;
  return team.overall != null ? `OVR ${team.overall}` : "";
}

/** OVR badge when the catalogue knows the team, jersey mark when it doesn't. */
function Crest({ team, size }: { team: TeamRecord; size: number }) {
  return (
    <View style={[styles.crest, { width: size, height: size }]}>
      {team.overall != null ? (
        <>
          <Txt variant="monoBold" size={size * 0.36} color={colors.accent}>
            {team.overall}
          </Txt>
          <Txt size={size * 0.17} color={colors.textDim}>
            OVR
          </Txt>
        </>
      ) : (
        <Icon name="jersey" size={size * 0.45} color={colors.textDim} />
      )}
    </View>
  );
}

function Chip({ label, tint }: { label: string; tint: string }) {
  return (
    <View
      style={[
        styles.chip,
        { borderColor: withAlpha(tint, 0.35), backgroundColor: withAlpha(tint, 0.08) },
      ]}
    >
      <Txt variant="monoBold" size={8} color={tint}>
        {label}
      </Txt>
    </View>
  );
}

function FavouriteStat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <View style={styles.favStat}>
      <Txt variant="head" size={9.5} color={colors.textDim} style={styles.kicker}>
        {label}
      </Txt>
      <Txt variant="monoBold" size={20} color={color ?? colors.text} style={styles.favValue}>
        {value}
      </Txt>
    </View>
  );
}

function TeamRow({ team, best }: { team: TeamRecord; best: boolean }) {
  return (
    <View style={styles.row}>
      <Crest team={team} size={40} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt variant="bodyMedium" size={13.5} numberOfLines={1}>
          {team.name}
        </Txt>
        <Txt variant="mono" size={10.5} color={colors.textDim} numberOfLines={1}>
          {plural(team.games, "game")} · {team.w}-{team.d}-{team.l} · {signedElo(team.eloDelta)} ELO
        </Txt>
      </View>
      {best ? <Chip label="BEST" tint={colors.accent} /> : null}
      <Txt variant="monoBold" size={18} color={recordColor(team)}>
        {team.winRate}%
      </Txt>
    </View>
  );
}

export function TeamsPlayed({ summary }: { summary: TeamRecordSummary }) {
  const [expanded, setExpanded] = useState(false);
  const { favourite, best, teams } = summary;

  if (!favourite) {
    return (
      <EmptyState
        compact
        icon="jersey"
        title="No teams yet"
        body="Teams show up here once a confirmed result is on the books."
      />
    );
  }

  const others = teams.filter((team) => team.teamId !== favourite.teamId);
  const visible = expanded ? others : others.slice(0, COLLAPSED_COUNT);
  const favouriteIsBest = best?.teamId === favourite.teamId;

  return (
    <View style={{ gap: spacing.sm }}>
      <Card style={styles.favCard}>
        <View style={styles.favHead}>
          <Crest team={favourite} size={52} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Txt variant="head" size={17} numberOfLines={1}>
              {favourite.name}
            </Txt>
            <Txt size={11} color={colors.textDim} numberOfLines={1} style={{ marginTop: 2 }}>
              {subtitle(favourite) || `${favourite.gf} for · ${favourite.ga} against`}
            </Txt>
          </View>
          <View style={styles.favChips}>
            <Chip label="FAVOURITE" tint={colors.accent} />
            {favouriteIsBest ? <Chip label="BEST RECORD" tint={colors.gold} /> : null}
          </View>
        </View>

        <View style={styles.favStats}>
          <FavouriteStat
            label="WIN RATE"
            value={`${favourite.winRate}%`}
            color={recordColor(favourite)}
          />
          <FavouriteStat label="RECORD" value={`${favourite.w}-${favourite.d}-${favourite.l}`} />
          <FavouriteStat
            label="ELO / GAME"
            value={signedElo(favourite.eloPerGame)}
            color={
              favourite.eloPerGame > 0
                ? colors.win
                : favourite.eloPerGame < 0
                  ? colors.loss
                  : colors.text
            }
          />
        </View>

        <View style={styles.favFoot}>
          <FormChips results={favourite.form} size={20} />
          <Txt variant="mono" size={10.5} color={colors.textDim}>
            {plural(favourite.games, "game")} · {favourite.gf}–{favourite.ga}
          </Txt>
        </View>
      </Card>

      {visible.map((team) => (
        <TeamRow key={team.teamId} team={team} best={team.teamId === best?.teamId} />
      ))}

      {others.length > COLLAPSED_COUNT ? (
        <Interactive
          onPress={() => setExpanded((value) => !value)}
          accessibilityState={{ expanded }}
          style={styles.more}
          hoverStyle={{ backgroundColor: colors.surface }}
        >
          <Txt variant="head" size={11} color={colors.accent} style={{ letterSpacing: 0.6 }}>
            {expanded ? "SHOW LESS" : `SHOW ${others.length - COLLAPSED_COUNT} MORE`}
          </Txt>
        </Interactive>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  favCard: {
    padding: 14,
    gap: spacing.md,
    borderColor: withAlpha(colors.accent, 0.28),
    backgroundColor: withAlpha(colors.accent, 0.05),
  },
  favHead: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  favChips: { alignItems: "flex-end", gap: 4 },
  favStats: {
    flexDirection: "row",
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.line,
    paddingVertical: 10,
  },
  favStat: { flex: 1, minWidth: 0 },
  favValue: { lineHeight: 22, marginTop: 2 },
  favFoot: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  kicker: { letterSpacing: 1.1 },
  crest: {
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface2,
  },
  chip: {
    borderRadius: radius.pill,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderWidth: 1,
  },
  row: {
    minHeight: 62,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  more: { alignItems: "center", paddingVertical: spacing.sm, borderRadius: radius.md },
});
