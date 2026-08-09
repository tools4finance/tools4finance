import type { Metadata } from "next";
import { Inter, DM_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  weight: ["300", "400", "500"],
  variable: "--font-inter",
  display: "swap",
});

const dmMono = DM_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-dm-mono",
  display: "swap",
});

const title = "tools4finance — Finans Ekipleri İçin Profesyonel Araçlar";
const description =
  "tools4finance: IFRS raporlama, mutabakat, site/bina bütçe yönetimi ve finansal analiz araçları tek platformda.";

export const metadata: Metadata = {
  metadataBase: new URL("https://tools4finance.com"),
  title,
  description,
  openGraph: {
    title,
    description,
    type: "website",
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="tr" data-theme="light" suppressHydrationWarning>
      <body className={`${inter.variable} ${dmMono.variable}`}>{children}</body>
    </html>
  );
}
