import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";
import { NavBar } from "@/components/NavBar";

const geist = Geist({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "InferVoice — Mac Fleet Control",
  description: "Control and inspect Macs on your LAN: specs, storage, remote shells.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className={`${geist.className} min-h-screen bg-zinc-950 text-zinc-100 antialiased selection:bg-violet-500/30`}>
        <div className="pointer-events-none fixed inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,rgba(124,58,237,0.08),transparent_60%)]" />
        <NavBar />
        {children}
      </body>
    </html>
  );
}
