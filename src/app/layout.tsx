import type { Metadata } from "next";
import "@fontsource-variable/assistant";
import "./globals.css";
export const metadata: Metadata = {
  title: "MyShift | ניהול סידורי עבודה",
  description: "סביבת עבודה מרכזית לניהול צוותים ומשמרות",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="he" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
