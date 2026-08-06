/** @type {import('tailwindcss').Config} */
module.exports = {
  // NativeWind is opt-in per new component going forward — existing
  // StyleSheet-based components are deliberately NOT migrated (see
  // feedback_stylesheet_vs_nativewind memory). Content globs only need to
  // cover files that actually use className, but scanning broadly is cheap
  // and avoids missing a new file.
  content: ["./app/**/*.{js,jsx,ts,tsx}", "./src/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {},
  },
  plugins: [],
};
