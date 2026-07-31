import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'BEXT Consultancy — Platform Management',
  description: 'Connection health, timeline and plan for the BEXT automation platform.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en-AU">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
