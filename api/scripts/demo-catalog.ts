import type { Packaging } from '../src/packaging';

export type DemoProduct = readonly [key: string, category: string, name: string, unit: string, specs: Record<string,string>, description: string];

// Вымышленные позиции: характеристики служат примерами ввода, цены не являются прайсом.
export const additionalProducts: DemoProduct[] = [
  ['cement-m400','dry','Цемент М400 25 кг','мешок',{'Вес':'25 кг','Марка':'М400'},'Для кладочных растворов и подготовки оснований.'],
  ['screed','dry','Стяжка цементная 25 кг','мешок',{'Вес':'25 кг','Слой':'10–80 мм'},'Для выравнивания пола перед чистовым покрытием.'],
  ['self-level','dry','Наливной пол финишный 20 кг','мешок',{'Вес':'20 кг','Слой':'3–20 мм'},'Для тонкого выравнивания минеральных оснований.'],
  ['putty-start','dry','Шпаклёвка стартовая 20 кг','мешок',{'Вес':'20 кг','Основание':'Гипс'},'Для подготовки внутренних стен под отделку.'],
  ['putty-finish','dry','Шпаклёвка финишная 5 кг','мешок',{'Вес':'5 кг','Слой':'До 3 мм'},'Для окончательного выравнивания перед окраской.'],
  ['adhesive-flex','dry','Клей эластичный C2 25 кг','мешок',{'Вес':'25 кг','Класс':'C2'},'Для облицовки пола керамогранитом.'],
  ['mortar','dry','Смесь кладочная М150 40 кг','мешок',{'Вес':'40 кг','Марка':'М150'},'Для кирпичной кладки и небольших ремонтных работ.'],
  ['paint-ceiling','paint','Краска потолочная 5 л','ведро',{'Объём':'5 л','Блеск':'Матовый'},'Белая краска для потолков сухих помещений.'],
  ['paint-washable','paint','Краска моющаяся 2,5 л','ведро',{'Объём':'2,5 л','Цвет':'Слоновая кость'},'Для стен кухни и коридора.'],
  ['primer','paint','Грунтовка глубокого проникновения 10 л','канистра',{'Объём':'10 л','Основание':'Минеральное'},'Для подготовки впитывающих поверхностей.'],
  ['concrete-contact','paint','Грунт бетоноконтакт 6 кг','ведро',{'Вес':'6 кг','Наполнитель':'Кварцевый'},'Адгезионный грунт для гладких бетонных оснований.'],
  ['enamel','paint','Эмаль алкидная серая 2,7 кг','банка',{'Вес':'2,7 кг','Цвет':'Серый'},'Для деревянных и металлических элементов.'],
  ['wood-varnish','paint','Лак для дерева 1 л','банка',{'Объём':'1 л','Блеск':'Полуматовый'},'Защитное покрытие внутренних деревянных деталей.'],
  ['decorative-plaster','paint','Штукатурка декоративная 15 кг','ведро',{'Вес':'15 кг','Зерно':'1,5 мм'},'Готовое декоративное покрытие для минеральных стен.'],
  ['tile-white-box','tile','Плитка Белая 20×30 — коробка','коробка',{'Формат':'20×30 см','Поверхность':'Глянцевая'},'Настенная плитка; в коробке 20 штук, 1,2 м².'],
  ['tile-marble-box','tile','Керамогранит Мрамор 60×60 — коробка','коробка',{'Формат':'60×60 см','Поверхность':'Матовая'},'Керамогранит для пола; в коробке 4 штуки, 1,44 м².'],
  ['tile-wood-box','tile','Керамогранит Дуб 20×120 — коробка','коробка',{'Формат':'20×120 см','Поверхность':'Рельефная'},'Плитка с рисунком дерева; 6 штук, 1,44 м².'],
  ['tile-stone-box','tile','Плитка Камень 30×30 — коробка','коробка',{'Формат':'30×30 см','Поверхность':'Матовая'},'Напольная плитка; 12 штук, 1,08 м².'],
  ['mosaic','tile','Мозаика Лагуна 30×30','лист',{'Формат':'30×30 см','Основа':'Сетка'},'Керамическая мозаика для декоративных вставок.'],
  ['tile-border','tile','Бордюр Белый 5×30','шт.',{'Формат':'5×30 см','Назначение':'Стена'},'Бордюр для завершения настенной облицовки.'],
  ['grout','tile','Затирка серая 2 кг','пакет',{'Вес':'2 кг','Шов':'2–6 мм'},'Цементная затирка для межплиточных швов.'],
  ['timber','wood','Брус 100×100×6000','шт.',{'Порода':'Сосна','Сечение':'100×100 мм'},'Брус для каркасных конструкций.'],
  ['batten','wood','Брусок 40×50×3000','шт.',{'Порода':'Сосна','Длина':'3 м'},'Для обрешётки и вспомогательных конструкций.'],
  ['board-planed','wood','Доска строганая 20×100×3000','шт.',{'Порода':'Сосна','Обработка':'Строганая'},'Для внутренних деревянных элементов.'],
  ['plywood-thin','wood','Фанера ФК 6 мм 1525×1525','лист',{'Толщина':'6 мм','Сорт':'2/4'},'Для внутренних обшивок и шаблонов.'],
  ['osb','wood','Плита ОСП-3 9 мм 1250×2500','лист',{'Толщина':'9 мм','Класс':'ОСП-3'},'Для обшивки каркасов и черновых оснований.'],
  ['lining','wood','Вагонка сосна 12,5×96×3000','упаковка',{'Длина':'3 м','В упаковке':'10 шт.'},'Для отделки внутренних стен.'],
  ['terrace-board','wood','Доска террасная 28×140×3000','шт.',{'Порода':'Лиственница','Поверхность':'Рифлёная'},'Для настила открытой террасы.'],
  ['wool-thick','insulation','Минеральная вата 100 мм 3 м²','упаковка',{'Толщина':'100 мм','Площадь':'3 м²'},'Утеплитель для каркасных стен.'],
  ['wool-acoustic','insulation','Вата акустическая 50 мм 6 м²','упаковка',{'Толщина':'50 мм','Площадь':'6 м²'},'Для заполнения внутренних перегородок.'],
  ['xps','insulation','Экструдированный пенополистирол 50 мм 4 м²','упаковка',{'Толщина':'50 мм','Площадь':'4 м²'},'Для утепления пола и цоколя.'],
  ['foam','insulation','Пенополистирол 100 мм 2 м²','упаковка',{'Толщина':'100 мм','Площадь':'2 м²'},'Плитная теплоизоляция для ограждающих конструкций.'],
  ['wind-membrane','insulation','Ветрозащитная мембрана 70 м²','рулон',{'Площадь':'70 м²','Назначение':'Наружная защита'},'Для защиты утеплителя каркасных стен.'],
  ['foil-insulation','insulation','Изоляция фольгированная 5 мм 30 м²','рулон',{'Толщина':'5 мм','Площадь':'30 м²'},'Вспомогательный изоляционный слой.'],
  ['waterproof','insulation','Гидроизоляционная мастика 5 кг','ведро',{'Вес':'5 кг','Назначение':'Влажные помещения'},'Для подготовки пола санузла перед облицовкой.'],
];

