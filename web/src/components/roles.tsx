'use client';

import Link from 'next/link';
import { ArrowRight, Building2, Package, Truck } from 'lucide-react';
import { type User } from '@/lib/api';
import { AuthRequired, PageHeading } from './marketplace';
import { DriverDashboard } from './driver-dashboard';
import { DispatcherDashboard } from './dispatcher-dashboard';
import { SupplierDashboard } from './supplier-dashboard';
import { AdminDashboard } from './admin-dashboard';

export function RoleWorkspace({user,onAuth}:{user:User|null;onAuth:()=>void}) {
  return <div className="container page-section"><PageHeading eyebrow="ЛИЧНЫЙ КАБИНЕТ" title={user?`Здравствуйте, ${user.name.split(' ')[0]}`:'Рабочий кабинет'} description={user?`Роль: ${({buyer:'покупатель',supplier:'поставщик',dispatcher:'диспетчер',driver:'водитель',admin:'администратор'} as Record<string,string>)[user.role]}. Здесь собраны ваши основные действия.`:'Войдите, чтобы увидеть рабочие инструменты.'}/>{!user?<AuthRequired onAuth={onAuth}/>:user.role==='buyer'?<BuyerDashboard/>:user.role==='supplier'?<SupplierDashboard/>:user.role==='dispatcher'?<DispatcherDashboard/>:user.role==='driver'?<DriverDashboard/>:<AdminDashboard/>}</div>;
}

function BuyerDashboard(){return <div className="dashboard-grid"><Link href="/catalog" className="dashboard-card"><span>01 / МАТЕРИАЛЫ</span><Package size={29}/><h2>Каталог</h2><p>Найдите товары, сравните поставщиков и условия доставки.</p><strong>Открыть каталог <ArrowRight size={17}/></strong></Link><Link href="/projects" className="dashboard-card"><span>02 / ОБЪЕКТЫ</span><Building2 size={29}/><h2>Мои объекты</h2><p>Планируйте потребность и рассчитывайте количество материалов.</p><strong>Открыть объекты <ArrowRight size={17}/></strong></Link><Link href="/orders" className="dashboard-card"><span>03 / ПОСТАВКИ</span><Truck size={29}/><h2>Заказы</h2><p>Проверяйте состав заказов и статусы поставок.</p><strong>Мои заказы <ArrowRight size={17}/></strong></Link></div>}
