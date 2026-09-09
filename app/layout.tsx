'use client';

import './globals.css';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import SearchBar from './components/SearchBar';
import { Analytics } from '@vercel/analytics/next';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 200);
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <html lang="en">
      <head>
        {/* Default title + description; individual server-component pages can override via the Next.js metadata API */}
        <title>NACS | North American CS2 Esports</title>
        <meta
          name="description"
          content="Live tournament tracking, brackets, standings, and rankings for North American Counter-Strike 2. ESEA, Fragadelphia, CCT, BLAST, and more."
        />
        <meta name="google-site-verification" content="0Vz1yT93wVWmdJ2lHZKbNpbAOEs4DhIIjySdd9aKA7c" />
      </head>
      <body>
        {/* Navigation Bar - always opaque, logo grows after scrolling past banner */}
        <nav className="fixed top-0 left-0 right-0 z-50 bg-surface/95 backdrop-blur-md shadow-lg shadow-black/20">
          <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
            <Link href="/" className="flex items-center gap-3 group">
              <Image
                src="/icon.png"
                alt="NACS"
                width={48}
                height={48}
                className={`rounded-full transition-all duration-300 group-hover:scale-110 ${
                  scrolled ? 'w-11 h-11' : 'w-8 h-8'
                }`}
              />
              <span
                className={`font-bold tracking-wide text-white drop-shadow-md transition-all duration-300 ${
                  scrolled ? 'text-xl' : 'text-lg'
                }`}
              >
                NACS
              </span>
            </Link>

            <div className="flex items-center gap-6">
              <Link
                href="/"
                className="text-sm font-medium text-white/80 hover:text-white transition-colors duration-200 drop-shadow-sm"
              >
                Events
              </Link>
              <Link
                href="/matches"
                className="text-sm font-medium text-white/80 hover:text-white transition-colors duration-200 drop-shadow-sm"
              >
                Matches
              </Link>
              <Link
                href="/rankings"
                className="text-sm font-medium text-white/80 hover:text-white transition-colors duration-200 drop-shadow-sm"
              >
                Rankings
              </Link>
              <Link
                href="/roadmap"
                className="text-sm font-medium text-white/80 hover:text-white transition-colors duration-200 drop-shadow-sm"
              >
                Roadmap
              </Link>
              <SearchBar />
            </div>
          </div>
        </nav>

        {/* Spacer so the banner begins below the fixed nav, not under it */}
        <div className="h-14" />

        {/* Banner - cropped at the bottom so main content sits higher */}
        <div
          className="relative w-full overflow-hidden"
          style={{ aspectRatio: '3000 / 520' }}
        >
          <Image
            src="/bannerfix.png"
            alt="NACS Banner"
            width={3000}
            height={664}
            className="w-full h-auto"
            priority
          />
          <div className="absolute inset-0 bg-gradient-to-b from-black/20 via-transparent to-bg" />
        </div>

        {/* Main Content */}
        <main className="relative -mt-6 z-10">
          {children}
        </main>

        {/* Footer */}
        <footer className="mt-20 pb-8 text-center text-xs text-text-muted">
          Powered by North American Counter Strike
        </footer>
        <Analytics />
      </body>
    </html>
  );
}
