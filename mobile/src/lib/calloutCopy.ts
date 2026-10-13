/**
 * Words for the Stats tab's season callouts. The server stores facts only
 * (functions/src/models/callouts.ts); everything a player reads — titles, one-liners,
 * stat units, icons, accents — lives here, so tweaking the tone never needs a summary
 * version bump or a functions deploy.
 *
 * Tone: affectionate office banter. Roast titles stay gentle and the model only hands
 * them out when nothing flattering stands out as much.
 */
import type { IconName } from "@/components/Icon";
import type { Standing } from "./league/types";
import {
  CALLOUT_MIN_GAMES,
  type Feud,
  type FeudKey,
  type Headline,
  type Superlative,
  type SuperlativeKey,
} from "./stats/callouts";

export interface CalloutText {
  /** Kicker / title, e.g. "On a heater". */
  title: string;
  /** One line of story with the names filled in. */
  line: string;
  /** The big number, already formatted. */
  stat: string;
  statLabel: string;
  icon: IconName;
  accent: string;
}

/** How the callouts name people: usually first names off the roster. */
export type NameOf = (uid: string) => string;

const ACCENT = {
  fire: "#ff6b35",
  gold: "#f5b400",
  teal: "#3fd0c9",
  blue: "#5b9dff",
  violet: "#c06bff",
  green: "#22e06a",
  red: "#ff4d6d",
  grey: "#9aa6b4",
  lilac: "#9aa7ff",
} as const;

const oneDp = (value: number) => value.toFixed(1);
/** The noun alone, singular or plural for `count`. */
const noun = (count: number, word: string, many = `${word}s`) => (count === 1 ? word : many);

// --- Headlines -------------------------------------------------------------------------

export function headlineText(headline: Headline, name: NameOf, live: boolean): CalloutText {
  const a = name(headline.playerId);
  const b = headline.otherId ? name(headline.otherId) : "";
  const n = headline.value;
  const score = `${headline.gf ?? 0}–${headline.ga ?? 0}`;
  switch (headline.key) {
    case "heater":
      return {
        title: "On a heater",
        line: live
          ? `${a} has won ${n} on the bounce. Who's stopping this?`
          : `${a} finished the season on ${n} straight wins.`,
        stat: `${n}`,
        statLabel: "wins in a row",
        icon: "flame",
        accent: ACCENT.fire,
      };
    case "slump":
      return {
        title: "Due a win",
        line: live
          ? `${a} is ${n} games without a win. The comeback starts any day now.`
          : `${a} signed off with ${n} games without a win. Next season, surely.`,
        stat: `${n}`,
        statLabel: "without a win",
        icon: "clock",
        accent: ACCENT.grey,
      };
    case "upset":
      return {
        title: "Upset of the season",
        line: `${a} beat ${b} ${score} despite being rated ${n} points lower.`,
        stat: `${n}`,
        statLabel: "ELO gap",
        icon: "swords",
        accent: ACCENT.violet,
      };
    case "thrashing":
      return {
        title: "Demolition job",
        line: `${a} put ${headline.gf ?? 0} past ${b}. Final score ${score}.`,
        stat: `+${n}`,
        statLabel: "goal margin",
        icon: "bolt",
        accent: ACCENT.red,
      };
    case "goalFest":
      return {
        title: "Goal-fest",
        line:
          headline.gf === headline.ga
            ? `${a} and ${b} drew ${score}. Defending was optional.`
            : `${a} beat ${b} ${score}. Defending was optional.`,
        stat: `${n}`,
        statLabel: "goals in one game",
        icon: "ball",
        accent: ACCENT.gold,
      };
    case "swing":
      return {
        title: "Biggest ELO haul",
        line: `${a} banked +${n} in one game, beating ${b} ${score}.`,
        stat: `+${n}`,
        statLabel: "ELO",
        icon: "trend",
        accent: ACCENT.blue,
      };
  }
}

/** A headline as the Stats tab shows it: server headlines plus the live title race. */
export interface HeadlineView {
  id: string;
  text: CalloutText;
  playerId: string;
  otherId: string | null;
  matchId: string | null;
  date: Date | null;
}

/** How many headline cards the tab leads with. */
export const HEADLINES_SHOWN = 4;

/**
 * The live title race, from the ranked table the Leaderboard already holds: the gap
 * between first and second. Null once the season is over (the bracket decides the
 * champion, not the table) or before two players are ranked.
 */
