'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Hammer, Paintbrush, ArrowDownRight, ArrowRight, ArrowUpRight, Building2, Check, ChevronDown, Clock3, ClipboardList, Layers3, LayoutDashboard, LogOut, MapPin, Menu, Moon, Package, Search, ShoppingBag, SlidersHorizontal, Sun, Truck, UserRound, X } from 'lucide-react';
import { api, type CartItem, type Category, type Product, type User, money } from '@/lib/api';
import { readCart, readCompare, saveCart, saveCompare } from '@/lib/storage';
import { useDialogFocus } from '@/lib/use-dialog-focus';
import { Catalog, ProductDetails, Compare } from './shopping';
import { Cart, Checkout, Orders } from './orders';
import { Projects, ProjectDetails } from './projects';
import { RoleWorkspace } from './roles';
import { MaterialArt } from './material-art';
import { HeroPreview } from './hero-preview';
import { AboutProject } from './about-project';

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
    api<{ items: Product[] }>('/products?limit=8').then(data => setFeatured(data.items)).catch(() => setFeatured([])).finally(() => setLoadingHome(false));
    const sync = () => { setCart(readCart()); setCompare(readCompare()); };
    window.addEventListener('cart-change', sync); window.addEventListener('compare-change', sync);
    return () => { window.removeEventListener('cart-change', sync); window.removeEventListener('compare-change', sync); };
  }, [refreshUser]);
  useEffect(() => { document.documentElement.dataset.theme = theme; localStorage.setItem('objectmarket-theme', theme); }, [theme]);
  useEffect(() => { setMenu(false); window.scrollTo(0, 0); }, [pathname]);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(''), 5000); return () => clearTimeout(timer); }, [notice]);

  const addToCart = useCallback((item: CartItem) => {
    const current = readCart(); const found = current.find(entry => entry.offerId === item.offerId.toLowerCase());
    const quantity = (found?.quantity || 0) + item.quantity;
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10000) {
      setNotice('В корзине можно заказать до 10 000 единиц одного предложения'); return;
    }
    if (!found && current.length >= 50) {
      setNotice('В корзине можно заказать до 50 разных предложений'); return;
    }
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
    <header className="site-header">
      <div className="container header-topline"><span><MapPin size={13}/> Астрахань и область</span><div><Link href="/about">О системе</Link>{user && <><span className="header-role">{roleNames[user.role]}</span><button className="link-button logout" onClick={logout}>Выйти</button></>}<button className="icon-button theme-button" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')} title={theme === 'light' ? 'Тёмная тема' : 'Светлая тема'} aria-label="Переключить тему">{theme === 'light' ? <Moon size={15}/> : <Sun size={15}/>}</button></div></div>
      <div className="container header-inner">
        <Link href="/" className="brand" aria-label="СтройПоток — главная"><Image src="/images/brand/stroypotok-mark.png" width={40} height={40} alt="" className="brand-logo" priority/><span className="brand-label"><span className="brand-wordmark">СТРОЙ<span className="brand-accent">ПОТОК</span></span><small>снабжение строительных объектов</small></span></Link>
        <Link href="/catalog" className="header-catalog"><Menu size={20}/><span>Каталог</span></Link>
        <form className="header-search" onSubmit={homeSearch} role="search"><input name="q" placeholder="Искать в СтройПотоке" aria-label="Поиск материалов"/><button type="submit" aria-label="Найти материалы"><Search size={22}/></button></form>
        <div className="header-actions">
          {user ? <Link href="/workspace" className="header-action user-link"><UserRound size={23}/><span>{user.name.split(' ')[0]}</span></Link> : <button className="header-action login-button" onClick={openAuth}><UserRound size={23}/><span>Войти</span></button>}
          <Link className="header-action" href="/projects"><Building2 size={23}/><span>Объекты</span></Link>
          <Link className="header-action" href="/orders"><Package size={23}/><span>Заказы</span></Link>
          <Link className="header-action bag-button" href="/cart" title="Корзина" aria-label={`Корзина, товаров: ${totalQuantity}`}><ShoppingBag size={23}/><span>Корзина</span>{totalQuantity > 0 && <span className="bag-badge">{totalQuantity}</span>}</Link>
          <button className="icon-button mobile-menu" onClick={() => setMenu(!menu)} aria-label={menu ? 'Закрыть меню' : 'Открыть меню'} aria-expanded={menu} aria-controls="main-navigation">{menu ? <X size={22}/> : <Menu size={22}/>}</button>
        </div>
      </div>
      <nav id="main-navigation" className={menu ? 'container main-nav open' : 'container main-nav'} aria-label="Основная навигация">
        <Link className={current === 'catalog' ? 'active' : ''} href="/catalog">Все материалы</Link>
        {categories.slice(0,6).map(category => <Link key={category.id} href={`/catalog?category=${encodeURIComponent(category.slug)}`}>{category.name}</Link>)}
        <Link className={current === 'projects' ? 'active' : ''} href="/projects">Мои объекты</Link>
        <Link className={current === 'compare' ? 'active' : ''} href="/compare">Сравнение{compare.length > 0 && <span className="nav-count">{compare.length}</span>}</Link>
        {user && <Link className={current === 'workspace' ? 'active' : ''} href="/workspace">Рабочий кабинет</Link>}
        <button className="mobile-theme-option" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>{theme === 'light' ? <Moon size={18}/> : <Sun size={18}/>} {theme === 'light' ? 'Тёмная тема' : 'Светлая тема'}</button>
        {user && <button type="button" className="mobile-logout" onClick={() => { setMenu(false); void logout(); }}><LogOut size={18}/>Выйти</button>}
      </nav>
    </header>

    <main id="main-content" tabIndex={-1}>
      {current === 'home' && <Home categories={categories} featured={featured} loading={loadingHome} addToCart={addToCart} toggleCompare={toggleCompare} compare={compare} />}
      {current === 'catalog' && <Catalog categories={categories} addToCart={addToCart} toggleCompare={toggleCompare} compare={compare} />}
      {current === 'product' && segments[1] && <ProductDetails id={segments[1]} addToCart={addToCart} toggleCompare={toggleCompare} compare={compare} />}
      {current === 'compare' && <Compare ids={compare} addToCart={addToCart} toggleCompare={toggleCompare} />}
      {current === 'cart' && <Cart cart={cart} onAuth={openAuth} user={user} />}
      {current === 'checkout' && <Checkout cart={cart} user={user} onAuth={openAuth} onDone={() => saveCart([])} />}
      {current === 'orders' && <Orders user={user} onAuth={openAuth} orderId={segments[1]} />}
      {current === 'projects' && !segments[1] && <Projects user={user} onAuth={openAuth} />}
      {current === 'projects' && segments[1] && <ProjectDetails id={segments[1]} user={user} onAuth={openAuth} addToCart={addToCart} />}
      {current === 'workspace' && <RoleWorkspace user={user} onAuth={openAuth} />}
      {current === 'about' && <AboutProject />}
      {!['home','catalog','product','compare','cart','checkout','orders','projects','workspace','about'].includes(current) && <div className="container section"><h1>Страница не найдена</h1><Link href="/" className="btn btn-dark">На главную</Link></div>}
    </main>

    <footer className="footer"><div className="container footer-grid"><div><Link href="/" className="brand footer-brand" aria-label="СтройПоток — главная"><Image src="/images/brand/stroypotok-mark.png" width={40} height={40} alt="" className="brand-logo"/><span className="brand-wordmark">СТРОЙ<span className="brand-accent">ПОТОК</span></span></Link><p>Материалы, поставщики и график работ — в одной системе.</p><small>Материалы и поставки · Астрахань</small></div><div><b>Покупателям</b><Link href="/catalog">Каталог</Link><Link href="/compare">Сравнение</Link><Link href="/projects">Объекты</Link></div><div><b>Мой кабинет</b><Link href="/orders">Заказы</Link><Link href="/workspace">Рабочий кабинет</Link><Link href="/cart">Корзина</Link></div><div className="footer-note"><Link href="/about" className="btn btn-outline" style={{ minHeight: 44 }}>О проекте <ArrowUpRight size={17}/></Link></div></div></footer>
    {notice && <div className="toast" role="status"><Check size={17}/>{notice}<button onClick={() => setNotice('')} aria-label="Закрыть"><X size={15}/></button></div>}
    {authOpen && <AuthModal mode={authMode} setMode={setAuthMode} onClose={() => setAuthOpen(false)} onSuccess={onAuth} />}
  </>;
}

