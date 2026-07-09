// box.tsx — Holo ergonomic layout primitives (Chakra-style API, Hologram-native).
//
// The Chakra authoring feel — <Box p={4} bg="surface" rounded="lg">, <Stack gap={3}>, <Grid> —
// WITHOUT the Chakra runtime. Every style prop resolves to a canonical --holo-* token (the
// Chakra-derived foundation in holo-theme.css), so these primitives are themed by the same one
// source as the rest of Holo UI and re-theme live across light · dark · immersive. Authored here
// (MIT), encoded as a content-addressed UOR object like every other catalog element.
import * as React from "react";

// ── token resolvers — map prop values onto the --holo-* scales ──────────────────────────────────
const isScaleNum = (v: unknown) => typeof v === "number" || (typeof v === "string" && /^\d+(\.\d+)?$/.test(v));
const space = (v: any) => {
  if (v == null) return undefined;
  if (isScaleNum(v)) { const k = String(v).replace(".", "p"); return `var(--holo-space-${k}, ${Number(v) * 0.25}rem)`; }
  return v; // "auto", "12px", "2rem", "100%", "var(...)"
};
const color = (v: any) => {
  if (typeof v !== "string") return v;
  if (/^(#|rgb|hsl|oklch|var\(|transparent$|currentColor$|inherit$)/.test(v)) return v;
  const ramp = /^([a-z]+)\.(\d{2,3})$/.exec(v);             // "gray.500"
  if (ramp) return `var(--holo-${ramp[1]}-${ramp[2]})`;
  return `var(--holo-${v})`;                                  // "surface", "ink", "accent", "border", "ink-dim"…
};
const RADII = ["none", "2xs", "xs", "sm", "md", "lg", "xl", "2xl", "3xl", "4xl", "full"];
const radius = (v: any) => typeof v === "number" ? `${v}px` : (RADII.includes(v) ? `var(--holo-radius-${v})` : v);
const shadow = (v: any) => ["xs", "sm", "md", "lg", "xl"].includes(v) ? `var(--holo-shadow-${v})` : v;
const WEIGHTS = ["thin", "extralight", "light", "normal", "medium", "semibold", "bold", "extrabold", "black"];
const weight = (v: any) => WEIGHTS.includes(v) ? `var(--holo-weight-${v})` : v;

// prop → [cssProperty, transform]; spacing props share the `space` resolver, etc.
const M: Record<string, [string, (v: any) => any]> = {
  p: ["padding", space], px: ["paddingInline", space], py: ["paddingBlock", space],
  pt: ["paddingTop", space], pr: ["paddingRight", space], pb: ["paddingBottom", space], pl: ["paddingLeft", space],
  m: ["margin", space], mx: ["marginInline", space], my: ["marginBlock", space],
  mt: ["marginTop", space], mr: ["marginRight", space], mb: ["marginBottom", space], ml: ["marginLeft", space],
  gap: ["gap", space], rowGap: ["rowGap", space], columnGap: ["columnGap", space],
  w: ["width", space], width: ["width", space], h: ["height", space], height: ["height", space],
  minW: ["minWidth", space], maxW: ["maxWidth", space], minH: ["minHeight", space], maxH: ["maxHeight", space],
  bg: ["background", color], background: ["background", color], color: ["color", color], borderColor: ["borderColor", color],
  rounded: ["borderRadius", radius], borderRadius: ["borderRadius", radius],
  shadow: ["boxShadow", shadow], boxShadow: ["boxShadow", shadow],
  fontWeight: ["fontWeight", weight], fontSize: ["fontSize", (v) => v], lineHeight: ["lineHeight", (v) => v], textAlign: ["textAlign", (v) => v],
  align: ["alignItems", (v) => v], alignItems: ["alignItems", (v) => v], justify: ["justifyContent", (v) => v], justifyContent: ["justifyContent", (v) => v],
  direction: ["flexDirection", (v) => v], wrap: ["flexWrap", (v) => v], flex: ["flex", (v) => v], grow: ["flexGrow", (v) => v], shrink: ["flexShrink", (v) => v],
  display: ["display", (v) => v], position: ["position", (v) => v], inset: ["inset", space], top: ["top", space], right: ["right", space], bottom: ["bottom", space], left: ["left", space],
  zIndex: ["zIndex", (v) => v], overflow: ["overflow", (v) => v], opacity: ["opacity", (v) => v],
  templateColumns: ["gridTemplateColumns", (v) => v], templateRows: ["gridTemplateRows", (v) => v], border: ["border", (v) => v],
};

type BoxProps = { as?: any; children?: React.ReactNode; style?: React.CSSProperties; className?: string; [k: string]: any };

function split(props: BoxProps) {
  const style: Record<string, any> = {};
  const rest: Record<string, any> = {};
  for (const k in props) {
    if (k === "as" || k === "style" || k === "children" || k === "className") continue;
    const m = M[k];
    if (m) { const out = m[1](props[k]); if (out !== undefined) style[m[0]] = out; }
    else rest[k] = props[k];
  }
  return { style, rest };
}

export const Box = React.forwardRef<HTMLElement, BoxProps>(function Box({ as: As = "div", style, children, ...props }, ref) {
  const { style: s, rest } = split(props);
  return React.createElement(As, { ref, style: { ...s, ...style }, ...rest }, children);
});

export const Flex = React.forwardRef<HTMLElement, BoxProps>(function Flex(props, ref) {
  return React.createElement(Box, { ref, display: "flex", ...props });
});

export const Stack = React.forwardRef<HTMLElement, BoxProps>(function Stack({ gap = 3, direction = "column", ...props }, ref) {
  return React.createElement(Box, { ref, display: "flex", flexDirection: direction, gap, ...props } as any);
});
export const VStack = React.forwardRef<HTMLElement, BoxProps>(function VStack(props, ref) {
  return React.createElement(Stack, { ref, direction: "column", align: props.align ?? "stretch", ...props });
});
export const HStack = React.forwardRef<HTMLElement, BoxProps>(function HStack(props, ref) {
  return React.createElement(Stack, { ref, direction: "row", align: props.align ?? "center", ...props });
});

export const Grid = React.forwardRef<HTMLElement, BoxProps>(function Grid({ gap = 4, ...props }, ref) {
  return React.createElement(Box, { ref, display: "grid", gap, ...props } as any);
});
export const SimpleGrid = React.forwardRef<HTMLElement, BoxProps>(function SimpleGrid({ columns, minChildWidth, gap = 4, ...props }, ref) {
  const templateColumns = minChildWidth != null
    ? `repeat(auto-fill, minmax(${space(minChildWidth)}, 1fr))`
    : `repeat(${columns ?? 1}, minmax(0, 1fr))`;
  return React.createElement(Box, { ref, display: "grid", gap, templateColumns, ...props } as any);
});

export const Center = React.forwardRef<HTMLElement, BoxProps>(function Center(props, ref) {
  return React.createElement(Box, { ref, display: "grid", style: { placeItems: "center", ...(props.style || {}) }, ...props });
});

export const Container = React.forwardRef<HTMLElement, BoxProps>(function Container({ maxW = "64rem", px = 5, ...props }, ref) {
  return React.createElement(Box, { ref, maxW, px, mx: "auto", w: "100%", ...props } as any);
});

export const Spacer = React.forwardRef<HTMLElement, BoxProps>(function Spacer(props, ref) {
  return React.createElement(Box, { ref, flex: "1 1 0%", style: { alignSelf: "stretch" }, ...props });
});

// default export = a small composition, so the gallery card previews the primitives in action.
const swatch = (bg: string, label: string) =>
  React.createElement(Center, { key: label, bg, color: "ink", rounded: "lg", h: 16, fontWeight: "semibold", shadow: "sm" }, label);
export default function HoloLayoutDemo() {
  return React.createElement(Container, { maxW: "32rem" },
    React.createElement(VStack, { gap: 4 },
      React.createElement(HStack, { gap: 3 },
        swatch("surface-2", "Box"), swatch("surface-2", "Flex"),
        React.createElement(Spacer, {}),
        React.createElement(Center, { bg: "accent", color: "accent-ink", rounded: "lg", px: 5, h: 16, fontWeight: "bold" }, "Stack")),
      React.createElement(SimpleGrid, { columns: 3, gap: 3 },
        swatch("gray.800", "1"), swatch("gray.700", "2"), swatch("gray.600", "3"))));
}
