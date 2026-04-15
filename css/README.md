# css/ — Stylesheets

| File | Purpose |
|------|---------|
| [style.css](style.css) | Main application stylesheet. Defines CSS custom properties (colors, fonts, spacing), grid and cell layout, candidate display, buttons, panels, and sidebar. |
| [debug.css](debug.css) | Debug panel. Styles for debug overlays, candidate/value group highlighting, and log panel layout. Loaded when the debug tab opens. |
| [flame_graph.css](flame_graph.css) | Flame graph visualization. Container layout, hover effects on flame segments, and value group coloring. Loaded when the flame graph tab opens. |
| [help.css](help.css) | Help/documentation page. Sticky header, table of contents offset, and scroll behavior. Used by [help/index.html](../help/index.html). |
| [sandbox.css](sandbox.css) | Sandbox code editor. Flex layout for the editor and output panels, monospace font, and dark theme for the code area. Used by [sandbox.html](../sandbox.html). |

[style.css](style.css) is loaded on every page. The others are loaded only by their respective pages or lazily when their UI panel is opened.
