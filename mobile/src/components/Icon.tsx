/**
 * Generic football iconography (no branding), ported from the prototype's inline SVGs
 * to react-native-svg. Stroke-based, inherits `color`.
 */
import type { JSX } from "react";
import Svg, { Path, Circle, Polyline, Rect, G } from "react-native-svg";
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
  | "camera"
  | "flame"
  | "trophy"
  | "crown"
  | "medal"
  | "swords"
  | "ball"
  | "jersey"
  | "check"
  | "photo"
  | "edit"
  | "bolt"
  | "info"
  | "boot"
  | "glove"
  | "trend"
  | "target"
  | "shield"
  | "crosshair"
  | "award"
  | "handshake"
  | "settings"
  | "eye"
  | "eyeOff";

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
    camera: (
      <G {...common}>
        <Path d="M3 8h3l1.5-2h9L18 8h3v11H3z" {...common} />
        <Circle cx="12" cy="13" r="3.5" {...common} />
      </G>
    ),
    flame: (
      <Path
        d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"
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
        <Polyline points="14.5 17.5 3 6 3 3 6 3 17.5 14.5" {...common} />
        <Path d="M13 19l6-6M16 16l4 4M19 21l2-2" {...common} />
        <Polyline points="14.5 6.5 18 3 21 3 21 6 17.5 9.5" {...common} />
        <Path d="M5 14l4 4M7 17l-3 3M3 19l2 2" {...common} />
      </G>
    ),
    ball: (
      <G {...common}>
        <Circle cx="12" cy="12" r="9" {...common} />
        <Path d="m12 7 3 2.2-1.1 3.6h-3.8L9 9.2 12 7Z" {...common} />
      </G>
    ),
    jersey: <Path d="M8 4 4 7l1.5 3L8 9v11h8V9l2.5 1L20 7l-4-3-2 1.5h-4L8 4Z" {...common} />,
    check: <Path d="M5 12.5 10 17 19 7" {...common} />,
    photo: (
      <G {...common}>
        <Rect x="3" y="4" width="18" height="16" rx="2" {...common} />
        <Circle cx="9" cy="10" r="2" {...common} />
        <Path d="m4 18 5-4 4 3 3-2 4 3" {...common} />
      </G>
    ),
    edit: <Path d="M4 20h4L18 10l-4-4L4 16v4ZM13 7l4 4" {...common} />,
    bolt: (
      <Path
        d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"
        {...common}
      />
    ),
    info: (
      <G {...common}>
        <Circle cx="12" cy="12" r="9" {...common} />
        <Path d="M12 11v5M12 8h.01" {...common} />
      </G>
    ),
    boot: (
      <Path
        d="M6 4v7l-1.6 1.3A2.2 2.2 0 0 0 5.8 16.5H18a3.2 3.2 0 0 0 .4-6.4L11 8.6V4H6ZM4 19h16"
        {...common}
      />
    ),
    glove: (
      <Path
        d="M18 11V6a2 2 0 0 0-2-2 2 2 0 0 0-2 2M14 10V4a2 2 0 0 0-2-2 2 2 0 0 0-2 2v2M10 10.5V6a2 2 0 0 0-2-2 2 2 0 0 0-2 2v8M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"
        {...common}
      />
    ),
    trend: <Path d="M3 17l6-6 4 4 8-8M15 7h6v6" {...common} />,
    target: (
      <G {...common}>
        <Circle cx="12" cy="12" r="10" {...common} />
        <Circle cx="12" cy="12" r="6" {...common} />
        <Circle cx="12" cy="12" r="2" {...common} />
      </G>
    ),
    shield: (
      <Path
        d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"
        {...common}
      />
    ),
    crosshair: (
      <G {...common}>
        <Circle cx="12" cy="12" r="10" {...common} />
        <Path d="M22 12h-4M6 12H2M12 6V2M12 22v-4" {...common} />
      </G>
    ),
    award: (
      <G {...common}>
        <Path
          d="m15.477 12.89 1.515 8.526a.5.5 0 0 1-.81.47l-3.58-2.687a1 1 0 0 0-1.197 0l-3.586 2.686a.5.5 0 0 1-.81-.469l1.514-8.526"
          {...common}
        />
        <Circle cx="12" cy="8" r="6" {...common} />
      </G>
    ),
    handshake: (
      <G {...common}>
        <Path d="m11 17 2 2a1 1 0 1 0 3-3" {...common} />
        <Path
          d="m14 14 2.5 2.5a1 1 0 1 0 3-3l-3.88-3.88a3 3 0 0 0-4.24 0l-.88.88a1 1 0 1 1-3-3l2.81-2.81a5.79 5.79 0 0 1 7.06-.87l.47.28a2 2 0 0 0 1.42.25L21 4"
          {...common}
        />
        <Path d="m21 3 1 11h-2" {...common} />
        <Path d="M3 3 2 14l6.5 6.5a1 1 0 1 0 3-3" {...common} />
        <Path d="M3 4h8" {...common} />
      </G>
    ),
    settings: (
      <G {...common}>
        <Path d="M4 7h2.8M11.2 7H20M4 12h8.8M17.2 12H20M4 17h0.8M9.2 17H20" {...common} />
        <Circle cx="9" cy="7" r="2.2" {...common} />
        <Circle cx="15" cy="12" r="2.2" {...common} />
        <Circle cx="7" cy="17" r="2.2" {...common} />
      </G>
    ),
    eye: (
      <G {...common}>
        <Path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" {...common} />
        <Circle cx="12" cy="12" r="3" {...common} />
      </G>
    ),
    eyeOff: (
      <G {...common}>
        <Path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" {...common} />
        <Circle cx="12" cy="12" r="3" {...common} />
        <Path d="M4 4l16 16" {...common} />
      </G>
    ),
  };
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {paths[name]}
    </Svg>
  );
}
