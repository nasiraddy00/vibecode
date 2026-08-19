import type { Metadata, Viewport } from 'next';
import './globals.css';
import { CommandBar } from '@/components/CommandBar';
import { StatusStrip } from '@/components/StatusStrip';

export const metadata: Metadata = {
  title: 'Meridian Terminal',
  description:
    'Institutional-grade trading signal terminal: multi-factor technical, fundamental, flow and volatility analysis with explicit data provenance.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#05070a',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* Loaded at runtime in the viewer's browser; the stacks in globals.css
            degrade cleanly to system fonts if these are unavailable. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600;700&family=Inter:wght@400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="crt">
        <div className="flex flex-col h-screen overflow-hidden">
          <CommandBar />
          <main className="flex-1 overflow-y-auto overflow-x-hidden bg-void">
            {children}
          </main>
          <StatusStrip />
        </div>
      </body>
    </html>
  );
}
