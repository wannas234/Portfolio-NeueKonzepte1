import type { Metadata } from "next";
import { Geist, Geist_Mono, Inter } from "next/font/google";
import AppFrame from "@/components/AppFrame";
import { themeInitScript } from "@/lib/theme";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Used only by the authenticated dashboard shell (see dashboardFrame.module.css),
// per the delivered design system's typography spec. Auth/landing keep Geist.
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "UniVerse",
  description: "Intelligenter Lern- und Vorlesungsassistent",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="de"
      className={`${geistSans.variable} ${geistMono.variable} ${inter.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="flex min-h-full flex-col">
        <AppFrame>{children}</AppFrame>
      </body>
    </html>
  );
}
