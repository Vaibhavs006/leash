import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

const description = "Let an AI agent buy for your business on PayPal, inside limits it cannot break.";

export const metadata: Metadata = {
  title: "Leash: spending controls for AI purchasing agents",
  description,
  openGraph: { title: "Leash: spending controls for AI purchasing agents", description, type: "website" },
  twitter: { card: "summary", title: "Leash", description },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
