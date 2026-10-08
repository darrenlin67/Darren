import "./globals.css";
import BasketballMotion from "./BasketballMotion";
import BackgroundMusic from "./BackgroundMusic";

export const metadata = {
  title: "Whats up, Im darren",
  description: "Meet Darren: basketball and karate fan, always working on the next challenge.",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#10110e",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Space+Grotesk:wght@400;500;600;700&display=swap" rel="stylesheet" />
      </head>
      <body>{children}<BasketballMotion /><BackgroundMusic /></body>
    </html>
  );
}
