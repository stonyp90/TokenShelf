import type { Config } from "tailwindcss";

// HSL helper — wraps `hsl(var(--…))` so Tailwind alpha channels work via
// the modern `hsl(<x> / <alpha>)` form.
const hsl = (v: string) => `hsl(var(${v}) / <alpha-value>)`;
const hslRaw = (v: string) => `hsl(var(${v}))`;

export default {
  darkMode: ["class", '[data-theme="dark"]'],
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    container: {
      center: true,
      padding: { DEFAULT: "1rem", sm: "1.5rem", lg: "2rem" },
      screens: { "2xl": "1400px" },
    },
    extend: {
      colors: {
        /* ─── Shadcn-style tokens (preferred for new code) ─── */
        background:  hsl("--background"),
        foreground:  hsl("--foreground"),
        card: {
          DEFAULT:    hsl("--card"),
          foreground: hsl("--card-foreground"),
        },
        popover: {
          DEFAULT:    hsl("--popover"),
          foreground: hsl("--popover-foreground"),
        },
        primary: {
          DEFAULT:    hsl("--primary"),
          foreground: hsl("--primary-foreground"),
        },
        secondary: {
          DEFAULT:    hsl("--secondary"),
          foreground: hsl("--secondary-foreground"),
        },
        muted: {
          DEFAULT:    hsl("--muted"),
          foreground: hsl("--muted-foreground"),
        },
        accent: {
          DEFAULT:    hsl("--accent"),
          foreground: hsl("--accent-foreground"),
        },
        destructive: {
          DEFAULT:    hsl("--destructive"),
          foreground: hsl("--destructive-foreground"),
        },
        success: hsl("--success"),
        warning: hsl("--warning"),
        info:    hsl("--info"),

        border:      hsl("--border"),
        "border-hover": hsl("--border-hover"),
        input:       hsl("--input"),
        ring:        hsl("--ring"),

        /* TokenShelf indigo palette (50–950) */
        tokenshelf: {
          50:  hsl("--tokenshelf-50"),
          100: hsl("--tokenshelf-100"),
          200: hsl("--tokenshelf-200"),
          300: hsl("--tokenshelf-300"),
          400: hsl("--tokenshelf-400"),
          500: hsl("--tokenshelf-500"),
          600: hsl("--tokenshelf-600"),
          700: hsl("--tokenshelf-700"),
          800: hsl("--tokenshelf-800"),
          900: hsl("--tokenshelf-900"),
          950: hsl("--tokenshelf-950"),
        },

        /* Amber accent palette (for tokens/receipts) */
        amber: {
          50:  hsl("--amber-50"),
          100: hsl("--amber-100"),
          200: hsl("--amber-200"),
          300: hsl("--amber-300"),
          400: hsl("--amber-400"),
          500: hsl("--amber-500"),
          600: hsl("--amber-600"),
          700: hsl("--amber-700"),
          800: hsl("--amber-800"),
          900: hsl("--amber-900"),
          950: hsl("--amber-950"),
        },

        /* Trust tiers */
        trust: {
          verified: hsl("--trust-verified"),
          proxied:  hsl("--trust-proxied"),
          self:     hsl("--trust-self"),
        },

        /* Chart palette */
        chart: {
          1: hsl("--chart-1"),
          2: hsl("--chart-2"),
          3: hsl("--chart-3"),
          4: hsl("--chart-4"),
          5: hsl("--chart-5"),
        },

        /* ─── Legacy aliases — repointed to the new brand colours.
              Existing components (text-brand, bg-token, etc.) automatically
              pick up the new Indigo + Amber palette without code changes. ─── */
        bg:        hslRaw("--background"),
        surface:   hslRaw("--card"),
        surface2:  hslRaw("--secondary"),
        text:      hslRaw("--foreground"),
        brand:     hslRaw("--primary"),         /* was hunter green → now indigo */
        brandDim:  hslRaw("--tokenshelf-700"),  /* darker indigo for dim variants */
        token:     hslRaw("--accent"),          /* was orange → now amber */
      },

      borderRadius: {
        lg: "var(--radius-lg)",
        md: "var(--radius)",
        sm: "var(--radius-sm)",
      },

      fontFamily: {
        sans: ["var(--font-sans)", "Inter", "ui-sans-serif", "system-ui",
               "-apple-system", "Segoe UI", "Helvetica", "Arial", "sans-serif"],
        serif: ["var(--font-serif)", "Source Serif 4", "Source Serif Pro",
                "Charter", "Iowan Old Style", "Georgia", "serif"],
        mono:  ["var(--font-mono)", "JetBrains Mono", "ui-monospace",
                "SFMono-Regular", "Menlo", "monospace"],
      },

      fontSize: {
        "data-xs": ["0.6875rem", { lineHeight: "1rem",      letterSpacing: "0.02em" }],
        "data-sm": ["0.8125rem", { lineHeight: "1.25rem",   letterSpacing: "0.01em" }],
      },

      keyframes: {
        float:            { "0%,100%": { transform: "translateY(0)" }, "50%": { transform: "translateY(-6px)" } },
        "pulse-ring":     { "0%": { transform: "scale(1)", opacity: "0.7" }, "100%": { transform: "scale(1.6)", opacity: "0" } },
        "gradient-shift": { "0%,100%": { backgroundPosition: "0% 50%" }, "50%": { backgroundPosition: "100% 50%" } },
        "slide-up":       { "0%": { transform: "translateY(8px)", opacity: "0" }, "100%": { transform: "translateY(0)", opacity: "1" } },
        "scale-in":       { "0%": { transform: "scale(0.97)", opacity: "0" }, "100%": { transform: "scale(1)", opacity: "1" } },
      },

      animation: {
        float:        "float 5s ease-in-out infinite",
        "pulse-ring": "pulse-ring 2s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        gradient:     "gradient-shift 6s ease infinite",
        "slide-up":   "slide-up 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards",
        "scale-in":   "scale-in 0.35s cubic-bezier(0.16, 1, 0.3, 1) forwards",
      },

      boxShadow: {
        "tokenshelf":    "0 20px 40px -12px hsl(var(--primary) / 0.30)",
        "tokenshelf-lg": "0 25px 50px -12px hsl(var(--primary) / 0.40)",
      },
    },
  },
  plugins: [],
} satisfies Config;
