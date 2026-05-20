import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "hsl(222 14% 7%)",
        surface: "hsl(222 14% 10%)",
        surface2: "hsl(222 14% 13%)",
        border: "hsl(222 14% 18%)",
        text: "hsl(210 20% 96%)",
        muted: "hsl(217 10% 64%)",
        brand: "hsl(142 71% 50%)",
        brandDim: "hsl(142 50% 30%)",
        token: "hsl(36 100% 60%)",
      },
      fontFamily: {
        sans: ["ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Roboto", "Helvetica", "Arial", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
    },
  },
  plugins: [],
} satisfies Config;
