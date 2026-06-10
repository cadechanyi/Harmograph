import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Harmograph",
  description:
    "Render the musical components of a song as live, interactive mathematical graphs.",
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
