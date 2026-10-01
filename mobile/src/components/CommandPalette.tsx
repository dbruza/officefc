/**
 * ⌘K / Ctrl+K command palette (web, tablet and up): jump to any screen or player, or
 * start a match against someone, from the keyboard. ↑/↓ to move, Enter to go, Esc to
 * close. Players load lazily on first open and are kept for the session.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { type Href, useRouter } from "expo-router";
import { Avatar } from "./Avatar";
import { Icon, type IconName } from "./Icon";
import { Interactive } from "./Interactive";
import { Reveal } from "./motion";
import { Txt } from "./Txt";
import { colors, elevation, fonts, radius, spacing } from "@/theme";
import { withAlpha } from "@/lib/color";
import { useAuth } from "@/lib/auth";
import { getLeaguePlayers, type LeaguePlayer } from "@/lib/league";
import { webStyle } from "@/lib/web";

interface Command {
  id: string;
  label: string;
  hint?: string;
  icon?: IconName;
  player?: LeaguePlayer;
  href: Href;
  /** Extra words that should match (e.g. "table" for Leaderboard). */
  keywords?: string;
}

let playerCache: LeaguePlayer[] | null = null;

/** Open/close state shared with the SideNav search entry. */
const openListeners = new Set<(open: boolean) => void>();
export function openCommandPalette() {
  openListeners.forEach((fn) => fn(true));
}

