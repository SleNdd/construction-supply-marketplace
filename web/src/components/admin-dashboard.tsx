"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Plus, RefreshCw } from "lucide-react";
import {
  api,
  type Category,
  type Product,
  type ProductPackaging,
  money,
} from "@/lib/api";
import { packagingLabel } from "@/lib/packaging";
import { ErrorPanel } from "./marketplace";
import { Status } from "./orders";
import { useDialogFocus } from "@/lib/use-dialog-focus";
import styles from "./admin-dashboard.module.css";

type Summary = {
  orders: { count: number; totalKopecks: string | number };
  deliveries: Array<{ status: string; count: number }>;
  note: string;
};
type ProductDraft = {
  name: string;
  slug: string;
  categoryId: string;
  unit: string;
  imageUrl: string;
  description: string;
  specs: string;
  packagingKind: ProductPackaging["kind"] | "";
  tileAreaM2: string;
  tilesPerPack: string;
  packSize: string;
};
const packagingUnits: Record<ProductPackaging["kind"], string> = {
  tiles: "коробка",
  paint: "ведро",
  "dry-mix": "мешок",
};
const packagingSummary = (packaging: ProductPackaging | null | undefined) =>
  packaging ? packagingLabel(packaging) : "Фасовка не задана";

type Section<T> = { data: T | null; loading: boolean; error: string };
// Номер запроса не даёт применить старый ответ; ошибка сохраняет проверенные данные.
function useSection<T>(path: string) {
  const [state, setState] = useState<Section<T>>({
    data: null,
    loading: true,
    error: "",
  });
  const request = useRef(0);
  const readonly = useRef(true);
  const invalidate = useCallback(() => {
    request.current++;
    readonly.current = true;
  }, []);
  const load = useCallback(async () => {
    const sequence = ++request.current;
    readonly.current = true;
    setState((previous) => ({ ...previous, loading: true, error: "" }));
    try {
      const data = await api<T>(path);
      if (sequence !== request.current) return null;
      readonly.current = false;
      setState({ data, loading: false, error: "" });
      return data;
    } catch (issue) {
      if (sequence === request.current)
        setState((previous) => ({
          ...previous,
          loading: false,
          error: (issue as Error).message,
        }));
      return null;
    }
  }, [path]);
  useEffect(() => {
    void load();
    return invalidate;
  }, [load, invalidate]);
  return { ...state, load, readonly, invalidate };
}
class SaveFailure extends Error {
  constructor(
    message: string,
    public uncertain: boolean,
  ) {
    super(message);
  }
}
async function write(
  path: string,
  method: string,
  body: Record<string, unknown>,
) {
  let response: Response;
  try {
    response = await fetch(`/api/v1${path}`, {
      method,
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new SaveFailure("Ответ сервера не получен.", true);
  }
  if (!response.ok) {
    let message = `Ошибка запроса (${response.status})`;
    try {
      message = (await response.json()).message || message;
    } catch {
      /* Если тело ответа не читается, исход определяет HTTP-статус. */
    }
    throw new SaveFailure(
      message,
      response.status >= 500 || response.status === 408,
    );
  }
}
type ProductPage = { items: Product[]; total: number; page: number };
type Recovery = {
  kind: "category" | "product";
  id?: string;
  name: string;
  slug: string;
  saved?: Category | Product;
  checked: boolean;
  error: string;
};

export function AdminDashboard() {
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const limit = 12;
  const report = useSection<Summary>("/reports/summary");
  const categorySection = useSection<Category[]>("/categories");
  const productSection = useSection<ProductPage>(
    `/products?limit=${limit}&page=${page}&q=${encodeURIComponent(search)}`,
  );
  const summary = report.data;
  const categories = categorySection.data || [];
  const products = productSection.data?.items || [];
  const total = productSection.data?.total || 0;
  const displayedPage = productSection.data?.page || 1;
  const [error, setError] = useState("");
  const [recovery, setRecovery] = useState<Recovery | null>(null);
  const locked = useRef(false);
  const [notice, setNotice] = useState("");
  const [categoryEdit, setCategoryEdit] = useState<Category | null | undefined>(
    undefined,
  );
  const [categoryDraft, setCategoryDraft] = useState({ name: "", slug: "" });
  const [productEdit, setProductEdit] = useState<Product | null | undefined>(
    undefined,
  );
  const [productDraft, setProductDraft] = useState<ProductDraft>({
    name: "",
    slug: "",
    categoryId: "",
    unit: "",
    imageUrl: "",
    description: "",
    specs: "{}",
    packagingKind: "",
    tileAreaM2: "",
    tilesPerPack: "",
    packSize: "",
  });
  const [busy, setBusy] = useState(false);
  const closeCategory = () => {
    if (!locked.current) {
      setCategoryEdit(undefined);
      setRecovery(null);
    }
  };
  const closeProduct = () => {
    if (!locked.current) {
      setProductEdit(undefined);
      setRecovery(null);
    }
  };
  const categoryDialogRef = useDialogFocus(
    categoryEdit !== undefined,
    closeCategory,
  );
  const productDialogRef = useDialogFocus(
    productEdit !== undefined,
    closeProduct,
  );
  const categoryReadonly = categorySection.loading || !!categorySection.error;
  const productReadonly =
    productSection.loading ||
    !!productSection.error ||
    categoryReadonly ||
    !categories.length;
  const checkSaved = async (pending: Recovery, fromSave = false) => {
    if (locked.current && !fromSave) return;
    locked.current = true;
    setBusy(true);
    try {
      const rows =
        pending.kind === "category"
          ? await categorySection.load()
          : pending.id
            ? [await api<Product>(`/products/${pending.id}`)]
            : (
                await api<ProductPage>(
                  `/products?limit=100&page=1&q=${encodeURIComponent(pending.name)}`,
                )
              ).items;
      if (!rows) throw new Error("Не удалось перечитать справочник.");
      const saved = rows.find((row) =>
        pending.id ? row.id === pending.id : row.slug === pending.slug,
      );
      setRecovery({ ...pending, saved, checked: true, error: "" });
    } catch (issue) {
      setRecovery({
        ...pending,
        checked: false,
        error: (issue as Error).message,
      });
    } finally {
      if (pending.kind === "product") await productSection.load();
      locked.current = false;
      setBusy(false);
    }
  };
  const failedSave = async (issue: unknown, pending: Recovery) => {
    setError((issue as Error).message);
    if (!(issue instanceof SaveFailure) || issue.uncertain) {
      setRecovery(pending);
      await checkSaved(pending, true);
    }
  };

  const saveCategory = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (locked.current || recovery || categorySection.readonly.current) return;
    const name = categoryDraft.name.trim();
    const slug = categoryDraft.slug.trim();
    if (!name || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
      setError(
        "Укажите название и адрес категории латиницей, цифрами и дефисами.",
      );
      return;
    }
    locked.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await write(
        categoryEdit
          ? `/admin/categories/${categoryEdit.id}`
          : "/admin/categories",
        categoryEdit ? "PATCH" : "POST",
        { name, slug },
      );
      setCategoryEdit(undefined);
      setNotice(categoryEdit ? "Категория обновлена." : "Категория добавлена.");
      await categorySection.load();
      void productSection.load();
    } catch (issue) {
      await failedSave(issue, {
        kind: "category",
        id: categoryEdit?.id,
        name,
        slug,
        checked: false,
        error: "",
      });
    } finally {
      locked.current = false;
      setBusy(false);
    }
  };

  const saveProduct = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (
      locked.current ||
      recovery ||
      productSection.readonly.current ||
      categorySection.readonly.current ||
      !categories.some((category) => category.id === productDraft.categoryId)
    )
      return;
    const name = productDraft.name.trim();
    const slug = productDraft.slug.trim();
    const unit = productDraft.unit.trim();
    const imageUrl = productDraft.imageUrl.trim();
    if (
      !name ||
      !unit ||
      !productDraft.categoryId ||
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)
    ) {
      setError(
        "Заполните название, категорию, единицу измерения и адрес товара латиницей.",
      );
      return;
    }
    if (
      imageUrl &&
      !imageUrl.startsWith("https://") &&
      !imageUrl.startsWith("/images/")
    ) {
      setError("Для изображения укажите HTTPS адрес или путь /images/.");
      return;
    }
    let specs: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(productDraft.specs || "{}");
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
        throw new Error();
      specs = parsed as Record<string, unknown>;
    } catch {
      setError(
        'Характеристики должны быть объектом JSON, например {"прочность":"М150"}.',
      );
      return;
    }
    let packaging: ProductPackaging | null = null;
    if (!productEdit && productDraft.packagingKind) {
      const kind = productDraft.packagingKind;
      const size = Number(
        kind === "tiles" ? productDraft.tileAreaM2 : productDraft.packSize,
      );
      const tiles = Number(productDraft.tilesPerPack);
      if (
        !Number.isFinite(size) ||
        size <= 0 ||
        (kind === "tiles" && (!Number.isSafeInteger(tiles) || tiles <= 0))
      ) {
        setError(
          "Укажите положительный размер фасовки; число плиток в коробке должно быть целым и положительным.",
        );
        return;
      }
      if (unit !== packagingUnits[kind]) {
        setError(
          `Для выбранной фасовки единица продажи — ${packagingUnits[kind]}.`,
        );
        return;
      }
      packaging =
        kind === "tiles"
          ? { kind, tileAreaM2: size, tilesPerPack: tiles }
          : kind === "paint"
            ? { kind, packSizeL: size }
            : { kind, packSizeKg: size };
    }
    locked.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await write(
        productEdit ? `/admin/products/${productEdit.id}` : "/admin/products",
        productEdit ? "PATCH" : "POST",
        {
          name,
          slug,
          categoryId: productDraft.categoryId,
          imageUrl: imageUrl || null,
          description: productDraft.description.trim(),
          specs,
          ...(!productEdit ? { unit, packaging } : {}),
        },
      );
      setProductEdit(undefined);
      setNotice(productEdit ? "Товар обновлён." : "Товар добавлен.");
      await productSection.load();
    } catch (issue) {
      await failedSave(issue, {
        kind: "product",
        id: productEdit?.id,
        name,
        slug,
        checked: false,
        error: "",
      });
    } finally {
      locked.current = false;
      setBusy(false);
    }
  };

  const openCategory = (category: Category | null) => {
    if (locked.current || categorySection.readonly.current) return;
    setRecovery(null);
    setProductEdit(undefined);
    setError("");
    setNotice("");
    setCategoryEdit(category);
    setCategoryDraft(
      category
        ? { name: category.name, slug: category.slug }
        : { name: "", slug: "" },
    );
  };
  const openProduct = (product: Product | null) => {
    if (
      locked.current ||
      productSection.readonly.current ||
      categorySection.readonly.current ||
      !categories.length
    )
      return;
    setRecovery(null);
    setCategoryEdit(undefined);
    setError("");
    setNotice("");
    setProductEdit(product);
    const categoryName = product
      ? typeof product.category === "string"
        ? product.category
        : product.category?.name || ""
      : "";
    setProductDraft({
      name: product?.name || "",
      slug: product?.slug || "",
      categoryId: product
        ? product.categoryId ||
          categories.find((category) => category.name === categoryName)?.id ||
          ""
        : categories[0]?.id || "",
      unit: product?.unit || "",
      imageUrl: product?.imageUrl || "",
      description: product?.description || "",
      specs: JSON.stringify(product?.specs || {}, null, 2),
      packagingKind: "",
      tileAreaM2: "",
      tilesPerPack: "",
      packSize: "",
    });
  };

  const recoveryPanel = recovery && (
    <div className={styles.recovery} role="status">
      <b>Сохранение не подтверждено</b>
      <p>
        Ответ мог потеряться после записи. Черновик сохранён. Повторная отправка
        заблокирована: проверьте справочник или закройте форму.
      </p>
      {recovery.error && <p role="alert">{recovery.error}</p>}
      {recovery.checked && (
        <p>
          {recovery.saved
            ? `Найдена запись «${recovery.saved.name}». Сверьте сохранённые поля, загрузив запись в форму.`
            : "Запись не найдена при проверке. Это не подтверждает отмену запроса. Закройте форму и проверьте справочник перед новой записью."}
        </p>
      )}
      <div className={styles.actions}>
        <button
          type="button"
          className="btn btn-outline"
          disabled={busy}
          onClick={() => void checkSaved(recovery)}
        >
          Проверить справочник
        </button>
        {recovery.saved && (
          <button
            type="button"
            className="btn btn-outline"
            disabled={
              busy ||
              (recovery.kind === "category"
                ? categoryReadonly
                : productReadonly)
            }
            onClick={() => {
              const saved = recovery.saved!;
              if (recovery.kind === "category") openCategory(saved as Category);
              else openProduct(saved as Product);
            }}
          >
            Загрузить сохранённое
          </button>
        )}
        <button
          type="button"
          className="btn btn-outline"
          disabled={busy}
          onClick={recovery.kind === "category" ? closeCategory : closeProduct}
        >
          Закрыть форму
        </button>
      </div>
    </div>
  );
  return (
    <div className={`admin-dashboard ${styles.workspace}`}>
      <nav className={styles.navigation} aria-label="Разделы администратора">
        <a href="#admin-overview">Обзор</a>
        <a href="#admin-products">Товары</a>
        <a href="#admin-categories">Категории</a>
      </nav>
      {notice && (
        <p className="form-info" role="status">
          {notice}
        </p>
      )}
      <section
        id="admin-overview"
        className={`workspace-panel ${styles.panel}`}
        aria-labelledby="admin-overview-title"
      >
        <div className="panel-heading">
          <div>
            <span className="overline">АДМИНИСТРАТОР / ОБЗОР</span>
            <h2 id="admin-overview-title">Сводка системы</h2>
            <p className="muted">Заказы и поставки во всей системе</p>
          </div>
          <button
            className="btn btn-outline"
            disabled={report.loading}
            onClick={() => void report.load()}
          >
            <RefreshCw size={15} /> Обновить обзор
          </button>
        </div>
        {report.error && (
          <div role="alert">
            <ErrorPanel
              message={`${report.error}${summary ? " Показана предыдущая сводка; актуальность не подтверждена." : ""}`}
              onRetry={report.load}
            />
          </div>
        )}
        {report.loading && <p role="status">Загружаем сводку…</p>}
        {summary && (
          <>
            <div className="report-stats">
              <div>
                <span>Заказов</span>
                <b>{summary.orders.count}</b>
                <small>Во всех статусах</small>
              </div>
              <div>
                <span>Стоимость всех заказов</span>
                <b>{money(summary.orders.totalKopecks)}</b>
                <small>Все статусы · товары и доставка</small>
              </div>
              <div>
                <span>Поставок</span>
                <b>
                  {summary.deliveries.reduce(
                    (sum, item) => sum + item.count,
                    0,
                  )}
                </b>
                <small>По всем статусам</small>
              </div>
            </div>
            <p className={styles.note}>{summary.note}</p>
            <h3>Статусы поставок</h3>
            <div className="report-statuses">
              {Array.from(
                new Set([
                  "pending",
                  "assigned",
                  "picked_up",
                  "in_transit",
                  "delivered",
                  ...summary.deliveries.map((item) => item.status),
                ]),
              ).map((status) => (
                <div key={status}>
                  <Status status={status} />
                  <b>
                    {summary.deliveries.find((item) => item.status === status)
                      ?.count || 0}
                  </b>
                </div>
              ))}
            </div>
          </>
        )}
      </section>
      <section
        id="admin-categories"
        className={`workspace-panel admin-section ${styles.panel}`}
        aria-labelledby="admin-categories-title"
      >
        <div className="panel-heading">
          <div>
            <span className="overline">СПРАВОЧНИК</span>
            <h2 id="admin-categories-title">
              Категории <small>({categories.length})</small>
            </h2>
          </div>
          <div className={styles.actions}>
            <button
              className="btn btn-outline"
              disabled={categorySection.loading || busy}
              onClick={() => void categorySection.load()}
            >
              <RefreshCw size={15} /> Обновить категории
            </button>
            <button
              className="btn btn-dark"
              disabled={categoryReadonly || busy}
              onClick={() => openCategory(null)}
            >
              <Plus size={16} /> Категория
            </button>
          </div>
        </div>
        {categorySection.loading && <p role="status">Загружаем категории…</p>}
        {categorySection.error && (
          <div role="alert">
            <ErrorPanel
              message={`${categorySection.error} Категории доступны только для просмотра до успешного обновления.`}
              onRetry={categorySection.load}
            />
          </div>
        )}
        {!categorySection.loading &&
          !categorySection.error &&
          !categories.length && (
            <p className="empty-state">
              Категорий пока нет. Добавьте категорию перед созданием товара.
            </p>
          )}
        <div className="admin-category-list">
          {categories.map((category) => (
            <div className="admin-category-row" key={category.id}>
              <div>
                <b>{category.name}</b>
                <small>/catalog?category={category.slug}</small>
              </div>
              <button
                className="btn btn-outline"
                disabled={categoryReadonly || busy}
                aria-label={`Изменить категорию «${category.name}»`}
                onClick={() => openCategory(category)}
              >
                Изменить
              </button>
            </div>
          ))}
        </div>
      </section>
      <section
        id="admin-products"
        className={`workspace-panel admin-section ${styles.panel}`}
        aria-labelledby="admin-products-title"
      >
        <div className="panel-heading">
          <div>
            <span className="overline">СПРАВОЧНИК</span>
            <h2 id="admin-products-title">
              Товары <small>({total})</small>
            </h2>
          </div>
          <div className={styles.actions}>
            <button
              className="btn btn-outline"
              disabled={productSection.loading || busy}
              onClick={() => void productSection.load()}
            >
              <RefreshCw size={15} /> Обновить товары
            </button>
            <button
              className="btn btn-dark"
              disabled={productReadonly || busy}
              onClick={() => openProduct(null)}
            >
              <Plus size={16} /> Товар
            </button>
          </div>
        </div>
        <form
          className="admin-search"
          onSubmit={(event) => {
            event.preventDefault();
            productSection.invalidate();
            setPage(1);
            if (search === query.trim() && page === 1)
              void productSection.load();
            else setSearch(query.trim());
          }}
        >
          <label htmlFor="admin-product-search">
            Поиск по названию или описанию
          </label>
          <div>
            <input
              id="admin-product-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Например, кирпич"
            />
            <button className="btn btn-outline" type="submit">
              Найти
            </button>
          </div>
        </form>
        {productSection.loading && <p role="status">Загружаем товары…</p>}
        {productSection.error && (
          <div role="alert">
            <ErrorPanel
              message={`${productSection.error} Показанные товары доступны только для просмотра до успешного обновления.`}
              onRetry={productSection.load}
            />
          </div>
        )}
        {(categoryReadonly || !categories.length) && (
          <p className="form-info">
            Для записи товара нужен актуальный справочник категорий. Обновите
            категории или добавьте первую категорию.
          </p>
        )}
        {!productSection.loading && !productSection.error && (
          <p className="muted">
            {total
              ? `Показано ${(page - 1) * limit + 1}–${Math.min(page * limit, total)} из ${total}${search ? ` по запросу «${search}»` : ""}`
              : "Нет подходящих товаров"}
          </p>
        )}
        {products.length ? (
          <div className="admin-product-list">
            {products.map((product) => (
              <div className="admin-product-row" key={product.id}>
                <div>
                  <b>{product.name}</b>
                  <small>
                    {typeof product.category === "string"
                      ? product.category
                      : product.category.name}{" "}
                    · {product.unit} ·{" "}
                    {product.priceFromKopecks !== null
                      ? money(product.priceFromKopecks)
                      : "Без предложений"}
                  </small>
                  <small>{packagingSummary(product.packaging)}</small>
                </div>
                <button
                  className="btn btn-outline"
                  disabled={productReadonly || busy}
                  aria-label={`Изменить товар «${product.name}»`}
                  onClick={() => openProduct(product)}
                >
                  Изменить
                </button>
              </div>
            ))}
          </div>
        ) : (
          !productSection.loading &&
          !productSection.error && (
            <div className="empty-state">Товары не найдены.</div>
          )
        )}
        {total > limit && (
          <div className="admin-pagination">
            <button
              className="btn btn-outline"
              disabled={
                page === 1 || productSection.loading || !!productSection.error
              }
              onClick={() => {
                productSection.invalidate();
                setPage(page - 1);
              }}
            >
              Назад
            </button>
            <span>
              Страница {displayedPage} из {Math.ceil(total / limit)}
            </span>
            <button
              className="btn btn-outline"
              disabled={
                page >= Math.ceil(total / limit) ||
                productSection.loading ||
                !!productSection.error
              }
              onClick={() => {
                productSection.invalidate();
                setPage(page + 1);
              }}
            >
              Далее
            </button>
          </div>
        )}
      </section>
      {categoryEdit !== undefined && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeCategory();
          }}
        >
          <div
            ref={categoryDialogRef}
            tabIndex={-1}
            className={`auth-modal wide-modal ${styles.dialog}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="admin-category-title"
          >
            <button
              className="icon-button modal-close"
              aria-label="Закрыть"
              disabled={busy}
              onClick={closeCategory}
            >
              ×
            </button>
            <span className="overline">СПРАВОЧНИК</span>
            <h2 id="admin-category-title">
              {categoryEdit ? "Изменить категорию" : "Новая категория"}
            </h2>
            <form className="form-stack" onSubmit={saveCategory}>
              <fieldset
                disabled={busy || categoryReadonly || !!recovery}
                className={styles.fields}
              >
                <label>
                  Название
                  <input
                    required
                    maxLength={100}
                    value={categoryDraft.name}
                    onChange={(event) =>
                      setCategoryDraft({
                        ...categoryDraft,
                        name: event.target.value,
                      })
                    }
                  />
                </label>
                <label>
                  Адрес категории
                  <input
                    required
                    maxLength={100}
                    pattern="[a-z0-9]+(-[a-z0-9]+)*"
                    value={categoryDraft.slug}
                    onChange={(event) =>
                      setCategoryDraft({
                        ...categoryDraft,
                        slug: event.target.value,
                      })
                    }
                    placeholder="suhie-smesi"
                  />
                </label>
                <p className="form-info">
                  Латинские буквы, цифры и дефисы. Этот адрес используется в
                  каталоге.
                </p>
                {error && (
                  <p className="form-error" role="alert">
                    {error}
                  </p>
                )}
                <button className="btn btn-dark" disabled={busy} type="submit">
                  {busy ? "Сохраняем…" : "Сохранить"}
                </button>
              </fieldset>
              {recoveryPanel}
            </form>
          </div>
        </div>
      )}
      {productEdit !== undefined && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeProduct();
          }}
        >
          <div
            ref={productDialogRef}
            tabIndex={-1}
            className={`auth-modal wide-modal ${styles.dialog}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="admin-product-title"
          >
            <button
              className="icon-button modal-close"
              aria-label="Закрыть"
              disabled={busy}
              onClick={closeProduct}
            >
              ×
            </button>
            <span className="overline">КАТАЛОГ</span>
            <h2 id="admin-product-title">
              {productEdit ? "Изменить товар" : "Новый товар"}
            </h2>
            <form
              className="form-stack admin-product-form"
              onSubmit={saveProduct}
            >
              <fieldset
                disabled={busy || productReadonly || !!recovery}
                className={styles.fields}
              >
                <label>
                  Название
                  <input
                    required
                    maxLength={200}
                    value={productDraft.name}
                    onChange={(event) =>
                      setProductDraft({
                        ...productDraft,
                        name: event.target.value,
                      })
                    }
                  />
                </label>
                <div className="admin-form-grid">
                  <label>
                    Категория
                    <select
                      required
                      value={productDraft.categoryId}
                      onChange={(event) =>
                        setProductDraft({
                          ...productDraft,
                          categoryId: event.target.value,
                        })
                      }
                    >
                      <option value="">Выберите категорию</option>
                      {categories.map((category) => (
                        <option key={category.id} value={category.id}>
                          {category.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Единица измерения
                    <input
                      required
                      readOnly={!!productEdit || !!productDraft.packagingKind}
                      maxLength={30}
                      value={productDraft.unit}
                      onChange={(event) =>
                        setProductDraft({
                          ...productDraft,
                          unit: event.target.value,
                        })
                      }
                      placeholder="мешок"
                    />
                  </label>
                </div>
                {productEdit ? (
                  <>
                    <p className="form-info">
                      Фасовка: {packagingSummary(productEdit.packaging)}
                    </p>
                    <p className="form-info">
                      Единица продажи и фасовка сохраняются. Для другой фасовки
                      создайте новый товар.
                    </p>
                  </>
                ) : (
                  <>
                    <label htmlFor="admin-product-packaging">Фасовка</label>
                    <select
                      id="admin-product-packaging"
                      value={productDraft.packagingKind}
                      onChange={(event) => {
                        const kind = event.target
                          .value as ProductDraft["packagingKind"];
                        setProductDraft({
                          ...productDraft,
                          packagingKind: kind,
                          unit: kind ? packagingUnits[kind] : productDraft.unit,
                        });
                      }}
                    >
                      <option value="">Не задана</option>
                      <option value="tiles">Плитка в коробках</option>
                      <option value="paint">Краска в вёдрах</option>
                      <option value="dry-mix">Сухая смесь в мешках</option>
                    </select>
                    {productDraft.packagingKind === "tiles" ? (
                      <div className="admin-form-grid">
                        <label htmlFor="admin-product-tile-area">
                          Площадь одной плитки, м²
                          <input
                            id="admin-product-tile-area"
                            required
                            type="number"
                            min="0"
                            step="any"
                            value={productDraft.tileAreaM2}
                            onChange={(event) =>
                              setProductDraft({
                                ...productDraft,
                                tileAreaM2: event.target.value,
                              })
                            }
                          />
                        </label>
                        <label htmlFor="admin-product-tile-count">
                          Плиток в коробке
                          <input
                            id="admin-product-tile-count"
                            required
                            type="number"
                            min="1"
                            step="1"
                            value={productDraft.tilesPerPack}
                            onChange={(event) =>
                              setProductDraft({
                                ...productDraft,
                                tilesPerPack: event.target.value,
                              })
                            }
                          />
                        </label>
                      </div>
                    ) : (
                      productDraft.packagingKind && (
                        <label htmlFor="admin-product-pack-size">
                          {productDraft.packagingKind === "paint"
                            ? "Объём ведра, л"
                            : "Масса мешка, кг"}
                          <input
                            id="admin-product-pack-size"
                            required
                            type="number"
                            min="0"
                            step="any"
                            value={productDraft.packSize}
                            onChange={(event) =>
                              setProductDraft({
                                ...productDraft,
                                packSize: event.target.value,
                              })
                            }
                          />
                        </label>
                      )
                    )}
                    <p className="form-info">
                      Фасовка задаётся при создании товара и используется для
                      расчёта потребности. Характеристики ниже — только
                      описание.
                    </p>
                  </>
                )}
                <label>
                  Адрес товара
                  <input
                    required
                    maxLength={100}
                    pattern="[a-z0-9]+(-[a-z0-9]+)*"
                    value={productDraft.slug}
                    onChange={(event) =>
                      setProductDraft({
                        ...productDraft,
                        slug: event.target.value,
                      })
                    }
                    placeholder="cement-m500"
                  />
                </label>
                <label htmlFor="admin-product-description">Описание</label>
                <textarea
                  id="admin-product-description"
                  maxLength={2000}
                  rows={3}
                  value={productDraft.description}
                  onChange={(event) =>
                    setProductDraft({
                      ...productDraft,
                      description: event.target.value,
                    })
                  }
                />
                <label>
                  Изображение (необязательно)
                  <input
                    value={productDraft.imageUrl}
                    onChange={(event) =>
                      setProductDraft({
                        ...productDraft,
                        imageUrl: event.target.value,
                      })
                    }
                    placeholder="https://... или /images/..."
                  />
                </label>
                <label htmlFor="admin-product-specs">
                  Характеристики, JSON
                </label>
                <textarea
                  id="admin-product-specs"
                  rows={4}
                  value={productDraft.specs}
                  onChange={(event) =>
                    setProductDraft({
                      ...productDraft,
                      specs: event.target.value,
                    })
                  }
                  spellCheck={false}
                />
                <p className="form-info">
                  Пример: {'{"марка":"М500","вес":50}'}. Если характеристик нет,
                  оставьте пустой объект {"{}"}.
                </p>
                {error && (
                  <p className="form-error" role="alert">
                    {error}
                  </p>
                )}
                <button
                  className="btn btn-dark"
                  disabled={
                    busy ||
                    !categories.some(
                      (category) => category.id === productDraft.categoryId,
                    )
                  }
                  type="submit"
                >
                  {busy ? "Сохраняем…" : "Сохранить товар"}
                </button>
              </fieldset>
              {recoveryPanel}
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
