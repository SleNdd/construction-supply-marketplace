'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowDownRight, ArrowRight, ArrowUpRight, Building2, Check, ChevronDown, Clock3, ClipboardList, Layers3, LayoutDashboard, MapPin, Menu, Moon, Package, Search, ShieldCheck, ShoppingBag, SlidersHorizontal, Sun, Truck, UserRound, X } from 'lucide-react';
import { api, type CartItem, type Category, type Product, type User, money } from '@/lib/api';
import { readCart, readCompare, saveCart, saveCompare } from '@/lib/storage';
import { useDialogFocus } from '@/lib/use-dialog-focus';
import { Catalog, ProductDetails, Compare } from './shopping';
import { Cart, Checkout, Orders } from './orders';
import { Projects, ProjectDetails } from './projects';
import { RoleWorkspace } from './roles';
import { MaterialArt } from './material-art';
import { HeroPreview } from './hero-preview';

const roleNames: Record<User['role'], string> = { buyer: 'Покупатель', supplier: 'Поставщик', dispatcher: 'Диспетчер', driver: 'Водитель', admin: 'Администратор' };

export function Marketplace() {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [compare, setCompare] = useState<string[]>([]);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [menu, setMenu] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [notice, setNotice] = useState('');
  const [categories, setCategories] = useState<Category[]>([]);
  const [featured, setFeatured] = useState<Product[]>([]);
  const [loadingHome, setLoadingHome] = useState(true);

  const refreshUser = useCallback(() => { api<{ user: User }>('/auth/me').then(data => setUser(data.user)).catch(() => setUser(null)); }, []);
  useEffect(() => {
    setCart(readCart()); setCompare(readCompare());
    const savedTheme = localStorage.getItem('objectmarket-theme');
    if (savedTheme === 'dark') setTheme('dark');
    refreshUser();
    api<Category[]>('/categories').then(setCategories).catch(() => setCategories([]));
    api<{ items: Product[] }>('/products?limit=4').then(data => setFeatured(data.items)).catch(() => setFeatured([])).finally(() => setLoadingHome(false));
    const sync = () => { setCart(readCart()); setCompare(readCompare()); };
    window.addEventListener('cart-change', sync); window.addEventListener('compare-change', sync);
    return () => { window.removeEventListener('cart-change', sync); window.removeEventListener('compare-change', sync); };
  }, [refreshUser]);
  useEffect(() => { document.documentElement.dataset.theme = theme; localStorage.setItem('objectmarket-theme', theme); }, [theme]);
  useEffect(() => { setMenu(false); window.scrollTo(0, 0); }, [pathname]);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(''), 5000); return () => clearTimeout(timer); }, [notice]);

  const addToCart = useCallback((item: CartItem) => {
    const current = readCart(); const found = current.find(entry => entry.offerId === item.offerId);
    if (found) found.quantity += item.quantity; else current.push(item);
    saveCart(current); setNotice('Товар добавлен в корзину');
  }, []);
  const toggleCompare = useCallback((id: string) => {
    const current = readCompare();
    if (current.includes(id)) saveCompare(current.filter(value => value !== id));
    else if (current.length < 4) saveCompare([...current, id]);
    else setNotice('Можно сравнить до четырёх товаров');
  }, []);
  const logout = async () => { try { await api('/auth/logout', { method: 'POST' }); } catch { /* Session may have expired. */ } setUser(null); router.push('/'); };
  const onAuth = (nextUser: User) => { setUser(nextUser); setAuthOpen(false); setNotice(`Здравствуйте, ${nextUser.name}!`); };
  const openAuth = () => { setAuthMode('login'); setAuthOpen(true); };
  const homeSearch = (event: React.FormEvent<HTMLFormElement>) => { event.preventDefault(); const value = new FormData(event.currentTarget).get('q')?.toString().trim(); router.push(`/catalog${value ? `?q=${encodeURIComponent(value)}` : ''}`); };
  const totalQuantity = useMemo(() => cart.reduce((sum, item) => sum + item.quantity, 0), [cart]);
  const segments = pathname.split('/').filter(Boolean);
  const current = segments[0] || 'home';

  return <>
    <a className="skip-link" href="#main-content">Перейти к содержимому</a>
    <div className="announcement"><span className="announcement-dot" /> Учебная демонстрация: поставщики и заказы вымышлены, оплата без списания средств</div>
    <header className="site-header">
      <div className="container header-inner">
        <Link href="/" className="brand" aria-label="ОбъектМаркет — главная"><span className="brand-symbol"><Building2 size={22} strokeWidth={2.3} /></span><span>ОБЪЕКТ<span className="brand-accent">МАРКЕТ</span><small>материалы для результата</small></span></Link>
        <nav id="main-navigation" className={menu ? 'main-nav open' : 'main-nav'} aria-label="Основная навигация">
          <Link className={current === 'catalog' ? 'active' : ''} href="/catalog">Каталог</Link>
          <Link className={current === 'projects' ? 'active' : ''} href="/projects">Мои объекты</Link>
          <Link className={current === 'compare' ? 'active' : ''} href="/compare">Сравнение{compare.length > 0 && <span className="nav-count">{compare.length}</span>}</Link>
          {user && <Link className={current === 'workspace' ? 'active' : ''} href="/workspace">Рабочий кабинет</Link>}
          <button className="mobile-theme-option" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>{theme === 'light' ? <Moon size={18}/> : <Sun size={18}/>} {theme === 'light' ? 'Тёмная тема' : 'Светлая тема'}</button>
        </nav>
        <div className="header-actions">
          <button className="icon-button theme-button" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')} title={theme === 'light' ? 'Тёмная тема' : 'Светлая тема'} aria-label="Переключить тему">{theme === 'light' ? <Moon size={19} /> : <Sun size={19} />}</button>
          <Link className="icon-button bag-button" href="/cart" title="Корзина" aria-label={`Корзина, товаров: ${totalQuantity}`}><ShoppingBag size={20} />{totalQuantity > 0 && <span className="bag-badge">{totalQuantity}</span>}</Link>
          {user ? <div className="user-menu"><Link href="/workspace" className="user-link"><UserRound size={17}/><span>{user.name.split(' ')[0]}</span></Link><button className="link-button logout" onClick={logout}>Выйти</button></div> : <button className="btn btn-dark login-button" onClick={openAuth}>Войти <ArrowUpRight size={16}/></button>}
          <button className="icon-button mobile-menu" onClick={() => setMenu(!menu)} aria-label={menu ? 'Закрыть меню' : 'Открыть меню'} aria-expanded={menu} aria-controls="main-navigation">{menu ? <X size={22} /> : <Menu size={22} />}</button>
        </div>
      </div>
    </header>

    <main id="main-content" tabIndex={-1}>
      {current === 'home' && <Home categories={categories} featured={featured} loading={loadingHome} onSearch={homeSearch} addToCart={addToCart} toggleCompare={toggleCompare} compare={compare} />}
      {current === 'catalog' && <Catalog categories={categories} addToCart={addToCart} toggleCompare={toggleCompare} compare={compare} />}
      {current === 'product' && segments[1] && <ProductDetails id={segments[1]} addToCart={addToCart} toggleCompare={toggleCompare} compare={compare} />}
      {current === 'compare' && <Compare ids={compare} addToCart={addToCart} toggleCompare={toggleCompare} />}
      {current === 'cart' && <Cart cart={cart} onAuth={openAuth} user={user} />}
      {current === 'checkout' && <Checkout cart={cart} user={user} onAuth={openAuth} onDone={() => saveCart([])} />}
      {current === 'orders' && <Orders user={user} onAuth={openAuth} orderId={segments[1]} />}
      {current === 'projects' && !segments[1] && <Projects user={user} onAuth={openAuth} />}
      {current === 'projects' && segments[1] && <ProjectDetails id={segments[1]} user={user} onAuth={openAuth} addToCart={addToCart} />}
      {current === 'workspace' && <RoleWorkspace user={user} onAuth={openAuth} />}
      {!['home','catalog','product','compare','cart','checkout','orders','projects','workspace'].includes(current) && <div className="container section"><h1>Страница не найдена</h1><Link href="/" className="btn btn-dark">На главную</Link></div>}
    </main>

    <footer className="footer"><div className="container footer-grid"><div><div className="footer-brand">ОБЪЕКТ<span>МАРКЕТ</span></div><p>Материалы, поставщики и график работ — в одной системе.</p><small>Дипломный проект · Астрахань · 2026</small></div><div><b>Покупателям</b><Link href="/catalog">Каталог</Link><Link href="/compare">Сравнение</Link><Link href="/projects">Объекты</Link></div><div><b>Мой кабинет</b><Link href="/orders">Заказы</Link><Link href="/workspace">Рабочий кабинет</Link><Link href="/cart">Корзина</Link></div><div className="footer-note"><ShieldCheck size={22}/><p>Учебная версия. Платежи и движение транспорта моделируются. Данные поставщиков — демонстрационные.</p></div></div></footer>
    {notice && <div className="toast" role="status"><Check size={17}/>{notice}<button onClick={() => setNotice('')} aria-label="Закрыть"><X size={15}/></button></div>}
    {authOpen && <AuthModal mode={authMode} setMode={setAuthMode} onClose={() => setAuthOpen(false)} onSuccess={onAuth} />}
  </>;
}