export function CommandPalette() {
  const router = useRouter();
  const { user, membership } = useAuth();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const [players, setPlayers] = useState<LeaguePlayer[]>(playerCache ?? []);
  const inputRef = useRef<TextInput>(null);
  // Re-rendered rows fire hover-in under a stationary pointer; only let hover steer the
  // selection after the mouse actually moves, so arrow keys aren't immediately undone.
  const pointerMoved = useRef(false);

  useEffect(() => {
    openListeners.add(setOpen);
    return () => {
      openListeners.delete(setOpen);
    };
  }, []);

  useEffect(() => {
    if (Platform.OS !== "web") return;
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((value) => !value);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setCursor(0);
    // Focus after the overlay mounts.
    const timer = setTimeout(() => inputRef.current?.focus(), 30);
    if (!playerCache) {
      getLeaguePlayers()
        .then((list) => {
          playerCache = list;
          setPlayers(list);
        })
        .catch(() => {});
    }
    return () => clearTimeout(timer);
  }, [open]);

  const screens = useMemo<Command[]>(() => {
    const list: Command[] = [
      { id: "s-home", label: "Home", icon: "home", href: "/(app)/(tabs)" },
      {
        id: "s-log",
        label: "Log a match",
        icon: "plus",
        href: "/(app)/log-match",
        keywords: "new result score",
      },
      {
        id: "s-table",
        label: "League table",
        icon: "board",
        href: "/(app)/(tabs)/leaderboard",
        keywords: "leaderboard standings elo",
      },
      {
        id: "s-inbox",
        label: "Inbox",
        icon: "inbox",
        href: "/(app)/confirmations",
        keywords: "confirm dispute pending",
      },
      {
        id: "s-seasons",
        label: "Seasons & Hall of Fame",
        icon: "seasons",
        href: "/(app)/(tabs)/seasons",
        keywords: "history champions archive",
      },
      {
        id: "s-games",
        label: "Your games",
        icon: "list",
        href: "/(app)/games",
        keywords: "matches history",
      },
      {
        id: "s-h2h",
        label: "Head-to-head",
        icon: "swords",
        href: "/(app)/h2h",
        keywords: "rivalry versus vs",
      },
      {
        id: "s-finals",
        label: "Finals bracket",
        icon: "trophy",
        href: "/(app)/finals",
        keywords: "playoffs",
      },
      { id: "s-cup", label: "Cup", icon: "award", href: "/(app)/cup", keywords: "knockout" },
      {
        id: "s-analytics",
        label: "Analytics",
        icon: "trend",
        href: "/(app)/analytics",
        keywords: "stats teams",
      },
      {
        id: "s-profile",
        label: "Your profile",
        icon: "profile",
        href: "/(app)/(tabs)/profile",
        keywords: "me stats",
      },
      {
        id: "s-settings",
        label: "Settings",
        icon: "settings",
        href: "/(app)/settings",
        keywords: "notifications account",
      },
      {
        id: "s-changelog",
        label: "What's new",
        icon: "sparkle",
        href: "/(app)/changelog",
        keywords: "changelog release",
      },
    ];
    if (membership?.role === "admin") {
      list.push({
        id: "s-admin",
        label: "Admin",
        icon: "shield",
        href: "/(app)/admin",
        keywords: "seasons teams moderation",
      });
    }
    return list;
  }, [membership?.role]);

  const results = useMemo<Command[]>(() => {
    const q = query.trim().toLowerCase();
    const playerCommands: Command[] = players
      .filter((p) => p.id !== user?.uid)
      .map((p) => ({
        id: `p-${p.id}`,
        label: p.name,
        hint: p.handle ? `@${p.handle}` : undefined,
        player: p,
        href: `/(app)/player/${p.id}` as Href,
        keywords: p.handle,
      }));
    if (!q) return [...screens.slice(0, 6), ...playerCommands.slice(0, 5)];
    const matches = (c: Command) =>
      c.label.toLowerCase().includes(q) || (c.keywords ?? "").toLowerCase().includes(q);
    const playerHits = playerCommands.filter(matches);
    // A lone player match also offers "Log match vs …" right under it.
    const versus: Command[] = playerHits.slice(0, 3).map((c) => ({
      id: `v-${c.player!.id}`,
      label: `Log match vs ${c.player!.name.split(" ")[0]}`,
      icon: "plus" as IconName,
      href: `/(app)/log-match?opponent=${c.player!.id}` as Href,
    }));
    return [...playerHits.slice(0, 6), ...versus, ...screens.filter(matches)].slice(0, 12);
  }, [query, players, screens, user?.uid]);

  useEffect(() => {
    setCursor((c) => Math.min(c, Math.max(results.length - 1, 0)));
  }, [results.length]);

  const go = useCallback(
    (command: Command | undefined) => {
      if (!command) return;
      setOpen(false);
      router.push(command.href);
    },
    [router],
  );

  useEffect(() => {
    if (!open || Platform.OS !== "web") return;
    const onMove = () => {
      pointerMoved.current = true;
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key.startsWith("Arrow")) pointerMoved.current = false;
      // Capture phase: while open, the palette owns these keys (see DialogHost).
      if (["Escape", "ArrowDown", "ArrowUp", "Enter"].includes(event.key)) {
        event.stopImmediatePropagation();
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        setCursor((c) => (results.length ? (c + 1) % results.length : 0));
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setCursor((c) => (results.length ? (c - 1 + results.length) % results.length : 0));
      } else if (event.key === "Enter") {
        event.preventDefault();
        go(results[cursor]);
      }
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("mousemove", onMove);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("mousemove", onMove);
    };
  }, [open, results, cursor, go]);

  if (!open) return null;
  return (
    <View style={[StyleSheet.absoluteFill, styles.layer, webStyle({ position: "fixed" })]}>
      <Reveal from="fade" duration={160} style={StyleSheet.absoluteFill}>
        <Pressable
          style={[StyleSheet.absoluteFill, styles.backdrop]}
          onPress={() => setOpen(false)}
          accessibilityLabel="Close search"
        />
      </Reveal>
      <Reveal from="down" duration={220} style={styles.panelWrap}>
        <View
          style={[styles.panel, webStyle({ boxShadow: elevation.overlay })]}
          role="dialog"
          aria-modal
          aria-label="Search players and screens"
          accessibilityViewIsModal
        >
          <View style={styles.inputRow}>
            <Icon name="search" size={18} color={colors.textDim} />
            <TextInput
              ref={inputRef}
              value={query}
              onChangeText={(text) => {
                setQuery(text);
                setCursor(0);
              }}
              placeholder="Jump to a player or screen…"
              placeholderTextColor={colors.textFaint}
              accessibilityLabel="Search players and screens"
              autoCorrect={false}
              autoCapitalize="none"
              style={[styles.input, webStyle({ outlineStyle: "none" }) as object]}
            />
            <View style={styles.kbd}>
              <Txt variant="monoBold" size={10} color={colors.textDim}>
                ESC
              </Txt>
            </View>
          </View>
          <ScrollView style={styles.results} keyboardShouldPersistTaps="handled">
            {results.length === 0 ? (
              <Txt size={13} color={colors.textDim} style={{ padding: spacing.lg }}>
                Nothing matches “{query}”.
              </Txt>
            ) : (
              results.map((command, i) => (
                <Interactive
                  key={command.id}
                  onPress={() => go(command)}
                  onHoverIn={() => {
                    if (pointerMoved.current) setCursor(i);
                  }}
                  accessibilityRole="link"
                  accessibilityState={{ selected: i === cursor }}
                  pressScale={0.99}
                  style={[styles.row, i === cursor && styles.rowActive]}
                >
                  {command.player ? (
                    <Avatar player={command.player} size={28} />
                  ) : (
                    <View style={styles.rowIcon}>
                      <Icon
                        name={command.icon ?? "chevron"}
                        size={15}
                        color={i === cursor ? colors.accent : colors.textDim}
                      />
                    </View>
                  )}
                  <Txt
                    variant={i === cursor ? "bodyMedium" : "body"}
                    size={14}
                    style={{ flex: 1 }}
                    numberOfLines={1}
                  >
                    {command.label}
                  </Txt>
                  {command.hint ? (
                    <Txt size={12} color={colors.textFaint}>
                      {command.hint}
                    </Txt>
                  ) : null}
                  {i === cursor ? <Icon name="arrowRight" size={14} color={colors.accent} /> : null}
                </Interactive>
              ))
            )}
          </ScrollView>
          <View style={styles.footer}>
            <Txt size={11} color={colors.textFaint}>
              ↑↓ to move · Enter to open · ⌘K to toggle
            </Txt>
          </View>
        </View>
      </Reveal>
    </View>
  );
}

const styles = StyleSheet.create({
  layer: { zIndex: 950, alignItems: "center", paddingTop: "12%", paddingHorizontal: spacing.lg },
  backdrop: {
    backgroundColor: withAlpha("#000000", 0.55),
    ...webStyle({ backdropFilter: "blur(4px)" }),
  },
  panelWrap: { width: "100%", maxWidth: 560 },
  panel: {
    width: "100%",
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    backgroundColor: colors.surface,
    overflow: "hidden",
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    height: 56,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  input: { flex: 1, color: colors.text, fontFamily: fonts.body, fontSize: 16 },
  kbd: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: colors.line,
  },
  results: { maxHeight: 380, padding: spacing.sm },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    height: 44,
    borderRadius: radius.sm + 1,
  },
  rowActive: { backgroundColor: withAlpha(colors.accent, 0.08) },
  rowIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface2,
  },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
});
