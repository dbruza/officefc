/**
 * "Wrapped"-style story shell for the season recap: segmented progress bars on top,
 * left/right tap halves, ← → keys on web, and a footer with previous/next (plus any
 * slide-specific actions, e.g. share on the last card). Phones get a full-bleed story;
 * tablets and desktops a centred ~9:16 card sized to the window.
 *
 * Slides are plain render functions so each remounts on entry — that replays its
 * Reveal/CountUp choreography every time it's shown, which is the point of a story.
 */
import { useState, type ReactNode } from "react";
import { Pressable, StyleSheet, View, type LayoutChangeEvent } from "react-native";
import Animated, { useReducedMotion, type CSSAnimationKeyframes } from "react-native-reanimated";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { EASE_OUT, IconButton, Reveal, Txt } from "@/components";
import { colors, radius, spacing } from "@/theme";
import { useBreakpoint } from "@/lib/responsive";
import { useHotkey, webStyle } from "@/lib/web";

export interface StorySlide {
  key: string;
  /** Accessible name, e.g. "Champion". */
  title: string;
  /** Wash colour bleeding in from the top of the card. */
  tint: string;
  render: () => ReactNode;
  /** The slide has its own controls/scrolling: no tap-to-advance halves over it. */
  interactive?: boolean;
}

const FOOTER_H = 56;
const MAX_CARD_H = 820;

const FILL: CSSAnimationKeyframes = {
  from: { width: "0%" },
  to: { width: "100%" },
};

export function RecapStory({
  slides,
  actions,
}: {
  slides: StorySlide[];
  /** Extra footer controls for the current slide (rendered between prev/next). */
  actions?: (slideKey: string) => ReactNode;
}) {
  const { isTablet, isWeb, width: winW, height: winH } = useBreakpoint();
  const reduced = useReducedMotion();
  const [index, setIndex] = useState(0);
  const [direction, setDirection] = useState<1 | -1>(1);
  const [box, setBox] = useState({ w: 0, h: 0 });

  const last = slides.length - 1;
  const at = Math.min(index, last);
  const slide = slides[at];

  const go = (next: number) => {
    const clamped = Math.max(0, Math.min(last, next));
    if (clamped === at) return;
    setDirection(clamped > at ? 1 : -1);
    setIndex(clamped);
  };
  const next = () => go(at + 1);
  const prev = () => go(at - 1);
  useHotkey("ArrowRight", next);
  useHotkey("ArrowLeft", prev);

  // Card size: phones fill the area; larger screens fit a 9:16 card to the window. Until
  // the area is measured, estimate from the window so the first frame isn't empty.
  const areaW = box.w > 0 ? box.w : isTablet ? Math.max(320, winW - 400) : winW;
  const areaH = Math.max(0, (box.h > 0 ? box.h : winH - 160) - FOOTER_H - spacing.md);
  let cardH = areaH;
  let cardW = areaW;
  if (isTablet) {
    cardH = Math.min(areaH, MAX_CARD_H);
    cardW = Math.min(areaW, Math.round((cardH * 9) / 16));
    cardH = Math.min(cardH, Math.round((cardW * 16) / 9));
  }

  const extra = slide ? actions?.(slide.key) : null;

  return (
    <View
      style={styles.area}
      onLayout={(e: LayoutChangeEvent) =>
        setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })
      }
    >
      {slide ? (
        <>
          <View
            style={[
              styles.card,
              { width: cardW, height: cardH },
              !isTablet && styles.cardBleed,
              isTablet && webStyle({ boxShadow: "0 24px 64px rgba(0,0,0,0.5)" }),
            ]}
            accessibilityLabel={`Slide ${at + 1} of ${slides.length}: ${slide.title}`}
          >
            <Wash tint={slide.tint} />
            <Reveal
              key={slide.key}
              from={direction > 0 ? "left" : "right"}
              duration={320}
              style={StyleSheet.absoluteFill}
            >
              <View style={styles.slideBody}>{slide.render()}</View>
            </Reveal>

            {!slide.interactive ? (
              <View style={styles.zones}>
                {/* Pointer/touch shortcuts only: the footer arrows (and ← →) are the
                    accessible controls, so these stay out of the tab order and a11y tree. */}
                <Pressable
                  onPress={prev}
                  disabled={at === 0}
                  focusable={false}
                  importantForAccessibility="no-hide-descendants"
                  accessibilityElementsHidden
                  style={[styles.zone, webStyle({ cursor: at === 0 ? "default" : "pointer" })]}
                />
                <Pressable
                  onPress={next}
                  disabled={at === last}
                  focusable={false}
                  importantForAccessibility="no-hide-descendants"
                  accessibilityElementsHidden
                  style={[styles.zone, webStyle({ cursor: at === last ? "default" : "pointer" })]}
                />
              </View>
            ) : null}

            <View style={styles.progress}>
              {slides.map((item, i) => (
                <View key={item.key} style={styles.segment}>
                  {i < at ? (
                    <View style={styles.segmentFill} />
                  ) : i === at ? (
                    <Animated.View
                      key={`fill-${at}`}
                      style={{
                        ...styles.segmentFill,
                        ...(reduced
                          ? null
                          : {
                              animationName: FILL,
                              animationDuration: 600,
                              animationTimingFunction: EASE_OUT,
                              animationFillMode: "backwards",
                            }),
                      }}
                    />
                  ) : null}
                </View>
              ))}
            </View>
          </View>

          <View
            style={[
              styles.footer,
              isTablet
                ? { width: Math.max(cardW, 360) }
                : { width: "100%", paddingHorizontal: spacing.lg },
            ]}
          >
            <IconButton
              icon="back"
              accessibilityLabel="Previous slide"
              onPress={prev}
              disabled={at === 0}
            />
            <View style={styles.footerMid}>
              {extra ?? (
                <Txt size={12} color={colors.textFaint} style={{ textAlign: "center" }}>
                  {at + 1} / {slides.length}
                  {isWeb && isTablet ? "  ·  ← → to move" : "  ·  tap to move"}
                </Txt>
              )}
            </View>
            {at < last ? (
              <IconButton
                icon="arrowRight"
                accessibilityLabel="Next slide"
                onPress={next}
                tone="accent"
              />
            ) : (
              <IconButton icon="refresh" accessibilityLabel="Watch again" onPress={() => go(0)} />
            )}
          </View>
        </>
      ) : null}
    </View>
  );
}