export const additionalPackaging: Record<string,Packaging> = {
  'cement-m400':{kind:'dry-mix',packSizeKg:25},screed:{kind:'dry-mix',packSizeKg:25},
  'self-level':{kind:'dry-mix',packSizeKg:20},'putty-start':{kind:'dry-mix',packSizeKg:20},
  'putty-finish':{kind:'dry-mix',packSizeKg:5},'adhesive-flex':{kind:'dry-mix',packSizeKg:25},mortar:{kind:'dry-mix',packSizeKg:40},
  'paint-ceiling':{kind:'paint',packSizeL:5},'paint-washable':{kind:'paint',packSizeL:2.5},
  'tile-white-box':{kind:'tiles',tileAreaM2:0.06,tilesPerPack:20},'tile-marble-box':{kind:'tiles',tileAreaM2:0.36,tilesPerPack:4},
  'tile-wood-box':{kind:'tiles',tileAreaM2:0.24,tilesPerPack:6},'tile-stone-box':{kind:'tiles',tileAreaM2:0.09,tilesPerPack:12},
};

export const additionalProjects = [
  {key:'project-office',name:'Отделка небольшого офиса',address:'Астрахань, ул. Савушкина, 6',stages:[['Подготовка стен',20],['Покраска и пол',45]],items:[['putty-start',14,0],['putty-finish',9,0],['paint-ceiling',4,1],['tile-marble-box',22,1]]},
  {key:'project-terrace',name:'Устройство террасы',address:'Астрахань, ул. Боевая, 25',stages:[['Каркас',25],['Настил',50]],items:[['timber',18,0],['batten',24,0],['terrace-board',36,1],['wood-varnish',8,1]]},
  {key:'project-bathroom',name:'Ремонт санузла',address:'Астрахань, ул. Адмиралтейская, 14',stages:[['Гидроизоляция',15],['Облицовка',35]],items:[['waterproof',3,0],['tile-white-box',16,1],['adhesive-flex',6,1],['grout',5,1],['mosaic',12,1]]},
  {key:'project-workshop',name:'Утепление мастерской',address:'Астрахань, ул. Боевая, 25',stages:[['Обрешётка и утепление',28],['Обшивка',55]],items:[['batten',30,0],['wool-thick',18,0],['wind-membrane',2,0],['osb',14,1],['lining',8,1]]},
] as const;

