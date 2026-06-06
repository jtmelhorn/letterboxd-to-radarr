import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "letterboxdarr",
  description: "Sync highly rated Letterboxd reviews into Radarr with letterboxdarr.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