function Home({ categories, featured, loading, onSearch, addToCart, toggleCompare, compare }: { categories: Category[]; featured: Product[]; loading: boolean; onSearch: (event: React.FormEvent<HTMLFormElement>) => void; addToCart: (item: CartItem) => void; toggleCompare: (id: string) => void; compare: string[] }) {
  const categoryIcons = [Layers3, Package, Building2, SlidersHorizontal];
  return <>
    <section className="hero"><div className="container hero-grid"><div className="hero-copy"><div className="eyebrow"><span className="eyebrow-line"/> ПЛАТФОРМА СТРОИТЕЛЬНЫХ ЗАКУПОК</div><h1>Стройте планы.<br/><em>Материалы</em> найдутся.</h1><p>Сравнивайте предложения, считайте объёмы и планируйте поставки на объект. Всё нужное для стройки — в одном месте.</p><form className="hero-search" onSubmit={onSearch}><Search size={20}/><input name="q" placeholder="Что ищем? Например, цемент М500" aria-label="Поиск материалов"/><button type="submit">Найти <ArrowRight size={17}/></button></form><div className="hero-quick"><span>Быстрый поиск:</span><Link href="/catalog?q=цемент">Цемент</Link><Link href="/catalog?q=плитка">Плитка</Link><Link href="/catalog?q=краска">Краска</Link></div></div><HeroPreview/></div></section>
    <section className="container trust-strip"><div><span className="trust-index">01</span><b>Прозрачная цена</b><small>Товары и доставка — отдельно</small></div><div><span className="trust-index">02</span><b>Проверка наличия</b><small>Актуальные остатки перед заказом</small></div><div><span className="trust-index">03</span><b>План под объект</b><small>Потребность и сроки в одном месте</small></div></section>
    <section className="container section categories-section"><div className="section-heading"><div><span className="overline">НАВИГАЦИЯ ПО МАТЕРИАЛАМ</span><h2>Найдите то, что нужно</h2></div><Link href="/catalog" className="text-link">Весь каталог <ArrowUpRight size={17}/></Link></div><div className="category-grid">{(categories.length ? categories.slice(0,4) : [{id:'1',name:'Строительные смеси',slug:'smesi'},{id:'2',name:'Кирпич и блоки',slug:'kirpich'},{id:'3',name:'Отделочные материалы',slug:'otdelka'},{id:'4',name:'Инженерные системы',slug:'inzhenernye'}]).map((category,index) => { const Icon = categoryIcons[index]; return <Link href={`/catalog?category=${encodeURIComponent(category.slug)}`} key={category.id} className={`category-card category-${index}`}><span className="category-number">0{index + 1} / КАТЕГОРИЯ</span><Icon size={38} strokeWidth={1.25}/><span className="category-card-bottom"><b>{category.name}</b><ArrowUpRight size={21}/></span></Link>; })}</div></section>
    <section className="project-banner"><div className="container project-banner-inner"><div><span className="overline">ДЛЯ ПРОФЕССИОНАЛЬНОЙ ЗАКУПКИ</span><h2>Весь объект.<br/><em>Один план поставок.</em></h2><p>Загрузите перечень материалов, рассчитайте необходимый объём и сравните поставщиков с учётом доставки и сроков.</p><Link href="/projects" className="btn btn-light">Создать объект <ArrowUpRight size={18}/></Link></div><div className="plan-preview"><div className="plan-header"><span><span className="plan-status"/> ПЛАН ЗАКУПКИ</span><span>2026 / 01</span></div><div className="plan-line"><span>Фундамент</span><b>01</b><i/></div><div className="plan-line"><span>Стены и перекрытия</span><b>02</b><i/></div><div className="plan-line"><span>Отделка</span><b>03</b><i/></div><div className="plan-footer"><span>Потребность → предложения → доставка</span><ArrowUpRight size={19}/></div></div></div></section>
    <section className="container section featured-section"><div className="section-heading"><div><span className="overline">КАТАЛОГ / ПОДБОРКА</span><h2>Материалы для вашего проекта</h2></div><Link href="/catalog" className="text-link">Смотреть всё <ArrowUpRight size={17}/></Link></div>{loading ? <div className="loading-row">Загружаем материалы…</div> : featured.length ? <div className="product-grid">{featured.map(product => <CompactProduct key={product.id} product={product} addToCart={addToCart} toggleCompare={toggleCompare} selected={compare.includes(product.id)}/>)}</div> : <div className="empty-state">Каталог пока недоступен. Проверьте подключение к API и загрузку демоданных.</div>}</section>
    <section className="container section steps-section"><div className="section-heading"><div><span className="overline">КАК ЭТО РАБОТАЕТ</span><h2>От потребности до поставки</h2></div></div><div className="steps-grid"><div><span>01 / ПОДБОР</span><Search size={25}/><h3>Найдите материалы</h3><p>Ищите в каталоге или загрузите перечень для конкретного объекта.</p></div><div><span>02 / СРАВНЕНИЕ</span><ClipboardList size={25}/><h3>Сравните условия</h3><p>Смотрите цену, наличие, срок и стоимость доставки от поставщиков.</p></div><div><span>03 / ПОСТАВКА</span><Truck size={25}/><h3>Планируйте заказ</h3><p>Оформите заявку и отслеживайте учебную поставку в кабинете.</p></div></div></section>
  </>;
}

