/**
 * League activity feed: newest-first results, milestones, upsets, and season awards.
 * Rows that lead somewhere (a match, a player) are hoverable links; the signed-in
 * player reads as "You", and relative times re-tick each minute so a tab left open all
 * morning doesn't keep saying "now".
 */
import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { Avatar } from "./Avatar";
import { EmptyState } from "./feedback";
import { Icon, type IconName } from "./Icon";
import { Interactive } from "./Interactive";
import { Reveal } from "./motion";
import { Txt } from "./Txt";
import { colors, radius, spacing } from "@/theme";
import { withAlpha } from "@/lib/color";
import { firstName } from "@/lib/format";
import type { ActivityEvent, LeaguePlayer } from "@/lib/league";

const COLLAPSED_COUNT = 6;

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Compact "how long ago": now / 5m / 3h / 2d / 14 Sep. `now` is injected so callers re-tick. */
export function relativeTime(date: Date | null, now: number = Date.now()): string {
  if (!date) return "";
  const seconds = Math.round((now - date.getTime()) / 1000);
  if (seconds < 60) return "now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d`;
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/** Current time, refreshed every `intervalMs` — drives relative timestamps. */
export function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

interface Line {
  icon: IconName;
  tint: string;
  primaryId: string;
  text: string;
  /** Milestones (crowns, streaks, silverware) get accented rows; plain results stay quiet. */
  milestone?: boolean;
}

/** Name resolver. `object` = the grammatical object ("beat you"), so "You" lower-cases. */
type NameFn = (uid: string, object?: boolean) => string;

/**
 * Drop repeated "new #1" events for the same player: the crown only re-announces when the
 * lead actually changed hands. Events arrive newest-first, so walk oldest-first.
 */
function collapseRepeats(events: ActivityEvent[]): ActivityEvent[] {
  const kept = new Set<string>();
  let lastNumberOne: string | null = null;
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.type !== "new_number_one") {
      kept.add(event.id);
      continue;
    }
    const actor = event.actorIds[0] ?? str(event.payload.playerId);
    if (actor !== lastNumberOne) {
      kept.add(event.id);
      lastNumberOne = actor;
    }
  }
  return events.filter((event) => kept.has(event.id));
}

