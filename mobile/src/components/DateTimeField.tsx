/**
 * Tappable date + time field with a self-contained picker sheet. Hand-rolled rather than
 * pulling in a native picker: the app ships on web as well as iOS, and this keeps one
 * behaviour (and one look) on both without another native module in the build.
 */
import { useEffect, useRef, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button } from "./Button";
import { Icon } from "./Icon";
import { Txt } from "./Txt";
import { colors, radius, spacing } from "@/theme";
import { withAlpha } from "@/lib/color";
import {
  MINUTE_STEP,
  WEEKDAY_INITIALS,
  addMonths,
  formatDateTime,
  isSameDay,
  isSameMonth,
  monthGrid,
  monthLabel,
  pad2,
  startOfDay,
  startOfMonth,
  withDay,
  withTime,
} from "@/lib/calendar";

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);
const MINUTES = Array.from({ length: 60 / MINUTE_STEP }, (_, index) => index * MINUTE_STEP);

/** Chip width + row gap — the scroll offset maths needs both to land on a selection. */
const CHIP_WIDTH = 52;
const CHIP_GAP = spacing.sm;
const CHIP_STRIDE = CHIP_WIDTH + CHIP_GAP;

export interface DateTimeFieldProps {
  label: string;
  value: Date;
  onChange: (next: Date) => void;
  /** Earliest selectable day; earlier days render disabled. */
  minimumDate?: Date;
  /** Small line under the field — a hint, or a validation error when `invalid`. */
  helper?: string;
  invalid?: boolean;
}

