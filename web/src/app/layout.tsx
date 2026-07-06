import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { NetworkProvider } from "@/contexts/NetworkContext";
import { WalletProvider } from "@/components/WalletProvider";
import { Toaster } from "sonner";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "TimeVault — Crypto Inheritance & Deadman Switch",
  description: "Secure automated inheritance for your digital assets on Solana. Set up deadman switches to protect your crypto legacy.",
};

// Set the theme before first paint to avoid any flash of the wrong theme.
const themeInitScript = `(function(){try{var t=localStorage.getItem('theme');var d=t?t==='dark':window.matchMedia('(prefers-color-scheme: dark)').matches;document.documentElement.classList.toggle('dark',d);document.documentElement.style.colorScheme=d?'dark':'light';}catch(e){}})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <NetworkProvider>
          <WalletProvider>
            {children}
            <Toaster
              position="top-right"
              richColors
              theme="system"
              toastOptions={{
                style: {
                  fontFamily: "var(--font-geist-sans), system-ui, sans-serif",
                  borderRadius: "0.75rem",
                },
              }}
            />
          </WalletProvider>
        </NetworkProvider>
      </body>
    </html>
  );
}
