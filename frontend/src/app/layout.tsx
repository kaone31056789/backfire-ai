import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";

import { TileCache } from "@/components/tile-cache";

import "./globals.css";

const geist = Geist({ subsets: ["latin"], variable: "--font-geist" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" });
const serif = Instrument_Serif({ subsets: ["latin"], weight: "400", style: ["normal", "italic"], variable: "--font-instrument" });

export const metadata: Metadata = {
  title: { default: "BACKFIRE AI", template: "%s · BACKFIRE AI" },
  description: "Adversarial Climate Intervention Falsification Laboratory",
};

export const viewport: Viewport = { themeColor: "#0b0d11", colorScheme: "dark" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geist.variable} ${geistMono.variable} ${serif.variable}`}>
      <head>
        <link rel="preconnect" href="https://tiles.maps.eox.at" crossOrigin="" />
        <link rel="preconnect" href="https://tiles.openfreemap.org" crossOrigin="" />
        <link rel="preconnect" href="https://s3.amazonaws.com" crossOrigin="" />
      </head>
      <body className="grain min-h-screen">
        <TileCache />
        {children}
      </body>
    </html>
  );
}
