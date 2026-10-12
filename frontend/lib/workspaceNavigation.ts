export type WorkspacePortal = "shop" | "leasing";
export type WorkspaceLink = {
  href: string;
  label: string;
  group: string;
  icon: string;
  keywords: string;
  staff?: boolean;
};

const SHOP: WorkspaceLink[] = [
  { href: "/workspace/shop/today", label: "Өнөөдрийн ажил", group: "Ажлын урсгал", icon: "today", keywords: "today unuudur ajil", staff: true },
  { href: "/workspace/shop", label: "Захиалга", group: "Ажлын урсгал", icon: "orders", keywords: "zahialga order code kod utas", staff: true },
  { href: "/workspace/shop/orders/new", label: "Захиалга оруулах", group: "Ажлын урсгал", icon: "add", keywords: "shine zahialga new" },
  { href: "/workspace/shop/orders/by-product", label: "Бараагаар", group: "Ажлын урсгал", icon: "list", keywords: "baraagaar product", staff: true },
  { href: "/workspace/shop/handover", label: "Хүлээлгэн өгөх", group: "Ажлын урсгал", icon: "handover", keywords: "olgolт huleelgen uguh handover qr", staff: true },
  { href: "/workspace/shop/deliveries", label: "Хүргэлт", group: "Ажлын урсгал", icon: "truck", keywords: "hur gelt delivery driver", staff: true },
  { href: "/workspace/shop/returns", label: "Буцаалт", group: "Ажлын урсгал", icon: "return", keywords: "butsaalt refund", staff: true },
  { href: "/workspace/shop/batches", label: "Ачааны багц", group: "Бараа ба агуулах", icon: "batch", keywords: "achaa bagts cargo" },
  { href: "/workspace/shop/products", label: "Бараа", group: "Бараа ба агуулах", icon: "products", keywords: "baraa product catalog" },
  { href: "/workspace/shop/preorders", label: "Урьдчилсан захиалга", group: "Бараа ба агуулах", icon: "calendar", keywords: "uridchilsan preorder" },
  { href: "/workspace/shop/ready", label: "Бэлэн бараа", group: "Бараа ба агуулах", icon: "stock", keywords: "belen stock aguu lah" },
  { href: "/workspace/shop/categories", label: "Ангилал", group: "Бараа ба агуулах", icon: "category", keywords: "angilal category" },
  { href: "/workspace/shop/customers", label: "Хэрэглэгчид", group: "Удирдлага", icon: "customers", keywords: "hereglegch hariltsagch customer phone", staff: true },
  { href: "/workspace/shop/reports", label: "Тайлан", group: "Удирдлага", icon: "reports", keywords: "tailan report borluulalt" },
  { href: "/workspace/shop/leasing-settlements", label: "Лизингийн тооцоо", group: "Удирдлага", icon: "money", keywords: "leasing lizing tootsoo tulbur" },
  { href: "/workspace/shop/archive", label: "Архив", group: "Удирдлага", icon: "archive", keywords: "archive arhiv" },
  { href: "/workspace/shop/storefront", label: "Дэлгүүрийн нүүр", group: "Удирдлага", icon: "store", keywords: "delguur storefront" },
  { href: "/workspace/shop/ads", label: "Зар", group: "Удирдлага", icon: "ads", keywords: "zar ads banner" },
  { href: "/workspace/shop/settings", label: "Тохиргоо", group: "Удирдлага", icon: "settings", keywords: "tohirgoo settings" },
  { href: "/workspace/shop/account", label: "Нэвтрэх утас", group: "Удирдлага", icon: "account", keywords: "nevtreh utas account", staff: true },
];
const LEASING: WorkspaceLink[] = [
  { href: "/workspace/leasing/today", label: "Өнөөдрийн ажил", group: "Ажлын урсгал", icon: "today", keywords: "today unuudur ajil" },
  { href: "/workspace/leasing", label: "Захиалга", group: "Ажлын урсгал", icon: "orders", keywords: "zahialga order tulbur" },
  { href: "/workspace/leasing/customers", label: "Хэрэглэгчид", group: "Ажлын урсгал", icon: "customers", keywords: "hereglegch customer utas" },
  { href: "/workspace/leasing/sms", label: "SMS", group: "Ажлын урсгал", icon: "sms", keywords: "message sanuulga sms" },
  { href: "/workspace/leasing/ready", label: "Бэлэн бараа", group: "Бараа ба тооцоо", icon: "stock", keywords: "belen stock baraa" },
  { href: "/workspace/leasing/sales", label: "Борлуулалт", group: "Бараа ба тооцоо", icon: "reports", keywords: "borluulalt sales" },
  { href: "/workspace/leasing/itgel", label: "Итгэлд төлөх", group: "Бараа ба тооцоо", icon: "money", keywords: "itgel tuluh tootsoo settlement" },
  { href: "/workspace/leasing/settings", label: "Тохиргоо", group: "Удирдлага", icon: "settings", keywords: "tohirgoo settings" },
  { href: "/workspace/leasing/account", label: "Нэвтрэх утас", group: "Удирдлага", icon: "account", keywords: "nevtreh utas account" },
];

export function workspaceLinksFor(portal: WorkspacePortal, role?: string | null): WorkspaceLink[] {
  if (portal === "leasing") return role === "LEASING" || role === "OWNER" ? LEASING : [];
  if (role === "ADMIN" || role === "OWNER") return SHOP;
  return role === "STAFF" ? SHOP.filter((link) => link.staff) : [];
}

export function activeWorkspaceLink(pathname: string, links: WorkspaceLink[]): WorkspaceLink | undefined {
  return [...links].sort((a, b) => b.href.length - a.href.length).find((link) =>
    pathname === link.href || (link.href.split("/").length > 3 && pathname.startsWith(`${link.href}/`)));
}

export function searchWorkspaceLinks(links: WorkspaceLink[], query: string): WorkspaceLink[] {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return links.filter((link) => terms.every((term) => `${link.label} ${link.group} ${link.keywords}`.toLocaleLowerCase().includes(term)));
}

export function workspaceHref(path: string, params: Record<string, string | null | undefined>): string {
  const [base, hash] = path.split("#", 2);
  const [pathname, raw = ""] = base.split("?", 2);
  const search = new URLSearchParams(raw);
  for (const [key, value] of Object.entries(params)) {
    if (value) search.set(key, value); else search.delete(key);
  }
  return `${pathname}${search.size ? `?${search}` : ""}${hash !== undefined ? `#${hash}` : ""}`;
}

export function normalizeWorkHref(href: string): string {
  const batch = /^\/workspace\/shop\/batches\/([^/?#]+)$/.exec(href);
  if (!batch) return href;
  try { return workspaceHref("/workspace/shop/batches", { batch: decodeURIComponent(batch[1]!) }); }
  catch { return "/workspace/shop/batches"; }
}