export function titleRace(
  standings: readonly Standing[],
  name: NameOf,
  live: boolean,
): { view: HeadlineView; weight: number } | null {
  if (!live) return null;
  const [first, second] = standings
    .filter((standing) => standing.ranked)
    .sort((x, y) => x.rank - y.rank);
  if (!first || !second) return null;
  const gap = Math.round(first.elo - second.elo);
  const tight = gap <= 10;
  const [a, b] = [name(first.uid), name(second.uid)];
  return {
    weight: tight ? 80 : gap <= 25 ? 55 : 35,
    view: {
      id: "titleRace",
      playerId: first.uid,
      otherId: second.uid,
      matchId: null,
      date: null,
      text: {
        title: tight ? "Neck and neck" : "Title race",
        line:
          gap === 0
            ? `${a} and ${b} are level at the top. One game could settle it.`
            : tight
              ? `${a} leads ${b} by ${gap} ${noun(gap, "point")}. One game could flip it.`
              : `${a} is ${gap} points clear of ${b} at the top.`,
        stat: `${gap}`,
        statLabel: "point lead",
        icon: "crown",
        accent: ACCENT.gold,
      },
    },
  };
}

/** Server headlines plus the title race, biggest first, one card per player, capped. */
export function headlineViews(
  headlines: readonly Headline[],
  standings: readonly Standing[],
  name: NameOf,
  live: boolean,
): HeadlineView[] {
  const entries = headlines.map((headline) => ({
    weight: headline.weight,
    view: {
      id: `${headline.key}:${headline.playerId}`,
      text: headlineText(headline, name, live),
      playerId: headline.playerId,
      otherId: headline.otherId,
      matchId: headline.matchId,
      date: headline.date ? new Date(headline.date) : null,
    },
  }));
  const race = titleRace(standings, name, live);
  if (race) entries.push(race);
  // Stable sort: equal weights keep the server's order, the race after them.
  entries.sort((x, y) => y.weight - x.weight);
  const seen = new Set<string>();
  const out: HeadlineView[] = [];
  for (const { view } of entries) {
    if (out.length >= HEADLINES_SHOWN || seen.has(view.playerId)) continue;
    seen.add(view.playerId);
    out.push(view);
  }
  return out;
}

// --- Yearbook --------------------------------------------------------------------------

interface TitleCopy {
  title: string;
  blurb: string;
  icon: IconName;
  accent: string;
  stat: (s: Superlative) => string;
  statLabel: (s: Superlative) => string;
}

