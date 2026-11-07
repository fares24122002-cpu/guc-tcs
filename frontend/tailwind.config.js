/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: { 950: "#05070d", 900: "#0a0f1c", 800: "#101830", 700: "#18223f" },
        gold: { 300: "#ecd38f", 400: "#e0bb62", 500: "#c9a13f", 600: "#a98128" },
      },
      fontFamily: {
        display: ['"Playfair Display"', "Georgia", "serif"],
        sans: ['"DM Sans"', "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};