export function CompactProduct({ product, addToCart, toggleCompare, selected }: { product: Product; addToCart: (item: CartItem) => void; toggleCompare: (id: string) => void; selected: boolean }) {
  return <article className="product-card"><Link href={`/product/${product.id}`} className="product-image"><MaterialArt product={product}/><span className="product-image-link"><ArrowUpRight size={18}/></span></Link><div className="product-info"><span className="product-category">{typeof product.category === 'string' ? product.category : product.category.name}</span><Link href={`/product/${product.id}`} className="product-name">{product.name}</Link><span className="product-unit">за {product.unit}</span><div className="product-bottom"><div><small>от</small><b>{money(product.priceFromKopecks)}</b></div><button className="small-icon-button" onClick={() => toggleCompare(product.id)} title={selected ? 'Убрать из сравнения' : 'Сравнить'} aria-label="Сравнить товар">{selected ? <Check size={19}/> : <Layers3 size={19}/>}</button></div><Link href={`/product/${product.id}`} className="product-add">Выбрать предложение <ArrowRight size={16}/></Link></div></article>;
}

function AuthModal({ mode, setMode, onClose, onSuccess }: { mode: 'login' | 'register'; setMode: (mode: 'login' | 'register') => void; onClose: () => void; onSuccess: (user: User) => void }) {
  const dialogRef = useDialogFocus(true, onClose, '.user-link');
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setBusy(true); setError(''); const form = new FormData(event.currentTarget);
    try {
      const body = Object.fromEntries(form.entries());
      const result = await api<{user: User}>(`/auth/${mode}`, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
      if (result.user) onSuccess(result.user);
      else if (mode === 'register') { setMode('login'); setError('Аккаунт создан. Теперь войдите.'); }
    } catch (issue) { setError((issue as Error).message); } finally { setBusy(false); }
  };
  return <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}><div ref={dialogRef} tabIndex={-1} className="auth-modal" role="dialog" aria-modal="true" aria-label={mode === 'login' ? 'Вход' : 'Регистрация'}><button className="modal-close icon-button" onClick={onClose} aria-label="Закрыть"><X size={20}/></button><span className="overline">ЛИЧНЫЙ КАБИНЕТ</span><h2>{mode === 'login' ? 'С возвращением' : 'Создать аккаунт'}</h2><p>{mode === 'login' ? 'Войдите, чтобы управлять объектами, заказами и поставками.' : 'Зарегистрируйтесь, чтобы оформлять заказы и вести объекты.'}</p><form onSubmit={submit} className="form-stack">{mode === 'register' && <label>Имя<input name="name" required placeholder="Ваше имя"/></label>}<label>Электронная почта<input name="email" type="email" required placeholder="name@example.ru" autoComplete="email"/></label><label>Пароль<input name="password" type="password" required minLength={mode === 'register' ? 10 : undefined} placeholder={mode === 'register' ? 'Не менее 10 символов' : 'Ваш пароль'} autoComplete={mode === 'login' ? 'current-password' : 'new-password'}/></label>{error && <div className="form-error" role="alert">{error}</div>}<button className="btn btn-dark full" disabled={busy}>{busy ? 'Подождите…' : mode === 'login' ? 'Войти' : 'Зарегистрироваться'} <ArrowRight size={18}/></button></form><div className="auth-switch">{mode === 'login' ? 'Впервые здесь?' : 'Уже есть аккаунт?'} <button className="link-button" onClick={() => {setMode(mode === 'login' ? 'register' : 'login');setError('');}}>{mode === 'login' ? 'Создать аккаунт' : 'Войти'}</button></div><small className="auth-footnote">В демонстрации платежи не проводятся и деньги не списываются.</small></div></div>;
}

export function PageHeading({ eyebrow, title, description, action }: { eyebrow: string; title: string; description?: string; action?: React.ReactNode }) { return <div className="page-heading"><div><span className="overline">{eyebrow}</span><h1>{title}</h1>{description && <p>{description}</p>}</div>{action}</div>; }
export function ErrorPanel({ message, onRetry }: { message: string; onRetry?: () => void }) { return <div className="empty-state"><Package size={28}/><b>Не удалось загрузить данные</b><p>{message}</p>{onRetry && <button className="btn btn-outline" onClick={onRetry}>Повторить</button>}</div>; }
export function AuthRequired({ onAuth }: { onAuth: () => void }) { return <div className="empty-state large"><UserRound size={32}/><b>Войдите в личный кабинет</b><p>После входа здесь появятся ваши данные и действия.</p><button className="btn btn-dark" onClick={onAuth}>Войти <ArrowRight size={17}/></button></div>; }
