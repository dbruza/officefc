/**
 * Full-screen photo viewer for stats screenshots: tap/click the thumbnail to open, tap
 * the backdrop, the close button or press Escape (RN-web maps it to onRequestClose) to
 * dismiss. `PhotoThumb` is the matching inline preview — capped height, real aspect
 * ratio (screenshots are landscape, phone photos portrait), zoom affordance on hover.
 */
import { useEffect, useState } from "react";
import { Image, Modal, StyleSheet, View, useWindowDimensions } from "react-native";
import { IconButton } from "./Button";
import { Icon } from "./Icon";
import { Interactive } from "./Interactive";
import { Reveal } from "./motion";
import { Txt } from "./Txt";
import { colors, radius, spacing } from "@/theme";
import { withAlpha } from "@/lib/color";
import { webStyle } from "@/lib/web";

// Steps remount their thumbnail; remembering ratios avoids a placeholder flash each time.
const aspectCache = new Map<string, number>();

/** Natural aspect ratio (w/h) of a remote or local image, or null until known. */
export function useImageAspect(uri: string | null | undefined): number | null {
  const [aspect, setAspect] = useState<number | null>(() =>
    uri ? (aspectCache.get(uri) ?? null) : null,
  );
  useEffect(() => {
    if (!uri) return;
    const cached = aspectCache.get(uri);
    if (cached) {
      setAspect(cached);
      return;
    }
    let alive = true;
    Image.getSize(
      uri,
      (width, height) => {
        if (width > 0 && height > 0) aspectCache.set(uri, width / height);
        if (alive && width > 0 && height > 0) setAspect(width / height);
      },
      () => {
        if (alive) setAspect(null);
      },
    );
    return () => {
      alive = false;
    };
  }, [uri]);
  return aspect;
}

export function PhotoLightbox({
  uri,
  visible,
  onClose,
  title = "Stats photo",
}: {
  uri: string | null;
  visible: boolean;
  onClose: () => void;
  title?: string;
}) {
  const { width, height } = useWindowDimensions();
  const aspect = useImageAspect(visible ? uri : null) ?? 16 / 9;
  // Fit inside the viewport with a margin, keeping the real aspect ratio.
  const maxW = width - spacing.x2 * 2;
  const maxH = height - 120;
  const fitW = Math.min(maxW, maxH * aspect);
  return (
    <Modal visible={visible && !!uri} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Interactive
          style={[StyleSheet.absoluteFill, webStyle({ cursor: "default" })]}
          onPress={onClose}
          accessibilityLabel="Close photo"
          pressScale={1}
          focusable={false}
        />
        <View style={styles.topBar} pointerEvents="box-none">
          <Txt variant="head" size={14} color={colors.textDim}>
            {title}
          </Txt>
          <IconButton icon="x" accessibilityLabel="Close photo" onPress={onClose} />
        </View>
        {uri ? (
          <Reveal from="scale" duration={220} style={{ width: fitW, aspectRatio: aspect }}>
            <Image
              source={{ uri }}
              style={styles.image}
              resizeMode="contain"
              accessibilityLabel={title}
            />
          </Reveal>
        ) : null}
      </View>
    </Modal>
  );
}

/** Inline photo preview that opens the lightbox. */
export function PhotoThumb({
  uri,
  maxHeight = 360,
  label = "Stats photo",
  style,
}: {
  uri: string;
  maxHeight?: number;
  label?: string;
  style?: object;
}) {
  const [open, setOpen] = useState(false);
  const aspect = useImageAspect(uri);
  return (
    <>
      <Interactive
        onPress={() => setOpen(true)}
        accessibilityLabel={`Open ${label.toLowerCase()} full size`}
        pressScale={0.99}
        style={[
          styles.thumb,
          // Unknown ratio yet: a neutral box at the cap so layout doesn't jump much.
          // Known ratio: full width, but a portrait shot narrows so its height stays at the cap.
          aspect
            ? { aspectRatio: aspect, maxWidth: maxHeight * aspect }
            : { height: Math.min(maxHeight, 220) },
          style,
        ]}
        hoverStyle={{ borderColor: colors.lineStrong }}
      >
        {({ hovered }) => (
          <>
            <Image source={{ uri }} style={styles.image} resizeMode="contain" />
            <View style={[styles.zoomChip, hovered && styles.zoomChipOn]}>
              <Icon name="zoom" size={13} color={colors.text} />
              <Txt size={11} variant="bodyMedium">
                View full size
              </Txt>
            </View>
          </>
        )}
      </Interactive>
      <PhotoLightbox uri={uri} visible={open} onClose={() => setOpen(false)} title={label} />
    </>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(4,6,9,0.9)",
    paddingHorizontal: spacing.x2,
  },
  topBar: {
    position: "absolute",
    top: spacing.lg,
    left: spacing.x2,
    right: spacing.x2,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  image: { width: "100%", height: "100%" },
  thumb: {
    width: "100%",
    alignSelf: "center",
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface2,
    overflow: "hidden",
  },
  zoomChip: {
    position: "absolute",
    right: spacing.sm,
    bottom: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: radius.pill,
    backgroundColor: withAlpha(colors.bg, 0.72),
    opacity: 0.85,
  },
  zoomChipOn: { opacity: 1, backgroundColor: withAlpha(colors.bg, 0.9) },
});
