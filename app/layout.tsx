import type { Metadata, Viewport } from 'next';
import './globals.css'; // Global styles
import { Amiri, Tajawal, Geist } from 'next/font/google';
import ToastContainer from '@/components/Toast';
import { cn } from "@/lib/utils";

const geist = Geist({subsets:['latin'],variable:'--font-sans'});

const amiri = Amiri({ 
  subsets: ['arabic'], 
  weight: ['400', '700'],
  variable: '--font-amiri',
  display: 'swap'
});

const tajawal = Tajawal({ 
  subsets: ['arabic'], 
  weight: ['400', '700', '800'],
  variable: '--font-tajawal',
  display: 'swap'
});

export const metadata: Metadata = {
  title: 'معين الأستاذ',
  description: 'دفتر العمل الرقمي الشامل لأساتذة التعليم الثانوي العام والتكنولوجي بالجزائر لجميع المواد الـ 18 وفق القرار 186/2006: إدارة الأفواج، الحضور والغياب، التقويم والعلامات، المجالس، الدفتر اليومي، جدول التوقيت، والتوزيع السنوي.',
  openGraph: {
    title: 'معين الأستاذ',
    description: 'دفتر العمل الرقمي الشامل لأساتذة التعليم الثانوي العام والتكنولوجي بالجزائر لجميع المواد الـ 18 وفق القرار 186/2006: إدارة الأفواج، الحضور والغياب، التقويم والعلامات، المجالس، الدفتر اليومي، جدول التوقيت، والتوزيع السنوي.',
  },
  icons: {
    icon: '/favicon.ico',
    shortcut: '/favicon.ico',
    apple: '/apple-touch-icon.png',
  }
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({children}: {children: React.ReactNode}) {
  return (
    <html lang="ar" dir="rtl" suppressHydrationWarning className={cn("font-sans", geist.variable)}>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
      </head>
      <body className={`${amiri.variable} ${tajawal.variable}`} suppressHydrationWarning>
        <ToastContainer />
        {children}
      </body>
    </html>
  );
}
