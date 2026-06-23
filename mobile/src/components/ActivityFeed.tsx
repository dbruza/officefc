/** League activity feed: newest-first results, milestones, upsets, and season awards. */
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Avatar } from "./Avatar";
import { Icon, type IconName } from "./Icon";
import { Txt } from "./Txt";
import { colors, radius, spacing } from "@/theme";
import { firstName } from "@/lib/format";
import type { ActivityEvent, LeaguePlayer } from "@/lib/league";

const COLLAPSED_COUNT = 6;

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function relativeTime(date: Date | null): string {
  if (!date) return "";
  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d`;
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

interface Line {
  icon: IconName;
  tint: string;
  primaryId: string;
  text: string;
}

function describe(event: ActivityEvent, name: (uid: string) => string): Line {
  const p = event.payload;
  switch (event.type) {
    case "match_result": {
      const aGoals = num(p.aGoals);
      const bGoals = num(p.bGoals);
      const aId = str(p.aId);
      const bId = str(p.bId);
      if (aGoals === bGoals) {
        return {
          icon: "ball",
          tint: colors.textDim,
          primaryId: aId,
          text: `${name(aId)} drew ${name(bId)} ${aGoals}–${bGoals}`,
        };
      }
      const winner = aGoals > bGoals ? aId : bId;
      const loser = aGoals > bGoals ? bId : aId;
      const winGoals = Math.max(aGoals, bGoals);
      const loseGoals = Math.min(aGoals, bGoals);
      return {
        icon: "ball",
        tint: colors.text,
        primaryId: winner,
        text: `${name(winner)} beat ${name(loser)} ${winGoals}–${loseGoals}`,
      };
    }
    case "upset": {
      const winnerId = str(p.winnerId);
      return {
        icon: "bolt",
        tint: colors.accent,
        primaryId: winnerId,
        text: `Upset — ${name(winnerId)} took down ${name(str(p.loserId))}`,
      };
    }
    case "streak": {
      const playerId = str(p.playerId);
      return {
        icon: "flame",
        tint: colors.win,
        primaryId: playerId,
        text: `${name(playerId)} is on a ${num(p.count)}-win streak`,
      };
    }
    case "new_number_one": {
      const playerId = str(p.playerId);
      return {
        icon: "crown",
        tint: colors.accent,
        primaryId: playerId,
        text: `${name(playerId)} is the new #1`,
      };
    }
    case "potm": {
      const playerId = str(p.playerId);
      return {
        icon: "award",
        tint: colors.accent,
        primaryId: playerId,
        text: `${name(playerId)} won Player of the Month`,
      };
    }
    case "champion": {
      const playerId = str(p.playerId);
      const season = str(p.seasonName);
      return {
        icon: "trophy",
        tint: colors.accent,
        primaryId: playerId,
        text: season ? `${name(playerId)} won ${season}` : `${name(playerId)} won the season`,
      };
    }
  }
}

export function ActivityFeed({
  events,
  players,
  onOpenMatch,
  onOpenPlayer,
}: {
  events: ActivityEvent[];
  players: Map<string, LeaguePlayer>;
  onOpenMatch?: (matchId: string) => void;
  onOpenPlayer?: (uid: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const name = (uid: string) => {
    const player = players.get(uid);
    return player ? firstName(player.name) : "A player";
  };

  if (events.length === 0) {
    return (
      <View style={styles.empty}>
        <Icon name="bolt" size={22} color={colors.textDim} />
        <View style={{ flex: 1 }}>
          <Txt variant="head" size={14}>
            Nothing's happened yet
          </Txt>
          <Txt size={12} color={colors.textDim} style={{ marginTop: 3 }}>
            Confirmed results, streaks, and upsets will show up here.
          </Txt>
        </View>
      </View>
    );
  }

  const visible = expanded ? events : events.slice(0, COLLAPSED_COUNT);
  return (
    <View style={{ gap: spacing.sm }}>
      {visible.map((event) => {
        const line = describe(event, name);
        const primary = players.get(line.primaryId);
        const matchId = str(event.payload.matchId);
        const onPress = matchId
          ? () => onOpenMatch?.(matchId)
          : line.primaryId
            ? () => onOpenPlayer?.(line.primaryId)
            : undefined;
        return (
          <Pressable
            key={event.id}
            onPress={onPress}
            style={({ pressed }) => [styles.row, pressed && { opacity: 0.9 }]}
          >
            {primary ? (
              <Avatar player={primary} size={30} />
            ) : (
              <View style={[styles.iconWrap, { borderColor: line.tint }]}>
                <Icon name={line.icon} size={15} color={line.tint} />
              </View>
            )}
            <View style={styles.iconBadge}>
              <Icon name={line.icon} size={12} color={line.tint} />
            </View>
            <Txt
              variant="bodyMedium"
              size={13}
              color={colors.text}
              numberOfLines={2}
              style={{ flex: 1 }}
            >
              {line.text}
            </Txt>
            <Txt variant="mono" size={10.5} color={colors.textFaint}>
              {relativeTime(event.createdAt)}
            </Txt>
          </Pressable>
        );
      })}
      {events.length > COLLAPSED_COUNT ? (
        <Pressable onPress={() => setExpanded((value) => !value)} style={styles.more}>
          <Txt variant="head" size={11} color={colors.accent}>
            {expanded ? "SHOW LESS" : `SHOW ${events.length - COLLAPSED_COUNT} MORE`}
          </Txt>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: 9,
    paddingHorizontal: 12,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
  },
  iconWrap: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface2,
  },
  iconBadge: {
    width: 18,
    alignItems: "center",
  },
  more: {
    alignItems: "center",
    paddingVertical: spacing.sm,
  },
  empty: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
});
