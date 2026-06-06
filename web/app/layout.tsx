import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "Letterboxd to Radarr",
  description: "Send highly rated Letterboxd reviews to a Radarr instance.",
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