export type DemoDeliveryStatus = 'pending'|'assigned'|'picked_up'|'in_transit'|'delivered'|'cancelled';
export type DemoOrder = {
  key: string; project: string; address: string; coordinates: readonly [number,number] | null;
  daysAgo: number; terminal?: 'expired'|'cancelled';
  items: readonly (readonly [product: string, supplier: 'volga'|'kaspiy', quantity: number])[];
  deliveries: Partial<Record<'volga'|'kaspiy',DemoDeliveryStatus>>;
};
const savushkina = {address:'Астрахань, ул. Савушкина, 6',coordinates:[48.057,46.371] as const};
const admiralteyskaya = {address:'Астрахань, ул. Адмиралтейская, 14',coordinates:[48.035,46.351] as const};
export const demoOrders: DemoOrder[] = [
  {key:'demo-order-active',project:'project-demo',...savushkina,daysAgo:1,items:[['cement','volga',4]],deliveries:{volga:'assigned'}},
  {key:'demo-order-complete',project:'project-demo',...savushkina,daysAgo:24,items:[['paint-white','volga',2]],deliveries:{volga:'delivered'}},
  {key:'demo-order-office-preparation',project:'project-office',...savushkina,daysAgo:2,items:[['putty-start','volga',10],['putty-finish','kaspiy',6]],deliveries:{volga:'pending',kaspiy:'pending'}},
  {key:'demo-order-office-finishing',project:'project-office',...savushkina,daysAgo:1,items:[['tile-marble-box','kaspiy',16],['paint-ceiling','volga',3]],deliveries:{volga:'assigned',kaspiy:'assigned'}},
  {key:'demo-order-terrace-frame',project:'project-terrace',address:'Астрахань, ул. Боевая, 25',coordinates:null,daysAgo:3,items:[['timber','volga',12],['batten','kaspiy',16]],deliveries:{volga:'picked_up',kaspiy:'assigned'}},
  {key:'demo-order-terrace-deck',project:'project-terrace',address:'Астрахань, ул. Боевая, 25',coordinates:null,daysAgo:2,items:[['terrace-board','kaspiy',24],['wood-varnish','kaspiy',5]],deliveries:{kaspiy:'in_transit'}},
  {key:'demo-order-bathroom-base',project:'project-bathroom',...admiralteyskaya,daysAgo:9,items:[['waterproof','volga',3],['screed','kaspiy',4]],deliveries:{volga:'delivered',kaspiy:'delivered'}},
  {key:'demo-order-bathroom-tiles',project:'project-bathroom',...admiralteyskaya,daysAgo:1,items:[['tile-white-box','volga',12],['adhesive-flex','kaspiy',5],['grout','volga',4]],deliveries:{volga:'in_transit',kaspiy:'picked_up'}},
  {key:'demo-order-workshop-insulation',project:'project-workshop',address:'Астрахань, ул. Боевая, 25',coordinates:null,daysAgo:4,items:[['wool-thick','volga',12],['wind-membrane','kaspiy',2]],deliveries:{volga:'delivered',kaspiy:'in_transit'}},
  {key:'demo-order-workshop-cladding',project:'project-workshop',address:'Астрахань, ул. Боевая, 25',coordinates:null,daysAgo:1,items:[['osb','volga',10],['lining','kaspiy',6]],deliveries:{volga:'pending',kaspiy:'assigned'}},
  {key:'demo-order-expired',project:'project-office',...savushkina,daysAgo:6,terminal:'expired',items:[['paint-washable','volga',2]],deliveries:{volga:'cancelled'}},
  {key:'demo-order-cancelled',project:'project-bathroom',...admiralteyskaya,daysAgo:5,terminal:'cancelled',items:[['mosaic','kaspiy',8]],deliveries:{kaspiy:'cancelled'}},
];
