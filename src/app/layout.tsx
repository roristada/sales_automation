import type { Metadata } from "next";
import { Noto_Sans_Thai } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

// System sans for Latin; Noto Sans Thai fills Thai glyphs (design.md §4).
const notoThai = Noto_Sans_Thai({ variable: "--font-thai", subsets: ["thai"], weight: ["400", "500", "600"] });

export const metadata: Metadata = {
  title: { default: "Sales Automation", template: "%s · Sales Automation" },
  description: "จัดการสินค้า affiliate สร้างเนื้อหาและวิดีโอจากข้อมูลที่ตรวจสอบได้",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="th" suppressHydrationWarning className={notoThai.variable}>
      <body className="text-sm antialiased">
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false} disableTransitionOnChange>
          <TooltipProvider delayDuration={300}>{children}</TooltipProvider>
          <Toaster position="bottom-right" />
        </ThemeProvider>
      </body>
    </html>
  );
}