function describe(event: ActivityEvent, name: NameFn, meId: string | undefined): Line {
  const p = event.payload;
  // "You is on a streak" → "You're on a streak".
  const isMe = (uid: string) => !!meId && uid === meId;
  switch (event.type) {
    case "match_result": {
      const aGoals = num(p.aGoals);
      const bGoals = num(p.bGoals);
      const aId = str(p.aId);
      const bId = str(p.bId);
      if (aGoals === bGoals) {
        // Lead with "You" when the viewer was in it.
        const [first, second] = isMe(bId) ? [bId, aId] : [aId, bId];
        return {
          icon: "ball",
          tint: colors.textDim,
          primaryId: first,
          text: `${name(first)} drew ${name(second, true)} ${aGoals}–${bGoals}`,
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
        text: `${name(winner)} beat ${name(loser, true)} ${winGoals}–${loseGoals}`,
      };
    }
    case "upset": {
      const winnerId = str(p.winnerId);
      return {
        icon: "bolt",
        tint: colors.accent,
        primaryId: winnerId,
        text: `Upset — ${name(winnerId, true)} took down ${name(str(p.loserId), true)}`,
        milestone: true,
      };
    }
    case "streak": {
      const playerId = str(p.playerId);
      return {
        icon: "flame",
        tint: colors.win,
        primaryId: playerId,
        text: `${isMe(playerId) ? "You're" : `${name(playerId)} is`} on a ${num(p.count)}-win streak`,
        milestone: true,
      };
    }
    case "new_number_one": {
      const playerId = str(p.playerId);
      return {
        icon: "crown",
        tint: colors.accent,
        primaryId: playerId,
        text: `${isMe(playerId) ? "You're" : `${name(playerId)} is`} the new #1`,
        milestone: true,
      };
    }
    case "potm": {
      const playerId = str(p.playerId);
      return {
        icon: "award",
        tint: colors.accent,
        primaryId: playerId,
        text: `${name(playerId)} won Player of the Month`,
        milestone: true,
      };
    }
    case "premier": {
      const playerId = str(p.playerId);
      const season = str(p.seasonName);
      return {
        icon: "medal",
        tint: colors.gold,
        primaryId: playerId,
        text: season
          ? `${name(playerId)} topped the table — ${season} Premier`
          : `${name(playerId)} topped the table`,
        milestone: true,
      };
    }
    case "champion": {
      const playerId = str(p.playerId);
      const season = str(p.seasonName);
      return {
        icon: "trophy",
        tint: colors.gold,
        primaryId: playerId,
        text: season ? `${name(playerId)} won ${season}` : `${name(playerId)} won the season`,
        milestone: true,
      };
    }
  }
}

export function ActivityFeed({
  events,
  players,
  meId,
  onOpenMatch,
  onOpenPlayer,
}: {
  events: ActivityEvent[];
  players: Map<string, LeaguePlayer>;
  /** Signed-in player — their rows read "You" instead of their own name. */
  meId?: string;
  onOpenMatch?: (matchId: string) => void;
  onOpenPlayer?: (uid: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const now = useNow();
  const name: NameFn = (uid, object = false) => {
    if (meId && uid === meId) return object ? "you" : "You";
    const player = players.get(uid);
    return player ? firstName(player.name) : object ? "a player" : "A player";
  };

  if (events.length === 0) {
    return (
      <EmptyState
        compact
        icon="bolt"
        title="Nothing's happened yet"
        body="Confirmed results, streaks, and upsets will show up here."
      />
    );
  }

  const feed = collapseRepeats(events);
  const visible = expanded ? feed : feed.slice(0, COLLAPSED_COUNT);
  return (
    <View style={{ gap: spacing.sm }}>
      {visible.map((event, index) => {
        const line = describe(event, name, meId);
        const primary = players.get(line.primaryId);
        const matchId = str(event.payload.matchId);
        const onPress = matchId
          ? onOpenMatch && (() => onOpenMatch(matchId))
          : line.primaryId && onOpenPlayer
            ? () => onOpenPlayer(line.primaryId)
            : undefined;
        const tinted = line.milestone && {
          borderColor: withAlpha(line.tint, 0.35),
          backgroundColor: withAlpha(line.tint, 0.05),
        };
        const time = relativeTime(event.createdAt, now);
        const content = (
          <>
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
              {time}
            </Txt>
          </>
        );
        return (
          <Reveal key={event.id} index={index < 10 ? index : undefined} from="up">
            {onPress ? (
              <Interactive
                onPress={onPress}
                accessibilityRole="link"
                accessibilityLabel={time ? `${line.text}, ${time}` : line.text}
                pressScale={0.99}
                style={[styles.row, tinted]}
                hoverStyle={
                  line.milestone
                    ? { borderColor: withAlpha(line.tint, 0.6) }
                    : { backgroundColor: colors.surface2, borderColor: colors.lineStrong }
                }
              >
                {content}
              </Interactive>
            ) : (
              <View style={[styles.row, tinted]}>{content}</View>
            )}
          </Reveal>
        );
      })}
      {feed.length > COLLAPSED_COUNT ? (
        <Interactive
          onPress={() => setExpanded((value) => !value)}
          accessibilityState={{ expanded }}
          style={styles.more}
          hoverStyle={{ backgroundColor: colors.surface }}
        >
          <Txt variant="head" size={11} color={colors.accent} style={{ letterSpacing: 0.6 }}>
            {expanded ? "SHOW LESS" : `SHOW ${feed.length - COLLAPSED_COUNT} MORE`}
          </Txt>
        </Interactive>
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
    borderRadius: radius.md,
  },
});
