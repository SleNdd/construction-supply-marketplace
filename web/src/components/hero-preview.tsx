import Link from 'next/link';
import { ArrowRight, ClipboardList } from 'lucide-react';

export function HeroPreview() {
  return <div className="hero-preview">
    <div className="hero-preview-panel">
      <div className="hero-preview-top"><span>ПЛАН ЗАКУПКИ</span><span className="hero-preview-demo">Демопример</span></div>
      <div className="hero-preview-project"><span>ОБЪЕКТ / 01</span><h2>Ремонт жилого дома</h2><p>Астрахань, ул. Савушкина, 6</p></div>
      <div className="hero-preview-item"><span className="hero-preview-icon"><ClipboardList size={20}/></span><div><small>Материал в ведомости</small><b>Цемент М500 50 кг</b></div><strong>12 <small>мешков</small></strong></div>
      <div className="hero-preview-flow" aria-label="Этапы закупки"><span><i>01</i> Потребность</span><span><i>02</i> Предложение</span><span><i>03</i> Поставка</span></div>
      <div className="hero-preview-bottom"><p>Подберите предложение и проверьте стоимость доставки.</p><Link href="/projects">Открыть объекты <ArrowRight size={16}/></Link></div>
    </div>
    <span className="hero-preview-caption">От ведомости материалов — к заявке поставщику</span>
  </div>;
}