/** Colour wash from the top of the card, fading out by the middle. */
function Wash({ tint }: { tint: string }) {
  const id = `wash-${tint.replace(/[^a-z0-9]/gi, "")}`;
  return (
    <Svg style={StyleSheet.absoluteFill} width="100%" height="100%" preserveAspectRatio="none">
      <Defs>
        <LinearGradient id={id} x1="0" y1="0" x2="0.35" y2="1">
          <Stop offset="0" stopColor={tint} stopOpacity={0.3} />
          <Stop offset="0.55" stopColor={tint} stopOpacity={0.04} />
          <Stop offset="1" stopColor={tint} stopOpacity={0} />
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${id})`} />
    </Svg>
  );
}

const styles = StyleSheet.create({
  area: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md },
  card: {
    overflow: "hidden",
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  cardBleed: { borderRadius: 0, borderLeftWidth: 0, borderRightWidth: 0 },
  slideBody: {
    flex: 1,
    paddingTop: spacing.x3 + spacing.sm,
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xl,
  },
  zones: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, flexDirection: "row" },
  zone: { flex: 1 },
  progress: {
    pointerEvents: "none",
    position: "absolute",
    top: spacing.md,
    left: spacing.md,
    right: spacing.md,
    flexDirection: "row",
    gap: 4,
  },
  segment: {
    flex: 1,
    height: 3,
    borderRadius: 2,
    overflow: "hidden",
    backgroundColor: colors.lineStrong,
  },
  segmentFill: { height: 3, width: "100%", borderRadius: 2, backgroundColor: colors.text },
  footer: {
    height: FOOTER_H,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.xs,
  },
  footerMid: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
  },
});
