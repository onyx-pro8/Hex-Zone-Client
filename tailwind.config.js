import forms from '@tailwindcss/forms';

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Safe Zone Patrol light palette (mirrors the mobile colors.ts).
        szp: {
          bg: '#F3F7FD',
          card: '#FFFFFF',
          surface: '#F7FAFE',
          inset: '#EDF3FB',
          accent: '#2F80ED',
          accentDeep: '#1B5BB5',
          text: '#0F2C5C',
          muted: '#566784',
          dim: '#8694AC',
          border: '#DCE6F2',
          borderStrong: '#C2D2E6',
          success: '#2FA24A',
          danger: '#E23B4E',
          warning: '#E0992A',
        },
      },
      boxShadow: {
        glow: '0 10px 30px -12px rgba(27, 58, 107, 0.18), 0 4px 12px -6px rgba(27, 58, 107, 0.12)',
      },
    },
  },
  plugins: [forms],
};
