/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        'usr-pink': '#EC3642',
        'usr-pink-dark': '#c92d37',
        'usr-pink-light': '#f26068',
      },
      fontFamily: {
        sans: ['Lato', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
