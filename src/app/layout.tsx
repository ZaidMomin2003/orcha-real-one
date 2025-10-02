import type { Metadata } from "next";
// FIX: Added import for React to make React types like React.ReactNode available.
import React from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI Interview Practice",
  description: "Practice interviews with a realistic AI interviewer.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Google+Sans:wght@400;500;700&display=swap" rel="stylesheet" />
      </head>
      <body>{children}</body>
    </html>
  );
}
