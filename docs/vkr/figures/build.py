"""Рисунки архитектуры и связей данных для пояснительной записки."""

from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent
FONT_DIR = Path("C:/Windows/Fonts")


class Diagram:
    def __init__(self, height):
        self.image = Image.new("RGB", (1800, height), "white")
        self.draw = ImageDraw.Draw(self.image)

    def text(self, xy, value, size=36, bold=False):
        font = ImageFont.truetype(str(FONT_DIR / ("arialbd.ttf" if bold else "arial.ttf")), size)
        self.draw.text(xy, value, font=font, fill="#20252b")

    def box(self, bounds, title, lines):
        left, top, right, bottom = bounds
        self.draw.rounded_rectangle(bounds, radius=14, fill="#f6f7f8", outline="#40464d", width=3)
        self.text((left + 24, top + 20), title, 42, True)
        self.draw.line((left, top + 80, right, top + 80), fill="#a0a5ab", width=2)
        for index, line in enumerate(lines):
            self.text((left + 24, top + 102 + 48 * index), line, 34)

    def arrow(self, points, dashed=False):
        for start, end in zip(points, points[1:]):
            if dashed:
                length = math.dist(start, end)
                for offset in range(0, int(length), 25):
                    a, b = offset / length, min(offset + 14, length) / length
                    self.draw.line(tuple(tuple(start[k] + (end[k] - start[k]) * t for k in range(2)) for t in (a, b)), fill="#626a72", width=4)
            else:
                self.draw.line((start, end), fill="#40464d", width=4)
        start, end = points[-2:]
        angle = math.atan2(end[1] - start[1], end[0] - start[0])
        head = [end] + [(end[0] - 20 * math.cos(angle + delta), end[1] - 20 * math.sin(angle + delta)) for delta in (-0.5, 0.5)]
        self.draw.polygon(head, fill="#40464d")

    def save(self, name):
        self.image.save(ROOT / name, dpi=(280, 280))


def architecture():
    diagram = Diagram(1140)
    diagram.box((90, 40, 900, 250), "Интерфейс Next.js / React", ["Каталог, объекты и рабочие кабинеты", "Формы и состояние браузера"])
    diagram.box((90, 420, 900, 630), "Сервер NestJS", ["Права, расчёты и операции заказа", "Проверка входных данных"])
    diagram.box((90, 800, 900, 1010), "PostgreSQL", ["Каталог, потребность, заказы и остатки", "Транзакции и миграции"])
    diagram.box((1100, 300, 1740, 650), "Внешние сервисы", ["MapGL — карта в браузере", "DaData — адресные подсказки", "Routing API — расчёт маршрута", "Подключение по настройкам"])
    diagram.arrow([(480, 250), (480, 420)])
    diagram.text((515, 310), "HTTP / JSON")
    diagram.arrow([(480, 630), (480, 800)])
    diagram.text((515, 695), "SQL / транзакции")
    diagram.arrow([(900, 140), (1020, 140), (1020, 365), (1100, 365)], dashed=True)
    diagram.arrow([(900, 525), (1100, 525)], dashed=True)
    diagram.text((1070, 755), "Ключи и сетевой доступ нужны", 31)
    diagram.text((1070, 800), "для внешних сервисов.", 31)
    diagram.text((90, 1070), "Локальный запуск приложения и базы данных — Docker Compose.", 33)
    diagram.save("architecture.png")


def data_model():
    diagram = Diagram(1190)
    diagram.box((50, 40, 550, 290), "users", ["PK id", "role, email"])
    diagram.box((650, 40, 1150, 290), "projects", ["PK id", "FK buyer_id → users", "name, address"])
    diagram.box((1250, 40, 1750, 290), "project_items", ["FK project_id → projects", "FK product_id → products", "quantity, stage_date"])
    diagram.box((50, 430, 550, 680), "warehouses", ["PK id", "FK supplier_id → suppliers", "address, lat, lon"])
    diagram.box((650, 430, 1150, 730), "offers", ["FK warehouse_id", "FK supplier_id, product_id", "price_kopecks, stock", "delivery_days"])
    diagram.box((1250, 430, 1750, 680), "products", ["PK id", "name, unit", "packaging"])
    diagram.box((50, 840, 550, 1040), "suppliers", ["PK id", "name"])
    diagram.arrow([(650, 160), (550, 160)])
    diagram.arrow([(1250, 160), (1150, 160)])
    diagram.arrow([(1500, 290), (1500, 430)])
    diagram.arrow([(650, 550), (550, 550)])
    diagram.arrow([(1150, 550), (1250, 550)])
    diagram.arrow([(300, 680), (300, 840)])
    diagram.arrow([(900, 730), (900, 940), (550, 940)])
    diagram.text((650, 1040), "Стрелка направлена к записи,", 31)
    diagram.text((650, 1085), "на которую ссылается внешний ключ.", 31)
    diagram.text((50, 1135), "Фрагмент схемы: потребность объекта и предложения поставщиков.", 33)
    diagram.save("data-model.png")


if __name__ == "__main__":
    architecture()
    data_model()
