import "./globals.css";

export const metadata = {
  title: "Darren — Hoops & Games",
  description: "Meet Darren: basketball fan, gamer, and always up for the next challenge.",
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
      <body>{children}</body>
    </html>
  );
}
