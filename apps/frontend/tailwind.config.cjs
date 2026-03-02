/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: {
          900: "#040a14",
          800: "#071325",
          700: "#0a1b33",
          600: "#0e2440"
        },
        accent: {
          cyan: "#3de0ff",
          amber: "#f5b14a",
          green: "#5af58c",
          red: "#ff4863"
        }
      },
      boxShadow: {
        panel: "0 0 0 1px rgba(61,224,255,0.24), 0 14px 32px rgba(0,0,0,0.45)",
        glow: "0 0 18px rgba(61,224,255,0.28)",
        "glow-amber": "0 0 18px rgba(245,177,74,0.28)",
        "glow-green": "0 0 18px rgba(90,245,140,0.28)",
        "glow-red": "0 0 18px rgba(255,72,99,0.28)"
      },
      animation: {
        "pulse-slow": "pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        "scan": "scan 3s linear infinite"
      },
      keyframes: {
        scan: {
          "0%": { opacity: "0.3" },
          "50%": { opacity: "0.7" },
          "100%": { opacity: "0.3" }
        }
      }
    }
  },
  plugins: []
};
