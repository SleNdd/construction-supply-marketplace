import Link from 'next/link';
import { ArrowRight, Check, ClipboardList, Layers3, Paintbrush, Package } from 'lucide-react';

export function HeroPreview() {
  return <aside className="hero-preview" aria-label="Пример ведомости материалов">
    <div className="hero-preview-top"><span><ClipboardList size={16}/> ВЕДОМОСТЬ ОБЪЕКТА</span><span className="hero-preview-demo">Пример расчёта</span></div>
    <div className="hero-preview-project"><span>ЭТАП / ОТДЕЛКА</span><h2>Всё для одного этапа</h2><p>Площадь пола 24 м² · стены 65 м²</p></div>
    <div className="hero-preview-items">
      <div className="hero-preview-item"><span className="hero-preview-icon"><Layers3 size={20}/></span><div><b>Напольная плитка</b><small>60 × 60 см · 4 шт. в упаковке</small></div><strong>19 <small>упак.</small></strong></div>
      <div className="hero-preview-item"><span className="hero-preview-icon"><Package size={20}/></span><div><b>Плиточный клей</b><small>Слой 5 мм · мешок 25 кг</small></div><strong>8 <small>мешков</small></strong></div>
      <div className="hero-preview-item"><span className="hero-preview-icon"><Paintbrush size={20}/></span><div><b>Интерьерная краска</b><small>Два слоя · ведро 10 л</small></div><strong>3 <small>ведра</small></strong></div>
    </div>
    <p className="hero-preview-assumption"><Check size={15}/> Запас 10%, округление до целых упаковок</p>
    <div className="hero-preview-bottom"><p>Нормы расхода можно изменить в калькуляторе объекта.</p><Link href="/projects">Открыть объекты <ArrowRight size={16}/></Link></div>
  </aside>;
}
