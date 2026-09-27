# Контракт приложения

Базовый путь API: `/api/v1`. Ответы JSON, ошибки: `{ "code": "string", "message": "string" }`. Денежные суммы передаются целым числом копеек, даты — ISO 8601, координаты — `[долгота, широта]`. Веб-приложение обращается к API через одноимённый прокси и передаёт HttpOnly cookie сеанса.

## Доступ

- `POST /auth/register` — `{name,email,password}`; создаёт покупателя.
- `POST /auth/login` — `{email,password}`; устанавливает cookie, возвращает `{user}`.
- `GET /auth/me`, `POST /auth/logout` — текущий пользователь и выход.
- Роли: `buyer`, `supplier`, `dispatcher`, `driver`, `admin`. Поставщик видит и меняет только собственные предложения. Покупатель видит только свои объекты и заказы.

## Каталог и предложения

- `GET /categories` — список `{id, name, slug}`.
- `GET /products?q=&category=&sort=&page=&limit=` — `{items, page, total}`. Элемент: `{id,slug,name,category,unit,imageUrl,priceFromKopecks,description,specs}`.
- `GET /products/:id` — карточка товара с массивом `offers`: `{id,supplierId,supplierName,warehouseId,priceKopecks,stock,deliveryDays,deliveryCostKopecks}`.
- `GET /supplier/offers`, `POST /supplier/offers`, `PATCH /supplier/offers/:id` — предложения авторизованного поставщика.

## Корзина, объект и расчёт

- Гостевая корзина хранится только в браузере; сервер при заказе заново проверяет цены, остатки и права. Позиция корзины: `{offerId,quantity}`.
- `POST /quotes` — `{items:[{offerId,quantity}], address, requestedDate?}`; возвращает строки предложения, итоги товаров и доставки, недоступные позиции и предупреждения. Расчёт не изменяет остатки.
- `GET /projects`, `POST /projects`, `GET /projects/:id`, `PATCH /projects/:id` — объекты покупателя. Объект хранит название, адрес, этапы и позиции потребности.
- `POST /projects/:id/items` — добавить потребность `{productId,quantity,stageDate?}`. Импорт CSV/XLSX выполняется через UI с проверкой строк и вызовом этого метода для валидных позиций.
- `POST /calculators/tiles|paint|dry-mix` — геометрия, норма расхода, размер упаковки и запас; ответ содержит формулу, расчётный расход и количество упаковок.

## Заказ и доставка

- `POST /orders` — `{items:[{offerId,quantity}],address,requestedDate?,projectId?}`; атомарно проверяет и резервирует остатки, фиксирует цены и разбивает заказ на поставки по поставщикам. Заголовок `Idempotency-Key` обязателен. Повтор с тем же телом возвращает прежний заказ; с другим телом отклоняется.
- `GET /orders`, `GET /orders/:id` — история и детали покупателя.
- `POST /orders/:id/cancel` — отмена неоплаченного заказа владельцем с восстановлением резерва. Неоплаченный резерв также истекает через 30 минут.
- `POST /orders/:id/demo-payment` — учебное подтверждение оплаты без списания денег.
- `GET /dispatch/deliveries`, `PATCH /dispatch/deliveries/:id` — планирование и назначение водителя.
- `GET /driver/deliveries`, `POST /driver/deliveries/:id/events` — просмотр рейса и допустимые переходы статуса.
- `GET /reports/summary` — сводка по учебным заказам и поставкам.

## Адреса и карты

- `GET /geo/suggest?q=` — подсказки DaData при наличии ключа; без ключа возвращает локальные адреса демо с `source: "demo"`.
- `GET /geo/route?fromLon=&fromLat=&toLon=&toLat=` — маршрут 2ГИС при наличии ключа; без ключа — локальная демонстрационная полилиния с `source: "demo"`.
- Веб-карта использует MapGL при наличии ключа тайлов. Без ключа отображает локальную схему с теми же объектами и подписью «Деморежим».

## Демо и безопасность

Сид заполняет товары, поставщиков, склады, объекты, заказы и рейсы в Астраханском регионе. Учётные записи и пароли опубликованы только как демонстрационные. Реальных платежей и GPS нет; анимация транспорта строится по сохранённому маршруту. Внешние ключи не должны попадать в код или историю Git.
