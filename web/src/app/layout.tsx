import type { Metadata } from 'next';
import './styles.css';

export const metadata: Metadata = {
  title: 'ОбъектМаркет — материалы для строительства',
  description: 'Подбор строительных материалов, сравнение предложений и планирование поставок на объект.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ru"><body>{children}</body></html>;
}