export const SUPERLATIVE_COPY: Record<SuperlativeKey, TitleCopy> = {
  serialWinner: {
    title: "Serial Winner",
    blurb: "Winning is just a habit at this point.",
    icon: "trophy",
    accent: ACCENT.gold,
    stat: (s) => `${s.value}%`,
    statLabel: () => "win rate",
  },
  goalMachine: {
    title: "Goal Machine",
    blurb: "Can't stop scoring. Won't stop scoring.",
    icon: "boot",
    accent: ACCENT.gold,
    stat: (s) => oneDp(s.value),
    statLabel: () => "goals a game",
  },
  wall: {
    title: "The Wall",
    blurb: "You shall not pass. Mostly.",
    icon: "shield",
    accent: ACCENT.teal,
    stat: (s) => oneDp(s.value),
    statLabel: () => "conceded a game",
  },
  giantKiller: {
    title: "Giant Killer",
    blurb: "Saves the best for the big names.",
    icon: "swords",
    accent: ACCENT.violet,
    stat: (s) => `${s.value}`,
    statLabel: (s) => `${noun(s.value, "win")} over higher-rated players`,
  },
  chaos: {
    title: "Chaos Merchant",
    blurb: "Their games are never, ever boring.",
    icon: "dice",
    accent: ACCENT.fire,
    stat: (s) => oneDp(s.value),
    statLabel: () => "goals a game, both ends",
  },
  glassCannon: {
    title: "Glass Cannon",
    blurb: "Scores plenty. Concedes plenty.",
    icon: "crosshair",
    accent: ACCENT.red,
    stat: (s) => `${oneDp(s.value)}–${oneDp(s.extra ?? 0)}`,
    statLabel: () => "scored–conceded a game",
  },
  fineMargins: {
    title: "Fine Margins",
    blurb: "Why win by two when one will do?",
    icon: "target",
    accent: ACCENT.green,
    stat: (s) => `${s.value}`,
    statLabel: (s) => `one-goal ${noun(s.value, "win")}`,
  },
  drawMerchant: {
    title: "Draw Merchant",
    blurb: "Always happy to share the points.",
    icon: "handshake",
    accent: ACCENT.grey,
    stat: (s) => `${s.value}`,
    statLabel: (s) => noun(s.value, "draw"),
  },
  underdog: {
    title: "Underdog",
    blurb: "Gives the better team a head start, then wins anyway.",
    icon: "star",
    accent: ACCENT.blue,
    stat: (s) => `${s.value}`,
    statLabel: (s) => `${noun(s.value, "win")} with the weaker team`,
  },
  loyalist: {
    title: "The Loyalist",
    blurb: "One club. No regrets.",
    icon: "jersey",
    accent: ACCENT.lilac,
    stat: (s) => `${s.value}%`,
    statLabel: (s) => `of games as ${s.label ?? "one team"}`,
  },
  clubHopper: {
    title: "Club Hopper",
    blurb: "Never met a team they wouldn't try once.",
    icon: "refresh",
    accent: ACCENT.lilac,
    stat: (s) => `${s.value}`,
    statLabel: () => "different teams",
  },
  lateBloomer: {
    title: "Late Bloomer",
    blurb: "Started slow. Not slow any more.",
    icon: "trend",
    accent: ACCENT.green,
    stat: (s) => `+${s.value}%`,
    statLabel: () => "win rate, second half vs first",
  },
  fastStarter: {
    title: "Fast Starter",
    blurb: "Flew out of the blocks. Then the blocks caught up.",
    icon: "bolt",
    accent: ACCENT.gold,
    stat: (s) => `−${s.value}%`,
    statLabel: () => "win rate, second half vs first",
  },
  rollercoaster: {
    title: "Rollercoaster",
    blurb: "Win, lose, win, lose. Never dull.",
    icon: "sparkle",
    accent: ACCENT.fire,
    stat: (s) => `${s.value}`,
    statLabel: () => "flips between wins and losses",
  },
  hardToBeat: {
    title: "Hard to Beat",
    blurb: "Losing isn't really their thing.",
    icon: "medal",
    accent: ACCENT.teal,
    stat: (s) => `${s.value}`,
    statLabel: () => "games unbeaten in a row",
  },
  everPresent: {
    title: "Ever-present",
    blurb: "Always first to the controller.",
    icon: "calendar",
    accent: ACCENT.blue,
    stat: (s) => `${s.value}`,
    statLabel: () => "games played",
  },
  nearlyMan: {
    title: "So Close",
    blurb: "Just one goal away. Again.",
    icon: "clock",
    accent: ACCENT.grey,
    stat: (s) => `${s.value}`,
    statLabel: (s) => `one-goal ${noun(s.value, "defeat")}`,
  },
  flatTrackBully: {
    title: "Flat-track Bully",
    blurb: "Feasts on the lower half of the table.",
    icon: "flame",
    accent: ACCENT.red,
    stat: (s) => `${s.value}`,
    statLabel: (s) => `${noun(s.value, "win")} over lower-rated players`,
  },
  squadPlayer: {
    title: "Squad Player",
    blurb: "Quietly putting the games in.",
    icon: "users",
    accent: ACCENT.grey,
    stat: (s) => `${s.value}`,
    statLabel: (s) => `${noun(s.value, "game")} played`,
  },
  newSigning: {
    title: "New Signing",
    blurb: "",
    icon: "plus",
    accent: ACCENT.grey,
    stat: (s) => `${s.value}`,
    statLabel: (s) => `${noun(s.value, "game")} so far`,
  },
};

export function superlativeText(superlative: Superlative): CalloutText {
  const copy = SUPERLATIVE_COPY[superlative.key];
  const left = Math.max(1, CALLOUT_MIN_GAMES - superlative.games);
  return {
    title: copy.title,
    line:
      superlative.key === "newSigning"
        ? `${left} more ${noun(left, "game")} to earn a title.`
        : copy.blurb,
    stat: copy.stat(superlative),
    statLabel: copy.statLabel(superlative),
    icon: copy.icon,
    accent: copy.accent,
  };
}

// --- Feuds -----------------------------------------------------------------------------

const FEUD_COPY: Record<FeudKey, { title: string; icon: IconName; accent: string }> = {
  mostPlayed: { title: "Old rivals", icon: "swords", accent: ACCENT.fire },
  oneSided: { title: "One-way traffic", icon: "arrowRight", accent: ACCENT.red },
  deadHeat: { title: "Dead heat", icon: "handshake", accent: ACCENT.teal },
};

export function feudText(feud: Feud, name: NameOf): CalloutText {
  const a = name(feud.playerId);
  const b = name(feud.otherId);
  const copy = FEUD_COPY[feud.key];
  const line = {
    mostPlayed: `${feud.games} meetings and counting. These two can't stay away.`,
    oneSided:
      feud.d === 0 && feud.l === 0
        ? `${a} has won all ${feud.games}. ${b} would like a word.`
        : `${a} has ${b}'s number: ${feud.gf}–${feud.ga} on goals.`,
    deadHeat:
      feud.w === feud.l
        ? `${feud.games} games and nothing to split them.`
        : `${feud.games} games, one win in it. Nobody's backing down.`,
  }[feud.key];
  return {
    title: copy.title,
    line,
    stat: `${feud.w}–${feud.d}–${feud.l}`,
    statLabel: "W–D–L",
    icon: copy.icon,
    accent: copy.accent,
  };
}
