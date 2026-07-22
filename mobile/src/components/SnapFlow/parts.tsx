import { Pressable, TextInput, View } from "react-native";
import { Button, Txt } from "@/components";
import { colors } from "@/theme";
import { parseStatInput } from "./helpers";
import { styles } from "./styles";

export function ProgressBar({
  current,
  total,
  label,
}: {
  current: number;
  total: number;
  label: string;
}) {
  return (
    <View>
      <View style={styles.progressHeader}>
        <Txt size={11.5} color={colors.textDim}>
          Step {current + 1} of {total} · {label}
        </Txt>
      </View>
      <View style={styles.track}>
        {Array.from({ length: total }).map((_, i) => (
          <View key={i} style={[styles.trackSeg, i <= current && styles.trackSegOn]} />
        ))}
      </View>
    </View>
  );
}

export function FlowFooter({
  onBack,
  onNext,
  nextLabel = "Continue",
  nextDisabled,
  hideNext,
  loading,
}: {
  onBack: () => void;
  onNext: () => void;
  nextLabel?: string;
  nextDisabled?: boolean;
  hideNext?: boolean;
  loading?: boolean;
}) {
  return (
    <View style={styles.footer}>
      <Button variant="dark" size="md" icon="back" onPress={onBack}>
        Back
      </Button>
      {!hideNext ? (
        <Button
          size="md"
          icon={nextLabel === "Submit match" ? "check" : undefined}
          onPress={() => onNext()}
          disabled={nextDisabled || loading}
        >
          {loading ? "Submitting…" : nextLabel}
        </Button>
      ) : null}
    </View>
  );
}

export function ScoreBox({
  label,
  value,
  color,
  onChange,
}: {
  label: string;
  value: number;
  color: string;
  onChange: (v: number) => void;
}) {
  return (
    <View style={{ flex: 1, alignItems: "center" }}>
      <Txt size={11} color={colors.textDim} numberOfLines={1}>
        {label}
      </Txt>
      <View style={styles.stepper}>
        <Pressable
          onPress={() => onChange(Math.max(0, value - 1))}
          disabled={value === 0}
          style={[styles.stepBtn, value === 0 && { opacity: 0.35 }]}
        >
          <Txt variant="monoBold" size={22}>
            -
          </Txt>
        </Pressable>
        <TextInput
          value={String(value)}
          onChangeText={(t) => {
            const n = Number.parseInt(t.replace(/[^0-9]/g, ""), 10);
            onChange(Number.isFinite(n) ? Math.min(99, n) : 0);
          }}
          keyboardType="number-pad"
          selectTextOnFocus
          style={[styles.scoreInput, { color }]}
        />
        <Pressable onPress={() => onChange(Math.min(99, value + 1))} style={styles.stepBtn}>
          <Txt variant="monoBold" size={22}>
            +
          </Txt>
        </Pressable>
      </View>
    </View>
  );
}

export function StatEditRow({
  label,
  myValue,
  oppValue,
  onChangeMy,
  onChangeOpp,
}: {
  label: string;
  myValue: number | null;
  oppValue: number | null;
  onChangeMy: (v: number | null) => void;
  onChangeOpp: (v: number | null) => void;
}) {
  return (
    <View style={styles.statEditRow}>
      <Txt size={12} color={colors.textDim} style={{ width: 110 }}>
        {label}
      </Txt>
      <View style={styles.statEditFields}>
        <TextInput
          value={myValue != null ? String(myValue) : ""}
          onChangeText={(t) => onChangeMy(parseStatInput(t))}
          placeholder="—"
          placeholderTextColor={colors.textFaint}
          keyboardType="numeric"
          style={styles.statInput}
        />
        <Txt size={12} color={colors.textFaint}>
          vs
        </Txt>
        <TextInput
          value={oppValue != null ? String(oppValue) : ""}
          onChangeText={(t) => onChangeOpp(parseStatInput(t))}
          placeholder="—"
          placeholderTextColor={colors.textFaint}
          keyboardType="numeric"
          style={styles.statInput}
        />
      </View>
    </View>
  );
}
