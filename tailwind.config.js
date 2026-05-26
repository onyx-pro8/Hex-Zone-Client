import forms from '@tailwindcss/forms';

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      boxShadow: {
        glow: '0 0 40px rgba(0, 229, 209, 0.12), 0 25px 50px -12px rgba(0, 0, 0, 0.45)',
      },
    },
  },
  plugins: [forms],
};
