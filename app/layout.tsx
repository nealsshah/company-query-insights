import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Search Query Insights',
  description: 'Discover what your customers are searching for',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

