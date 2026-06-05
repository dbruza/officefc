/** ELO-over-time line chart (react-native-svg), ported from the prototype. */
import Svg, { Defs, LinearGradient, Stop, Line, Path, Circle } from "react-native-svg";
import { colors } from "@/theme";

export interface ChartPoint {
  date: string;
  rating: number;
}

export function LineChart({
  data,
  width = 326,
  height = 150,
  color = colors.accent,
}: {
  data: ChartPoint[];
  width?: number;
  height?: number;
  color?: string;
}) {
  if (!data || data.length < 2) return null;
  const pad = { t: 14, r: 8, b: 16, l: 8 };
  const ys = data.map((d) => d.rating);
  const minY = Math.min(...ys) - 12;
  const maxY = Math.max(...ys) + 12;
  const X = (i: number) => pad.l + (i / (data.length - 1)) * (width - pad.l - pad.r);
  const Y = (v: number) => pad.t + (1 - (v - minY) / (maxY - minY)) * (height - pad.t - pad.b);
  const line = data
    .map((d, i) => `${i === 0 ? "M" : "L"}${X(i).toFixed(1)},${Y(d.rating).toFixed(1)}`)
    .join(" ");
  const area = `${line} L${X(data.length - 1).toFixed(1)},${height - pad.b} L${X(0).toFixed(1)},${
    height - pad.b
  } Z`;
  const last = data[data.length - 1];
  const gridY = [minY, (minY + maxY) / 2, maxY];

  return (
    <Svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height}>
      <Defs>
        <LinearGradient id="eloFill" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={color} stopOpacity={0.28} />
          <Stop offset="1" stopColor={color} stopOpacity={0} />
        </LinearGradient>
      </Defs>
      {gridY.map((g, i) => (
        <Line
          key={i}
          x1={pad.l}
          x2={width - pad.r}
          y1={Y(g)}
          y2={Y(g)}
          stroke={colors.line}
          strokeWidth={1}
          strokeDasharray="2 4"
        />
      ))}
      <Path d={area} fill="url(#eloFill)" />
      <Path d={line} fill="none" stroke={color} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
      <Circle cx={X(data.length - 1)} cy={Y(last.rating)} r={4.5} fill={color} stroke={colors.bg} strokeWidth={2} />
    </Svg>
  );
}
