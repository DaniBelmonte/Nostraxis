// Colours that SVG and Recharts need as literals. They mirror the tokens in styles.css.
export const ink = { text: '#102a43', text2: '#243b53', muted: '#486581', faint: '#5a7189' };
export const surface = { panel: '#ffffff', panel2: '#eef3fa', panel3: '#e3eaf3', bg: '#f4f7fb' };
export const line = { grid: '#e3eaf3', axis: '#d9e2ee', strong: '#b8c6d8' };
export const status = { ok: '#15803d', warn: '#b45309', err: '#c62828', accent: '#1565c0' };

// Validated light-mode categorical palette; a colour follows its entity, never its rank.
export const series = { blue: '#2a78d6', orange: '#eb6834', aqua: '#1baf7a', yellow: '#eda100', magenta: '#e87ba4', violet: '#6250d6' };
export const palette = [series.blue, series.orange, series.aqua, series.yellow, series.magenta, series.violet];
export const neutral = { strong: '#6b7c93', soft: '#9aa8ba' };
export const providerColors = { claude: series.orange, codex: series.aqua, copilot: series.violet, hermes: series.yellow, unknown: neutral.soft };

// Compared runs get their own palette so two runs of one provider stay distinguishable.
export const runColors = ['#1565c0', '#c2410c', '#0f766e', '#7c3aed', '#4d7c0f'];

export const axisTick = { fontSize: 11, fill: ink.muted };
export const cursorFill = 'rgba(21, 101, 192, 0.08)';
