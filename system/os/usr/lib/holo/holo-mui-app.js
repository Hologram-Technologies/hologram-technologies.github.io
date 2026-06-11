// holo-mui-app.js — turnkey mount for an MUI holospace. Pair with holo-theme.js +
// holo-mui.js (which inject the theme engine + the content-addressed import map). Then a
// whole themed React app is:
//
//   import { mount } from "/_shared/holo-mui-app.js";
//   import { Button } from "@mui/material";
//   mount(document.getElementById("root"), () => <Button>Hi</Button>);  // (or React.createElement)
//
// mount() handles ThemeProvider + CssBaseline + building the theme from Holo Theme tokens
// AND re-building it live whenever the OS theme changes — so the app stays wired to the
// single source of truth with zero boilerplate.

import React from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider, createTheme, CssBaseline } from "@mui/material";

export function makeTheme(extra) { return createTheme(window.HoloMUI.themeOptions(extra)); }

export function HoloThemeProvider(props) {
  const mk = () => makeTheme(props.themeExtra);
  const [theme, setTheme] = React.useState(mk);
  React.useEffect(() => window.HoloMUI.onChange(() => setTheme(mk())), []);
  return React.createElement(ThemeProvider, { theme },
    props.disableCssBaseline ? null : React.createElement(CssBaseline, null),
    props.children);
}

export function mount(rootEl, App, opts) {
  opts = opts || {};
  const root = createRoot(rootEl);
  root.render(React.createElement(HoloThemeProvider, { themeExtra: opts.themeExtra, disableCssBaseline: opts.disableCssBaseline },
    React.createElement(App)));
  return root;
}

export { React, createRoot };
