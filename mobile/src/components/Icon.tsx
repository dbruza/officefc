/**
 * Generic football iconography (no branding), ported from the prototype's inline SVGs
 * to react-native-svg. Stroke-based, inherits `color`.
 */
import type { JSX } from "react";
import Svg, { Path, Circle, Rect, G } from "react-native-svg";
import { colors } from "@/theme";

export type IconName =
  | "home"
  | "board"
  | "seasons"
  | "profile"
  | "plus"
  | "search"
  | "x"
  | "back"
  | "chevron"
  | "up"
  | "down"
  | "camera"
  | "flame"
  | "trophy"
  | "crown"
  | "medal"
  | "swords"
  | "ball"
  | "jersey"
  | "calendar"
  | "check"
  | "photo"
  | "edit"
  | "clock"
  | "bolt"
  | "info";

export interface IconProps {
  name: IconName;
  size?: number;
  stroke?: number;
  color?: string;
}

export function Icon({ name, size = 20, stroke = 2, color = colors.text }: IconProps) {
  const common = {
    stroke: color,
    strokeWidth: stroke,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    fill: "none",
  };
  const paths: Record<IconName, JSX.Element> = {
    home: <Path d="M3 11.5 12 4l9 7.5M5 10v9h14v-9" {...common} />,
    board: <Path d="M4 19V7M10 19V4M16 19v-8M22 19H2" {...common} />,
    seasons: (
      <G {...common}>
        <Circle cx="12" cy="9" r="5" {...common} />
        <Path d="M8 13.5 6.5 21l5.5-3 5.5 3-1.5-7.5" {...common} />
      </G>
    ),
    profile: (
      <G {...common}>
        <Circle cx="12" cy="8" r="4" {...common} />
        <Path d="M4 20c1.5-4 5-5 8-5s6.5 1 8 5" {...common} />
      </G>
    ),
    plus: <Path d="M12 5v14M5 12h14" {...common} />,
    search: (
      <G {...common}>
        <Circle cx="11" cy="11" r="7" {...common} />
        <Path d="m20 20-3.2-3.2" {...common} />
      </G>
    ),
    x: <Path d="M6 6l12 12M18 6 6 18" {...common} />,
    back: <Path d="M15 5l-7 7 7 7" {...common} />,
    chevron: <Path d="M9 6l6 6-6 6" {...common} />,
    up: <Path d="M12 19V5M6 11l6-6 6 6" {...common} />,
    down: <Path d="M12 5v14M18 13l-6 6-6-6" {...common} />,
    camera: (
      <G {...common}>
        <Path d="M3 8h3l1.5-2h9L18 8h3v11H3z" {...common} />
        <Circle cx="12" cy="13" r="3.5" {...common} />
      </G>
    ),
    flame: (
      <Path
        d="M12 3c1 3-2 4-2 7a2 2 0 0 0 4 0c2 2 3 3 3 6a5 5 0 0 1-10 0c0-4 5-6 5-13Z"
        {...common}
      />
    ),
    trophy: (
      <G {...common}>
        <Path d="M7 4h10v4a5 5 0 0 1-10 0V4Z" {...common} />
        <Path
          d="M7 6H4v2a3 3 0 0 0 3 3M17 6h3v2a3 3 0 0 1-3 3M9 19h6M10 15.5V19M14 15.5V19"
          {...common}
        />
      </G>
    ),
    crown: <Path d="M4 8l3 8h10l3-8-4.5 3.5L12 5 8.5 11.5 4 8Z" {...common} />,
    medal: (
      <G {...common}>
        <Circle cx="12" cy="14" r="5" {...common} />
        <Path d="M9 9 7 3h10l-2 6" {...common} />
      </G>
    ),
    swords: (
      <G {...common}>
        <Path d="M4 4h3l9 9-3 3-9-9V4Z" {...common} />
        <Path d="m14 14 6 6M20 4h-3l-4 4M15 9l5 5" {...common} />
      </G>
    ),
    ball: (
      <G {...common}>
        <Circle cx="12" cy="12" r="9" {...common} />
        <Path d="m12 7 3 2.2-1.1 3.6h-3.8L9 9.2 12 7Z" {...common} />
      </G>
    ),
    jersey: <Path d="M8 4 4 7l1.5 3L8 9v11h8V9l2.5 1L20 7l-4-3-2 1.5h-4L8 4Z" {...common} />,
    calendar: (
      <G {...common}>
        <Rect x="3" y="5" width="18" height="16" rx="2" {...common} />
        <Path d="M3 9h18M8 3v4M16 3v4" {...common} />
      </G>
    ),
    check: <Path d="M5 12.5 10 17 19 7" {...common} />,
    photo: (
      <G {...common}>
        <Rect x="3" y="4" width="18" height="16" rx="2" {...common} />
        <Circle cx="9" cy="10" r="2" {...common} />
        <Path d="m4 18 5-4 4 3 3-2 4 3" {...common} />
      </G>
    ),
    edit: <Path d="M4 20h4L18 10l-4-4L4 16v4ZM13 7l4 4" {...common} />,
    clock: (
      <G {...common}>
        <Circle cx="12" cy="12" r="9" {...common} />
        <Path d="M12 7v5l3 2" {...common} />
      </G>
    ),
    bolt: <Path d="M13 3 5 13h6l-1 8 8-10h-6l1-8Z" {...common} />,
    info: (
      <G {...common}>
        <Circle cx="12" cy="12" r="9" {...common} />
        <Path d="M12 11v5M12 8h.01" {...common} />
      </G>
    ),
  };
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {paths[name]}
    </Svg>
  );
}
