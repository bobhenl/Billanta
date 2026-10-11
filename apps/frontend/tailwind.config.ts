import type { Config } from 'tailwindcss';

// A considered light/dark palette (see app/globals.css for the actual HSL
// values and the rationale comment above them) plus semantic status colors
// for invoice states (draft/pending_review/issued/paid/cancelled), shared
// by both the marketing site and the dashboard so the whole product reads
// as one brand.
const config: Config = {
  darkMode: ['class'],
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    container: {
      center: true,
      padding: '1rem',
      screens: {
        '2xl': '1280px'
      }
    },
    extend: {
      fontFamily: {
        // One family everywhere (Inter, loaded in app/[locale]/layout.tsx as
        // `--font-sans`). `font-display` stays as an alias for headline
        // spots so call sites need not change; it only tightens tracking.
        sans: ['var(--font-sans)', 'system-ui', 'Segoe UI', 'Roboto', 'sans-serif'],
        display: ['var(--font-sans)', 'system-ui', 'Segoe UI', 'Roboto', 'sans-serif']
      },
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))'
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))'
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))'
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))'
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))'
        },
        warning: {
          DEFAULT: 'hsl(var(--warning))',
          foreground: 'hsl(var(--warning-foreground))'
        },
        success: {
          DEFAULT: 'hsl(var(--success))',
          foreground: 'hsl(var(--success-foreground))'
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))'
        }
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)'
      }
    }
  },
  plugins: [require('tailwindcss-animate')]
};

export default config;