function Home({ categories, featured, loading, addToCart, toggleCompare, compare }: { categories: Category[]; featured: Product[]; loading: boolean; addToCart: (item: CartItem) => void; toggleCompare: (id: string) => void; compare: string[] }) {
  const categoryIcons: Record<string, typeof Package> = { 'izolyatsiya': Layers3, 'kraski-i-otdelka': Paintbrush, 'pilomaterialy': Hammer, 'plitka': Layers3, 'sukhie-smesi': Package };
  return <>
    <section className="hero"><div className="container hero-grid">
      <div className="hero-copy"><div className="eyebrow"><span className="eyebrow-line"/> ДЛЯ СТРОЙКИ И РЕМОНТА</div><h1>Материалы для стройки.<br/><em>Всё по вашему плану.</em></h1><p>Смеси, плитка, краска и всё для отделки. Сравнивайте предложения поставщиков и собирайте заказ к нужному этапу работ.</p>
        <div className="hero-actions"><Link href="/projects" className="btn btn-dark">Создать объект <ArrowUpRight size={18}/></Link><Link href="/catalog" className="btn btn-outline">Открыть каталог <ArrowRight size={18}/></Link></div>

      </div><HeroPreview/>
    </div></section>
    <section className="container section categories-section"><div className="section-heading"><div><span className="overline">КАТАЛОГ МАТЕРИАЛОВ</span><h2>Что нужно для ваших работ?</h2></div><Link href="/catalog" className="text-link">Весь каталог <ArrowUpRight size={17}/></Link></div><div className="category-grid">{categories.slice(0,6).map((category,index) => { const Icon = categoryIcons[category.slug] || Package; return <Link href={`/catalog?category=${encodeURIComponent(category.slug)}`} key={category.id} className={`category-card category-${index}`}><span className="category-icon"><Icon size={25} strokeWidth={1.6}/></span><span className="category-card-bottom"><b>{category.name}</b><ArrowUpRight size={20}/></span></Link>; })}</div>{!categories.length && <Link className="category-empty" href="/catalog">Перейти к материалам в каталоге <ArrowRight size={18}/></Link>}</section>
    <section className="container section featured-section"><div className="section-heading"><div><span className="overline">ПРЕДЛОЖЕНИЯ ПОСТАВЩИКОВ</span><h2>Выбирайте материалы</h2></div><Link href="/catalog" className="text-link">Смотреть всё <ArrowUpRight size={17}/></Link></div>{loading ? <div className="loading-row">Загружаем материалы…</div> : featured.length ? <div className="product-grid">{featured.map(product => <CompactProduct key={product.id} product={product} addToCart={addToCart} toggleCompare={toggleCompare} selected={compare.includes(product.id)}/>)}</div> : <div className="empty-state"><p>Не удалось загрузить подборку материалов. Попробуйте открыть каталог ещё раз.</p><Link href="/catalog" className="btn btn-outline">Открыть каталог <ArrowRight size={17}/></Link></div>}</section>
    <section className="container section steps-section"><div className="section-heading"><div><span className="overline">ПОСЛЕДОВАТЕЛЬНОСТЬ ЗАКУПКИ</span><h2>Сначала потребность. Затем заказ.</h2></div><Link href="/projects" className="text-link">Мои объекты <ArrowUpRight size={17}/></Link></div><div className="steps-grid"><div><span>01 / ВЕДОМОСТЬ</span><ClipboardList size={25}/><h3>Соберите потребность</h3><p>Добавьте материалы в объект, рассчитайте упаковки или загрузите готовую ведомость.</p></div><div><span>02 / ПРЕДЛОЖЕНИЯ</span><Search size={25}/><h3>Проверьте полную стоимость</h3><p>Сравните наличие и цену. Стоимость товаров и доставки показана отдельно.</p></div><div><span>03 / ПОСТАВКА</span><Truck size={25}/><h3>Следите за заказом</h3><p>Закажите материалы к этапу работ и проверяйте статусы поставки в кабинете.</p></div></div></section>
  </>;
}

