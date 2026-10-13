import type { Metadata } from 'next';
import './styles.css';

export const metadata: Metadata = {
  title: 'СтройПоток — снабжение стройки по плану',
  description: 'Подбор строительных материалов, сравнение предложений и планирование поставок на объект.',
  icons: { icon: '/images/brand/stroypotok-mark.png', apple: '/images/brand/stroypotok-mark.png' },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ru"><body>{children}</body></html>;
}
