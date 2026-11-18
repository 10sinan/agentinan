'use strict';
// Colour themes. Each sets the page's CSS variables, the terminals' palette and the 3D map's colours.
//   bg       the space behind everything        surface  tint of the glass panels
//   text     main text                           accent / accent2 / onAccent  highlight colours
//   busy / waiting / idle  session status       term     16-colour terminal palette + fg
(() => {
  const T = (o) => o;
  const THEMES = [
    T({
      id: 'agentinan',
      name: 'Agentinan',
      bg: '#05060b',
      surface: '#161a28',
      text: '#eef1f8',
      accent: '#8b95ff',
      accent2: '#b4a2ff',
      onAccent: '#0b0d1a',
      busy: '#f6b860',
      waiting: '#ff6f86',
      idle: '#6cc8e6',
      term: {
        fg: '#e9ecf5',
        black: '#1b1f2e', red: '#ff6f86', green: '#6fdc9a', yellow: '#f6b860', blue: '#7aa7ff', magenta: '#b4a2ff', cyan: '#6cc8e6', white: '#d9deec',
        brightBlack: '#5b6382', brightRed: '#ff95a6', brightGreen: '#9cf0bd', brightYellow: '#ffd38f', brightBlue: '#a6c4ff', brightMagenta: '#cfc3ff', brightCyan: '#a6e4f5', brightWhite: '#ffffff',
      },
    }),
    T({
      id: 'dracula',
      name: 'Dracula',
      bg: '#121319',
      surface: '#282a36',
      text: '#f8f8f2',
      accent: '#bd93f9',
      accent2: '#ff79c6',
      onAccent: '#1a1b23',
      busy: '#ffb86c',
      waiting: '#ff5555',
      idle: '#8be9fd',
      term: {
        fg: '#f8f8f2',
        black: '#21222c', red: '#ff5555', green: '#50fa7b', yellow: '#f1fa8c', blue: '#bd93f9', magenta: '#ff79c6', cyan: '#8be9fd', white: '#f8f8f2',
        brightBlack: '#6272a4', brightRed: '#ff6e6e', brightGreen: '#69ff94', brightYellow: '#ffffa5', brightBlue: '#d6acff', brightMagenta: '#ff92df', brightCyan: '#a4ffff', brightWhite: '#ffffff',
      },
    }),
    T({
      id: 'tokyo-night',
      name: 'Tokyo Night',
      bg: '#0b0c14',
      surface: '#1a1b26',
      text: '#c0caf5',
      accent: '#7aa2f7',
      accent2: '#bb9af7',
      onAccent: '#11121a',
      busy: '#e0af68',
      waiting: '#f7768e',
      idle: '#7dcfff',
      term: {
        fg: '#c0caf5',
        black: '#15161e', red: '#f7768e', green: '#9ece6a', yellow: '#e0af68', blue: '#7aa2f7', magenta: '#bb9af7', cyan: '#7dcfff', white: '#a9b1d6',
        brightBlack: '#414868', brightRed: '#ff899d', brightGreen: '#9fe044', brightYellow: '#faba4a', brightBlue: '#8db0ff', brightMagenta: '#c7a9ff', brightCyan: '#a4daff', brightWhite: '#c0caf5',
      },
    }),
    T({
      id: 'catppuccin',
      name: 'Catppuccin Mocha',
      bg: '#0d0d16',
      surface: '#1e1e2e',
      text: '#cdd6f4',
      accent: '#cba6f7',
      accent2: '#f5c2e7',
      onAccent: '#1e1e2e',
      busy: '#fab387',
      waiting: '#f38ba8',
      idle: '#89dceb',
      term: {
        fg: '#cdd6f4',
        black: '#45475a', red: '#f38ba8', green: '#a6e3a1', yellow: '#f9e2af', blue: '#89b4fa', magenta: '#f5c2e7', cyan: '#94e2d5', white: '#bac2de',
        brightBlack: '#585b70', brightRed: '#f38ba8', brightGreen: '#a6e3a1', brightYellow: '#f9e2af', brightBlue: '#89b4fa', brightMagenta: '#f5c2e7', brightCyan: '#94e2d5', brightWhite: '#a6adc8',
      },
    }),
    T({
      id: 'nord',
      name: 'Nord',
      bg: '#14181f',
      surface: '#2e3440',
      text: '#eceff4',
      accent: '#88c0d0',
      accent2: '#81a1c1',
      onAccent: '#1d222b',
      busy: '#ebcb8b',
      waiting: '#bf616a',
      idle: '#8fbcbb',
      term: {
        fg: '#d8dee9',
        black: '#3b4252', red: '#bf616a', green: '#a3be8c', yellow: '#ebcb8b', blue: '#81a1c1', magenta: '#b48ead', cyan: '#88c0d0', white: '#e5e9f0',
        brightBlack: '#4c566a', brightRed: '#bf616a', brightGreen: '#a3be8c', brightYellow: '#ebcb8b', brightBlue: '#81a1c1', brightMagenta: '#b48ead', brightCyan: '#8fbcbb', brightWhite: '#eceff4',
      },
    }),
    T({
      id: 'gruvbox',
      name: 'Gruvbox',
      bg: '#121212',
      surface: '#282828',
      text: '#ebdbb2',
      accent: '#83a598',
      accent2: '#d3869b',
      onAccent: '#1d2021',
      busy: '#fe8019',
      waiting: '#fb4934',
      idle: '#8ec07c',
      term: {
        fg: '#ebdbb2',
        black: '#282828', red: '#cc241d', green: '#98971a', yellow: '#d79921', blue: '#458588', magenta: '#b16286', cyan: '#689d6a', white: '#a89984',
        brightBlack: '#928374', brightRed: '#fb4934', brightGreen: '#b8bb26', brightYellow: '#fabd2f', brightBlue: '#83a598', brightMagenta: '#d3869b', brightCyan: '#8ec07c', brightWhite: '#ebdbb2',
      },
    }),
    T({
      id: 'one-dark',
      name: 'One Dark',
      bg: '#101216',
      surface: '#282c34',
      text: '#dcdfe4',
      accent: '#61afef',
      accent2: '#c678dd',
      onAccent: '#16181d',
      busy: '#e5c07b',
      waiting: '#e06c75',
      idle: '#56b6c2',
      term: {
        fg: '#abb2bf',
        black: '#282c34', red: '#e06c75', green: '#98c379', yellow: '#e5c07b', blue: '#61afef', magenta: '#c678dd', cyan: '#56b6c2', white: '#abb2bf',
        brightBlack: '#5c6370', brightRed: '#e06c75', brightGreen: '#98c379', brightYellow: '#e5c07b', brightBlue: '#61afef', brightMagenta: '#c678dd', brightCyan: '#56b6c2', brightWhite: '#ffffff',
      },
    }),
    T({
      id: 'rose-pine',
      name: 'Rosé Pine',
      bg: '#0b0a12',
      surface: '#1f1d2e',
      text: '#e0def4',
      accent: '#c4a7e7',
      accent2: '#ebbcba',
      onAccent: '#191724',
      busy: '#f6c177',
      waiting: '#eb6f92',
      idle: '#9ccfd8',
      term: {
        fg: '#e0def4',
        black: '#26233a', red: '#eb6f92', green: '#31748f', yellow: '#f6c177', blue: '#9ccfd8', magenta: '#c4a7e7', cyan: '#ebbcba', white: '#e0def4',
        brightBlack: '#6e6a86', brightRed: '#eb6f92', brightGreen: '#31748f', brightYellow: '#f6c177', brightBlue: '#9ccfd8', brightMagenta: '#c4a7e7', brightCyan: '#ebbcba', brightWhite: '#e0def4',
      },
    }),
    T({
      id: 'solarized',
      name: 'Solarized Dark',
      bg: '#00141a',
      surface: '#073642',
      text: '#eee8d5',
      accent: '#268bd2',
      accent2: '#6c71c4',
      onAccent: '#fdf6e3',
      busy: '#b58900',
      waiting: '#dc322f',
      idle: '#2aa198',
      term: {
        fg: '#93a1a1',
        black: '#073642', red: '#dc322f', green: '#859900', yellow: '#b58900', blue: '#268bd2', magenta: '#d33682', cyan: '#2aa198', white: '#eee8d5',
        brightBlack: '#586e75', brightRed: '#cb4b16', brightGreen: '#859900', brightYellow: '#b58900', brightBlue: '#839496', brightMagenta: '#6c71c4', brightCyan: '#93a1a1', brightWhite: '#fdf6e3',
      },
    }),
    T({
      id: 'monokai',
      name: 'Monokai',
      bg: '#11120e',
      surface: '#272822',
      text: '#f8f8f2',
      accent: '#a6e22e',
      accent2: '#66d9ef',
      onAccent: '#1a1b16',
      busy: '#fd971f',
      waiting: '#f92672',
      idle: '#66d9ef',
      term: {
        fg: '#f8f8f2',
        black: '#272822', red: '#f92672', green: '#a6e22e', yellow: '#f4bf75', blue: '#66d9ef', magenta: '#ae81ff', cyan: '#a1efe4', white: '#f8f8f2',
        brightBlack: '#75715e', brightRed: '#f92672', brightGreen: '#a6e22e', brightYellow: '#f4bf75', brightBlue: '#66d9ef', brightMagenta: '#ae81ff', brightCyan: '#a1efe4', brightWhite: '#f9f8f5',
      },
    }),
    T({
      id: 'synthwave',
      name: "Synthwave '84",
      bg: '#0f0b1a',
      surface: '#262335',
      text: '#f4eefa',
      accent: '#ff7edb',
      accent2: '#36f9f6',
      onAccent: '#1a1526',
      busy: '#fede5d',
      waiting: '#fe4450',
      idle: '#36f9f6',
      term: {
        fg: '#f4eefa',
        black: '#262335', red: '#fe4450', green: '#72f1b8', yellow: '#fede5d', blue: '#03edf9', magenta: '#ff7edb', cyan: '#36f9f6', white: '#ffffff',
        brightBlack: '#614d85', brightRed: '#fe4450', brightGreen: '#72f1b8', brightYellow: '#fede5d', brightBlue: '#03edf9', brightMagenta: '#ff7edb', brightCyan: '#36f9f6', brightWhite: '#ffffff',
      },
    }),
    T({
      id: 'github-dark',
      name: 'GitHub Dark',
      bg: '#05080c',
      surface: '#161b22',
      text: '#e6edf3',
      accent: '#58a6ff',
      accent2: '#bc8cff',
      onAccent: '#0d1117',
      busy: '#d29922',
      waiting: '#f85149',
      idle: '#39c5cf',
      term: {
        fg: '#e6edf3',
        black: '#484f58', red: '#ff7b72', green: '#3fb950', yellow: '#d29922', blue: '#58a6ff', magenta: '#bc8cff', cyan: '#39c5cf', white: '#b1bac4',
        brightBlack: '#6e7681', brightRed: '#ffa198', brightGreen: '#56d364', brightYellow: '#e3b341', brightBlue: '#79c0ff', brightMagenta: '#d2a8ff', brightCyan: '#56d4dd', brightWhite: '#ffffff',
      },
    }),
  ];

  let current = THEMES[0];

  // xterm.js theme object (transparent background so the glass shows through)
  function xtermTheme(t = current) {
    return {
      ...t.term,
      foreground: t.term.fg,
      background: '#00000000',
      cursor: t.accent,
      cursorAccent: t.bg,
      selectionBackground: t.accent + '55',
    };
  }

  function applyTheme(id) {
    current = THEMES.find((t) => t.id === id) || THEMES[0];
    const t = current;
    const css = {
      '--bg': t.bg,
      '--surface': t.surface,
      '--text': t.text,
      '--accent': t.accent,
      '--accent-2': t.accent2,
      '--on-accent': t.onAccent,
      '--busy': t.busy,
      '--waiting': t.waiting,
      '--idle': t.idle,
      '--green': t.term.green,
    };
    const root = document.documentElement.style;
    for (const [k, v] of Object.entries(css)) root.setProperty(k, v);
    window.dispatchEvent(new CustomEvent('dash:theme', { detail: t }));
    return t;
  }

  window.themes = { list: THEMES, apply: applyTheme, current: () => current, xterm: xtermTheme };

  // Apply the last theme right away (before the settings arrive) so the page never flashes the default colours.
  try {
    const saved = localStorage.getItem('theme');
    if (saved) applyTheme(saved);
  } catch {}
})();
