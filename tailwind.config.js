/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', "ui-sans-serif", "system-ui", "sans-serif"],
      },
      colors: {
        canvas: "rgb(var(--canvas-rgb) / <alpha-value>)",
        surface: "var(--surface)",
        "surface-2": "var(--surface-2)",
        ink: "var(--ink)",
        muted: "var(--muted)",
        line: "var(--line)",
        accent: "rgb(var(--accent-rgb) / <alpha-value>)",
        "accent-ink": "var(--accent-ink)",
        income: "var(--income)",
        "income-soft": "var(--income-soft)",
        expense: "rgb(var(--expense-rgb) / <alpha-value>)",
        "expense-soft": "var(--expense-soft)",
        warning: "var(--warning)",
        "warning-soft": "var(--warning-soft)",
        sidebar: "var(--sidebar)",
        "sidebar-ink": "var(--sidebar-ink)",
        "sidebar-muted": "var(--sidebar-muted)",
        "sidebar-active": "var(--sidebar-active)",
      },
    },
  },
  plugins: [],
};
