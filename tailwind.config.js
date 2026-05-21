/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      boxShadow: {
        glow: "0 0 40px rgba(32, 201, 151, 0.14), 0 25px 50px -12px rgba(0, 0, 0, 0.45)",
      },
    },
  },
  plugins: [require("@tailwindcss/forms")],
};
