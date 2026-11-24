import type { Metadata } from 'next';
import { Inter, Jura } from 'next/font/google';
import './globals.css';

// Self-hosted, subsetted UI fonts (no render-blocking Google CSS request, no
// third-party font fetches). Certificate-content fonts load dynamically via
// src/lib/font-loader.ts and are unaffected.
const inter = Inter({ subsets: ['latin'], display: 'swap', variable: '--gf-inter' });
const jura = Jura({ subsets: ['latin'], display: 'swap', variable: '--gf-jura' });

export const metadata: Metadata = {
  title: 'Certify | Professional Certificate Manager',
  description: 'Design, bulk generate, export, and email custom certificates seamlessly.',
  icons: {
    icon: [
      { url: '/favicon.ico' },
      { url: '/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
      { url: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
    ],
    apple: [
      { url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
    ],
  },
  manifest: '/site.webmanifest',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} ${jura.variable}`}>
      <head>
        <link rel="icon" href="/favicon.ico" sizes="any" />
        <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png" />
        <link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png" />
        <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
        <link rel="manifest" href="/site.webmanifest" />
      </head>
      <body className="antialiased bg-[#FBFAF5] text-slate-900 min-h-screen font-sans" style={{ backgroundColor: '#FBFAF5' }}>
        {children}
      </body>
    </html>
  );
}