export function DateTimeField({
  label,
  value,
  onChange,
  minimumDate,
  helper,
  invalid,
}: DateTimeFieldProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const [month, setMonth] = useState(() => startOfMonth(value));
  const hourScroll = useRef<ScrollView>(null);
  const minuteScroll = useRef<ScrollView>(null);

  // Open the time rows on the current selection instead of at midnight.
  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => {
      hourScroll.current?.scrollTo({ x: CHIP_STRIDE * (draft.getHours() - 1), animated: false });
      minuteScroll.current?.scrollTo({
        x: CHIP_STRIDE * (Math.floor(draft.getMinutes() / MINUTE_STEP) - 1),
        animated: false,
      });
    }, 0);
    return () => clearTimeout(timer);
  }, [open]);

  function openPicker() {
    setDraft(value);
    setMonth(startOfMonth(value));
    setOpen(true);
  }

  function commit() {
    onChange(draft);
    setOpen(false);
  }

  const minimum = minimumDate ? startOfDay(minimumDate) : null;
  const days = monthGrid(month);

  return (
    <View style={styles.wrap}>
      <Txt variant="head" size={11} color={colors.textDim} style={styles.label}>
        {label.toUpperCase()}
      </Txt>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${formatDateTime(value)}`}
        onPress={openPicker}
        style={[styles.field, invalid && styles.fieldInvalid]}
      >
        <Icon name="calendar" size={17} color={invalid ? colors.loss : colors.accent} />
        <Txt size={14} style={{ flex: 1 }} numberOfLines={1}>
          {formatDateTime(value)}
        </Txt>
        <Icon name="chevron" size={15} color={colors.textDim} />
      </Pressable>
      {helper ? (
        <Txt size={11} color={invalid ? colors.loss : colors.textDim} style={styles.helper}>
          {helper}
        </Txt>
      ) : null}

      <Modal
        visible={open}
        animationType="slide"
        transparent
        statusBarTranslucent
        onRequestClose={() => setOpen(false)}
      >
        <View style={styles.overlay}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Close ${label} picker`}
            onPress={() => setOpen(false)}
            style={StyleSheet.absoluteFill}
          />
          <View style={styles.sheet}>
            <SafeAreaView edges={["bottom"]}>
              <View style={styles.handle} />
              <View style={styles.header}>
                <View style={{ flex: 1 }}>
                  <Txt variant="head" size={17}>
                    {label}
                  </Txt>
                  <Txt variant="mono" size={11.5} color={colors.accent} style={{ marginTop: 2 }}>
                    {formatDateTime(draft)}
                  </Txt>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Close"
                  onPress={() => setOpen(false)}
                  style={styles.iconButton}
                >
                  <Icon name="x" size={19} stroke={2.5} />
                </Pressable>
              </View>

              <View style={styles.monthBar}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Previous month"
                  onPress={() => setMonth(addMonths(month, -1))}
                  style={styles.monthArrow}
                >
                  <Icon name="back" size={16} color={colors.textDim} />
                </Pressable>
                <Txt variant="head" size={14}>
                  {monthLabel(month)}
                </Txt>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Next month"
                  onPress={() => setMonth(addMonths(month, 1))}
                  style={styles.monthArrow}
                >
                  <Icon name="chevron" size={16} color={colors.textDim} />
                </Pressable>
              </View>

              <View style={styles.weekRow}>
                {WEEKDAY_INITIALS.map((initial, index) => (
                  <Txt
                    key={index}
                    variant="mono"
                    size={10.5}
                    color={colors.textFaint}
                    style={styles.weekCell}
                  >
                    {initial}
                  </Txt>
                ))}
              </View>

              <View style={styles.grid}>
                {days.map((day) => {
                  const selected = isSameDay(day, draft);
                  const outside = !isSameMonth(day, month);
                  const disabled = !!minimum && day < minimum;
                  return (
                    <Pressable
                      key={day.toISOString()}
                      accessibilityRole="button"
                      accessibilityState={{ selected, disabled }}
                      disabled={disabled}
                      onPress={() => {
                        setDraft(withDay(draft, day));
                        // Tapping a leading/trailing cell follows that month, so the
                        // selection never sits outside the grid on screen.
                        if (outside) setMonth(startOfMonth(day));
                      }}
                      style={[styles.dayCell, selected && styles.daySelected]}
                    >
                      <Txt
                        variant={selected ? "monoBold" : "mono"}
                        size={13}
                        color={
                          selected
                            ? colors.onAccent
                            : disabled
                              ? colors.textFaint
                              : outside
                                ? colors.textDim
                                : colors.text
                        }
                      >
                        {day.getDate()}
                      </Txt>
                    </Pressable>
                  );
                })}
              </View>

              <View style={styles.timeBlock}>
                <TimeRow
                  ref={hourScroll}
                  label="HOUR"
                  values={HOURS}
                  selected={draft.getHours()}
                  onSelect={(hour) => setDraft(withTime(draft, hour, draft.getMinutes()))}
                />
                <TimeRow
                  ref={minuteScroll}
                  label="MINUTE"
                  values={MINUTES}
                  selected={Math.floor(draft.getMinutes() / MINUTE_STEP) * MINUTE_STEP}
                  onSelect={(minute) => setDraft(withTime(draft, draft.getHours(), minute))}
                />
              </View>

              <Button full onPress={commit} style={styles.done}>
                Done
              </Button>
            </SafeAreaView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function TimeRow({
  ref,
  label,
  values,
  selected,
  onSelect,
}: {
  ref: React.RefObject<ScrollView | null>;
  label: string;
  values: number[];
  selected: number;
  onSelect: (value: number) => void;
}) {
  return (
    <View>
      <Txt variant="head" size={10} color={colors.textDim} style={styles.timeLabel}>
        {label}
      </Txt>
      <ScrollView
        ref={ref}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.timeRow}
      >
        {values.map((entry) => {
          const active = entry === selected;
          return (
            <Pressable
              key={entry}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              onPress={() => onSelect(entry)}
              style={[styles.timeChip, active && styles.timeChipActive]}
            >
              <Txt
                variant={active ? "monoBold" : "mono"}
                size={14}
                color={active ? colors.onAccent : colors.text}
              >
                {pad2(entry)}
              </Txt>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: spacing.md },
  label: { letterSpacing: 1.1, marginBottom: 6 },
  field: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.sm,
    backgroundColor: colors.bg,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
  },
  fieldInvalid: { borderColor: withAlpha(colors.loss, 0.55) },
  helper: { marginTop: 5 },
  overlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.58)" },
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: colors.line,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  handle: {
    alignSelf: "center",
    width: 42,
    height: 4,
    marginTop: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.textFaint,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
  },
  iconButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  monthBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingBottom: spacing.sm,
  },
  monthArrow: {
    width: 38,
    height: 38,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
  },
  weekRow: { flexDirection: "row" },
  weekCell: { width: `${100 / 7}%`, textAlign: "center", paddingVertical: 6 },
  grid: { flexDirection: "row", flexWrap: "wrap", paddingBottom: spacing.sm },
  dayCell: {
    width: `${100 / 7}%`,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.sm,
  },
  daySelected: { backgroundColor: colors.accent },
  timeBlock: {
    gap: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  timeLabel: { letterSpacing: 1.1, marginBottom: 6 },
  timeRow: { gap: CHIP_GAP, paddingRight: spacing.lg },
  timeChip: {
    width: CHIP_WIDTH,
    paddingVertical: 9,
    alignItems: "center",
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  timeChipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  done: { marginTop: spacing.lg },
});