export function CompactProduct({ product, addToCart, toggleCompare, selected }: { product: Product; addToCart: (item: CartItem) => void; toggleCompare: (id: string) => void; selected: boolean }) {
  return <article className="product-card"><Link href={`/product/${product.id}`} className="product-image"><MaterialArt product={product}/><span className="product-image-link"><ArrowUpRight size={18}/></span></Link><div className="product-info"><div className="product-bottom"><div><small>от</small><b>{money(product.priceFromKopecks)}</b></div><button className="small-icon-button" onClick={() => toggleCompare(product.id)} title={selected ? 'Убрать из сравнения' : 'Сравнить'} aria-label="Сравнить товар">{selected ? <Check size={19}/> : <Layers3 size={19}/>}</button></div><Link href={`/product/${product.id}`} className="product-name">{product.name}</Link><span className="product-unit">за {product.unit}</span><span className="product-category">{typeof product.category === 'string' ? product.category : product.category.name}</span><Link href={`/product/${product.id}`} className="product-add">Предложения <ArrowRight size={16}/></Link></div></article>;
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
  return <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}><div ref={dialogRef} tabIndex={-1} className="auth-modal" role="dialog" aria-modal="true" aria-label={mode === 'login' ? 'Вход' : 'Регистрация'}><button className="modal-close icon-button" onClick={onClose} aria-label="Закрыть"><X size={20}/></button><span className="overline">ЛИЧНЫЙ КАБИНЕТ</span><h2>{mode === 'login' ? 'С возвращением' : 'Создать аккаунт'}</h2><p>{mode === 'login' ? 'Войдите, чтобы управлять объектами, заказами и поставками.' : 'Зарегистрируйтесь, чтобы оформлять заказы и вести объекты.'}</p><form onSubmit={submit} className="form-stack">{mode === 'register' && <label>Имя<input name="name" required placeholder="Ваше имя"/></label>}<label>Электронная почта<input name="email" type="email" required placeholder="name@example.ru" autoComplete="email"/></label><label>Пароль<input name="password" type="password" required minLength={mode === 'register' ? 10 : undefined} placeholder={mode === 'register' ? 'Не менее 10 символов' : 'Ваш пароль'} autoComplete={mode === 'login' ? 'current-password' : 'new-password'}/></label>{error && <div className="form-error" role="alert">{error}</div>}<button className="btn btn-dark full" disabled={busy}>{busy ? 'Подождите…' : mode === 'login' ? 'Войти' : 'Зарегистрироваться'} <ArrowRight size={18}/></button></form><div className="auth-switch">{mode === 'login' ? 'Впервые здесь?' : 'Уже есть аккаунт?'} <button className="link-button" onClick={() => {setMode(mode === 'login' ? 'register' : 'login');setError('');}}>{mode === 'login' ? 'Создать аккаунт' : 'Войти'}</button></div></div></div>;
}

export function PageHeading({ eyebrow, title, description, action }: { eyebrow: string; title: string; description?: string; action?: React.ReactNode }) { return <div className="page-heading"><div><span className="overline">{eyebrow}</span><h1>{title}</h1>{description && <p>{description}</p>}</div>{action}</div>; }
export function ErrorPanel({ message, onRetry }: { message: string; onRetry?: () => void }) { return <div className="empty-state"><Package size={28}/><b>Не удалось загрузить данные</b><p>{message}</p>{onRetry && <button className="btn btn-outline" onClick={onRetry}>Повторить</button>}</div>; }
export function AuthRequired({ onAuth }: { onAuth: () => void }) { return <div className="empty-state large"><UserRound size={32}/><b>Войдите в личный кабинет</b><p>После входа здесь появятся ваши данные и действия.</p><button className="btn btn-dark" onClick={onAuth}>Войти <ArrowRight size={17}/></button></div>; }
