import { expect, test, type Page, type Route } from "@playwright/test";
import { reply } from "./fixtures";
import type { Category, Product } from "../src/lib/api";

const category: Category = {
  id: "category",
  name: "Материалы",
  slug: "materials",
};
const product: Product = {
  id: "product",
  name: "Кирпич",
  slug: "brick",
  category: "Материалы",
  categoryId: "category",
  unit: "шт",
  priceFromKopecks: 0,
  specs: {},
};
type Intercept = (
  route: Route,
  path: string,
  url: URL,
) => Promise<boolean | void>;
async function mock(page: Page, intercept?: Intercept) {
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace("/api/v1", "");
    if (await intercept?.(route, path, url)) return;
    if (path === "/auth/me")
      return reply(route, {
        user: {
          id: "admin",
          name: "Администратор",
          email: "admin@example.test",
          role: "admin",
        },
      });
    if (path === "/categories") return reply(route, [category]);
    if (path === "/products")
      return reply(route, {
        items: [product],
        total: 1,
        page: Number(url.searchParams.get("page")) || 1,
      });
    if (path === "/reports/summary")
      return reply(route, {
        orders: { count: 3, totalKopecks: "9007199254740993" },
        deliveries: [{ status: "assigned", count: 2 }],
        note: "Учебные данные; реальные платежи отсутствуют",
      });
    throw new Error(`Неожиданный запрос: ${route.request().method()} ${path}`);
  });
  await page.goto("/workspace");
}
const products = (page: Page) => page.locator("#admin-products");
const categories = (page: Page) => page.locator("#admin-categories");
async function newProduct(page: Page) {
  await products(page)
    .getByRole("button", { name: "Товар", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Новый товар" });
  await dialog.getByLabel("Название", { exact: true }).fill("Новая позиция");
  await dialog.getByLabel("Адрес товара").fill("new-product");
  await dialog.getByLabel("Единица измерения").fill("мешок");
  return dialog;
}

test("Отчёт загружается независимо; его отказ не блокирует справочники", async ({
  page,
}) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await mock(page, async (route, path) => {
    if (path !== "/reports/summary") return;
    await gate;
    await reply(route, { message: "Отчёт недоступен" }, 503);
    return true;
  });
  await expect(
    products(page).getByText("Кирпич", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Загружаем сводку…")).toBeVisible();
  release();
  await expect(
    page.locator("#admin-overview").getByRole("alert"),
  ).toContainText("Отчёт недоступен");
  await expect(
    products(page).getByRole("button", { name: "Товар", exact: true }),
  ).toBeEnabled();
  await expect(
    categories(page).getByRole("button", { name: "Категория", exact: true }),
  ).toBeEnabled();
});

test("Ошибка обновления оставляет старый каталог readonly; повтор возвращает запись", async ({
  page,
}) => {
  let failed = false;
  await mock(page, async (route, path) => {
    if (path === "/products" && failed) {
      await reply(route, { message: "Каталог недоступен" }, 503);
      return true;
    }
  });
  await expect(
    products(page).getByRole("button", {
      name: "Изменить товар «Кирпич»",
      exact: true,
    }),
  ).toBeEnabled();
  failed = true;
  await products(page).getByRole("button", { name: "Обновить товары" }).click();
  await expect(products(page).getByRole("alert")).toContainText(
    "только для просмотра",
  );
  await expect(
    products(page).getByText("Кирпич", { exact: true }),
  ).toBeVisible();
  await expect(
    products(page).getByRole("button", { name: "Изменить" }),
  ).toBeDisabled();
  await expect(
    products(page).getByRole("button", { name: "Товар", exact: true }),
  ).toBeDisabled();
  failed = false;
  await products(page).getByRole("button", { name: "Повторить" }).click();
  await expect(
    products(page).getByRole("button", { name: "Изменить" }),
  ).toBeEnabled();
});

test("Отказ категорий блокирует запись товара, сохраняя данные и независимый отчёт", async ({
  page,
}) => {
  let failed = false;
  await mock(page, async (route, path) => {
    if (path === "/categories" && failed) {
      await reply(route, { message: "Категории недоступны" }, 503);
      return true;
    }
  });
  await expect(
    categories(page).getByRole("button", {
      name: "Изменить категорию «Материалы»",
      exact: true,
    }),
  ).toBeEnabled();
  failed = true;
  await categories(page)
    .getByRole("button", { name: "Обновить категории" })
    .click();
  await expect(categories(page).getByRole("alert")).toContainText(
    "только для просмотра",
  );
  await expect(
    categories(page).getByText("Материалы", { exact: true }),
  ).toBeVisible();
  await expect(
    products(page).getByRole("button", { name: "Изменить" }),
  ).toBeDisabled();
  await expect(
    page.getByText("Учебные данные; реальные платежи отсутствуют"),
  ).toBeVisible();
  failed = false;
  await categories(page).getByRole("button", { name: "Повторить" }).click();
  await expect(
    products(page).getByRole("button", { name: "Изменить" }),
  ).toBeEnabled();
});

test("Старый ответ поиска не заменяет новый", async ({ page }) => {
  let release!: () => void;
  let started!: () => void;
  const requested = new Promise<void>((resolve) => {
    started = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await mock(page, async (route, path, url) => {
    if (path !== "/products" || !url.searchParams.get("q")) return;
    const query = url.searchParams.get("q")!;
    if (query === "старый") {
      started();
      await gate;
    }
    await reply(route, {
      items: [{ ...product, name: query }],
      total: 1,
      page: 1,
    });
    return true;
  });
  await expect(
    products(page).getByText("Кирпич", { exact: true }),
  ).toBeVisible();
  await products(page)
    .getByLabel("Поиск по названию или описанию")
    .fill("старый");
  await products(page).getByRole("button", { name: "Найти" }).click();
  await requested;
  await products(page)
    .getByLabel("Поиск по названию или описанию")
    .fill("новый");
  await products(page).getByRole("button", { name: "Найти" }).click();
  await expect(products(page).locator(".admin-product-row")).toContainText(
    "новый",
  );
  const oldResponse = page.waitForResponse(
    (response) => new URL(response.url()).searchParams.get("q") === "старый",
  );
  release();
  await (await oldResponse).finished();
  await expect(products(page).locator(".admin-product-row")).toContainText(
    "новый",
  );
  await expect(products(page).locator(".admin-product-row")).not.toContainText(
    "старый",
  );
});

test("Новая выдача на первой странице заменяет незавершённую загрузку второй", async ({
  page,
}) => {
  let release!: () => void;
  let started!: () => void;
  const requested = new Promise<void>((resolve) => {
    started = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await mock(page, async (route, path, url) => {
    if (path !== "/products") return;
    if (url.searchParams.get("page") === "2") {
      started();
      await gate;
      await reply(route, {
        items: [{ ...product, name: "Вторая страница" }],
        total: 13,
        page: 2,
      });
    } else if (url.searchParams.get("q")) {
      await reply(route, {
        items: [{ ...product, name: "Найденный материал" }],
        total: 1,
        page: 1,
      });
    } else {
      await reply(route, {
        items: Array.from({ length: 12 }, (_, index) => ({
          ...product,
          id: `row-${index}`,
          name: `Материал ${index + 1}`,
        })),
        total: 13,
        page: 1,
      });
    }
    return true;
  });
  await expect(products(page).locator(".admin-product-row")).toHaveCount(12);
  await expect(products(page).getByText("Показано 1–12 из 13")).toBeVisible();
  await products(page).getByRole("button", { name: "Далее" }).click();
  await requested;
  await products(page)
    .getByLabel("Поиск по названию или описанию")
    .fill("материал");
  await products(page).getByRole("button", { name: "Найти" }).click();
  await expect(products(page).locator(".admin-product-row")).toHaveCount(1);
  await expect(products(page).locator(".admin-product-row")).toContainText(
    "Найденный материал",
  );
  const oldResponse = page.waitForResponse(
    (response) => new URL(response.url()).searchParams.get("page") === "2",
  );
  release();
  await (await oldResponse).finished();
  await expect(products(page).locator(".admin-product-row")).toHaveCount(1);
  await expect(products(page).locator(".admin-product-row")).toContainText(
    "Найденный материал",
  );
  await expect(
    products(page).getByText("Показано 1–1 из 1 по запросу «материал»"),
  ).toBeVisible();
  await expect(
    products(page).getByRole("button", { name: "Далее" }),
  ).toHaveCount(0);
});

test("Старая сводка сохраняет note при отказе; повтор показывает актуальные суммы", async ({
  page,
}) => {
  let failed = false;
  let count = 2;
  await mock(page, async (route, path) => {
    if (path !== "/reports/summary") return;
    if (failed)
      await reply(route, { message: "Сводка временно недоступна" }, 503);
    else
      await reply(route, {
        orders: { count, totalKopecks: "105" },
        deliveries: [],
        note: "Показатели учебных заказов",
      });
    return true;
  });
  const overview = page.locator("#admin-overview");
  await expect(overview.getByText("Показатели учебных заказов")).toBeVisible();
  failed = true;
  await overview.getByRole("button", { name: "Обновить обзор" }).click();
  await expect(overview.getByRole("alert")).toContainText(
    "актуальность не подтверждена",
  );
  await expect(overview.getByText("Показатели учебных заказов")).toBeVisible();
  await expect(overview.getByText("1,05 ₽", { exact: true })).toBeVisible();
  failed = false;
  count = 3;
  await overview.getByRole("button", { name: "Повторить" }).click();
  await expect(overview.getByRole("alert")).toHaveCount(0);
  await expect(overview.locator(".report-stats > div").first()).toContainText(
    "3",
  );
});

test("Ошибка записи сохраняет черновик; двойной submit отправляет один запрос", async ({
  page,
}) => {
  let writes = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await mock(page, async (route, path) => {
    if (path !== "/admin/products") return;
    writes++;
    await gate;
    await reply(route, { message: "Проверьте характеристики" }, 400);
    return true;
  });
  const dialog = await newProduct(page);
  await dialog
    .getByLabel("Описание", { exact: true })
    .fill("Сохранённый черновик");
  await dialog.locator("form").evaluate((form) => {
    form.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
    form.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
  });
  await expect.poll(() => writes).toBe(1);
  release();
  await expect(dialog.getByRole("alert")).toHaveText(
    "Проверьте характеристики",
  );
  await expect(dialog.getByLabel("Описание", { exact: true })).toHaveValue(
    "Сохранённый черновик",
  );
  await expect(
    dialog.getByRole("button", { name: "Сохранить товар" }),
  ).toBeEnabled();
  expect(writes).toBe(1);
});

test("Потерянный ответ создания перечитывает справочник без повтора и позволяет загрузить сохранённое", async ({
  page,
}) => {
  let writes = 0;
  let saved: Product | null = null;
  await mock(page, async (route, path) => {
    if (path === "/admin/products") {
      writes++;
      saved = { ...product, ...route.request().postDataJSON(), id: "created" };
      await route.abort("failed");
      return true;
    }
    if (path === "/products" && saved) {
      await reply(route, { items: [saved], total: 1, page: 1 });
      return true;
    }
  });
  const dialog = await newProduct(page);
  await dialog.getByLabel("Описание", { exact: true }).fill("Мой черновик");
  await dialog.getByRole("button", { name: "Сохранить товар" }).click();
  await expect(
    dialog.getByText("Сохранение не подтверждено", { exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Сохранить товар" }),
  ).toBeDisabled();
  await expect(dialog.getByLabel("Описание", { exact: true })).toHaveValue(
    "Мой черновик",
  );
  await expect(
    dialog.getByRole("button", { name: "Загрузить сохранённое" }),
  ).toBeEnabled();
  await dialog.getByRole("button", { name: "Загрузить сохранённое" }).click();
  await expect(
    page.getByRole("dialog", { name: "Изменить товар" }),
  ).toBeVisible();
  await expect(
    page.getByRole("status").filter({ hasText: "Товар добавлен." }),
  ).toHaveCount(0);
  expect(writes).toBe(1);
});

test("Создание и редактирование категории используют реальные сохранённые поля", async ({
  page,
}) => {
  let rows = [category];
  const writes: Array<{ method: string; body: unknown }> = [];
  await mock(page, async (route, path) => {
    if (path === "/categories") {
      await reply(route, rows);
      return true;
    }
    if (!path.startsWith("/admin/categories")) return;
    const body = route.request().postDataJSON() as {
      name: string;
      slug: string;
    };
    const method = route.request().method();
    writes.push({ method, body });
    if (method === "POST") rows.push({ id: "new-category", ...body });
    else
      rows = rows.map((row) =>
        row.id === "new-category" ? { ...row, ...body } : row,
      );
    await reply(route, { id: "new-category", ...body });
    return true;
  });
  await categories(page)
    .getByRole("button", { name: "Категория", exact: true })
    .click();
  let dialog = page.getByRole("dialog", { name: "Новая категория" });
  await dialog.getByLabel("Название").fill("Отделочные материалы");
  await dialog.getByLabel("Адрес категории").fill("finish");
  await dialog.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(dialog).toBeHidden();
  const row = categories(page)
    .locator(".admin-category-row")
    .filter({ hasText: "Отделочные материалы" });
  await row.getByRole("button", { name: "Изменить" }).click();
  dialog = page.getByRole("dialog", { name: "Изменить категорию" });
  await expect(dialog.getByLabel("Адрес категории")).toHaveValue("finish");
  await dialog.getByLabel("Название").fill("Отделка");
  await dialog.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(
    categories(page).getByText("Отделка", { exact: true }),
  ).toBeVisible();
  expect(writes).toEqual([
    { method: "POST", body: { name: "Отделочные материалы", slug: "finish" } },
    { method: "PATCH", body: { name: "Отделка", slug: "finish" } },
  ]);
});

for (const theme of ["light", "dark"])
  test(`Кабинет и форма на 360 px: ${theme}, Escape возвращает фокус`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.addInitScript(
      (value) => localStorage.setItem("objectmarket-theme", value),
      theme,
    );
    await mock(page);
    await page.evaluate((value) => {
      document.documentElement.dataset.theme = value;
    }, theme);
    await expect(
      page.getByText("Учебные данные; реальные платежи отсутствуют"),
    ).toBeVisible();
    await expect(
      page.getByText("Стоимость всех заказов", { exact: true }),
    ).toBeVisible();
    await expect(page.locator(".report-statuses > div")).toHaveCount(5);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const trigger = products(page).getByRole("button", {
      name: "Товар",
      exact: true,
    });
    await trigger.click();
    const dialog = page.getByRole("dialog", { name: "Новый товар" });
    const box = await dialog.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(360);
    expect(
      await dialog.evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    ).toBe(true);
    await expect(dialog.getByLabel("Название", { exact: true })).toBeFocused();
    await dialog
      .getByRole("button", { name: "Сохранить товар" })
      .scrollIntoViewIfNeeded();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
    await products(page)
      .locator(".admin-product-row")
      .getByRole("button", { name: "Изменить" })
      .click();
    const editor = page.getByRole("dialog", { name: "Изменить товар" });
    const explanations = editor.locator(".form-info").filter({
      hasText: /Фасовка:|Единица продажи и фасовка сохраняются/,
    });
    await expect(explanations).toHaveCount(2);
    const contrasts = await explanations.evaluateAll((elements) => {
      const luminance = (color: string) => {
        const channels = color
          .match(/[\d.]+/g)!
          .slice(0, 3)
          .map(Number)
          .map((channel) => {
            const normalized = channel / 255;
            return normalized <= 0.04045
              ? normalized / 12.92
              : ((normalized + 0.055) / 1.055) ** 2.4;
          });
        return (
          channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
        );
      };
      return elements.map((element) => {
        const style = getComputedStyle(element);
        const foreground = luminance(style.color);
        const background = luminance(style.backgroundColor);
        return (
          (Math.max(foreground, background) + 0.05) /
          (Math.min(foreground, background) + 0.05)
        );
      });
    });
    for (const contrast of contrasts)
      expect(contrast).toBeGreaterThanOrEqual(4.5);
    await page.keyboard.press("Escape");
    await expect(editor).toBeHidden();
  });
