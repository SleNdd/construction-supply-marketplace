# Запуск и развёртывание

## Локальная демонстрация

Нужны Docker Engine или Docker Desktop с Compose и свободный порт 3000. Скопируйте `.env.example` в `.env` и замените `POSTGRES_PASSWORD` на собственное значение. Файл включает `DEMO_SEED=true`: при первом запуске будут созданы учебные аккаунты из README. Для учебного запуска ключи 2ГИС и DaData можно оставить пустыми.

```bash
docker compose up --build -d
docker compose ps
```

Откройте `http://localhost:3000`. При первом старте API применяет миграции и добавляет демоданные. Повторный старт сохраняет созданные заказы. Для диагностики используйте `docker compose logs --tail=100 api web db`. Команда `docker compose down` останавливает контейнеры и сохраняет данные PostgreSQL в именованном томе.

Ключ карты 2ГИС передаётся в `GIS_MAP_KEY`, маршрутизации — в `GIS_ROUTING_KEY`, адресных подсказок — в `DADATA_API_KEY`. Ключ карты виден браузеру и должен быть ограничен по домену в кабинете провайдера. Серверные ключи в браузер не передаются. После изменения ключа карты пересоберите веб-образ. Без ключей интерфейс показывает деморежим.

## Ubuntu VPS

Для сервера нужны Ubuntu, Docker Engine с Compose, домен с A-записью на сервер и открытые порты 80/443. Скопируйте каталог проекта, создайте `.env` со значениями `POSTGRES_PASSWORD`, `DOMAIN=market.example.ru` и `PUBLIC_ORIGIN=https://market.example.ru`. Укажите `DEMO_SEED=false`, `COOKIE_SECURE=true`, `WEB_BIND_IP=127.0.0.1`. Файл `docker-compose.vps.yml` дополнительно запускает Caddy для HTTPS и принудительно отключает демосид.

```bash
docker compose -f docker-compose.yml -f docker-compose.vps.yml up --build -d
docker compose -f docker-compose.yml -f docker-compose.vps.yml ps
```

После запуска создайте администратора командой `docker compose -f docker-compose.yml -f docker-compose.vps.yml run --rm -e ADMIN_NAME -e ADMIN_EMAIL -e ADMIN_PASSWORD api npm run bootstrap:admin`. Значения `ADMIN_NAME`, `ADMIN_EMAIL` и `ADMIN_PASSWORD` задаются в окружении перед вызовом; пароль должен содержать не менее 12 символов. Команда отклоняет повторную регистрацию того же адреса.

Веб-сервис слушает только `127.0.0.1:3000`, PostgreSQL доступен лишь внутри сети Compose. Caddy получает сертификат для `DOMAIN` и передаёт запросы веб-сервису. Для резервного копирования настройте регулярный `pg_dump`, храните копии вне сервера и проверьте восстановление на отдельной базе. Перед использованием с реальными клиентами нужны поставщики и актуальные остатки, пользовательские документы, мониторинг и испытание внешних интеграций. В рамках ВКР публичный сервер не развёрнут.
