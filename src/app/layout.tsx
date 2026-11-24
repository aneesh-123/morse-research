import type { Metadata, Viewport } from 'next';
import '@fontsource-variable/nunito';
import './globals.css';

export const metadata: Metadata = {
  title: 'Morse Learning Study',
  description: 'A research study on how people learn to recognise Morse code by ear.',
  robots: { index: true, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f5f2ff' },
    { media: '(prefers-color-scheme: dark)', color: '#110d29' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
