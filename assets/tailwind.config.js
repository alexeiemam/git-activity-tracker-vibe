tailwind.config = {
  theme: {
    extend: {
      fontFamily: {
        sans: ['IBM Plex Sans', 'ui-sans-serif', 'system-ui'],
        mono: ['IBM Plex Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      colors: {
        bg: 'var(--bg)',
        surface: 'var(--surface)',
        border: 'var(--border)',
        border2: 'var(--border2)',
        text: 'var(--text)',
        muted: 'var(--muted)',
        ink: 'var(--ink)',
        accent: 'var(--accent)',
        accent2: 'var(--accent2)',
        c0: 'var(--c0)',
        c1: 'var(--c1)',
        c2: 'var(--c2)',
        c3: 'var(--c3)',
        c4: 'var(--c4)',
        added: 'var(--added)',
        deleted: 'var(--deleted)',
        mergebg: 'var(--merge-bg)',
        mergeborder: 'var(--merge-border)',
      },
      boxShadow: {
        ink: '0 8px 32px rgba(0,0,0,0.28), 0 1px 0 rgba(255,255,255,0.04)',
      },
    },
  },
};
