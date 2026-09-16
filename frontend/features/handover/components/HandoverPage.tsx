"use client";

import { deferEffect } from "@/lib/deferEffect";
import { useEffect, useState } from "react";
import { Metric, OrderBadge, PageHead } from "@/components/admin/shared";
import { QrScanner } from "@/components/QrScanner";
import { Button, Card, Divider, Empty, ErrorNote, Input, Spinner } from "@/components/ui";
import { api } from "@/lib/api";
import { money, phoneLabel } from "@/lib/format";
import type { HandoverReceiptStore } from "@/lib/handoverReceipt";
import { leasingAccountDue, shopDueOf } from "@/lib/leasing";
import { useToast } from "@/lib/toast";
import type { HandoverPayMethod } from "@/lib/types";
import { useHandoverHistory } from "../hooks/useHandoverHistory";
import { useHandoverMutation } from "../hooks/useHandoverMutation";
import { useHandoverSearch } from "../hooks/useHandoverSearch";
import {
  isReceiptItem,
  printCustomerReceipt,
  printFoundOrderReceipt,
  readPayMethod,
  writePayMethod,
} from "../utils";
import { CustomerItemsPanel } from "./CustomerItemsPanel";
import { CustomerResultsList } from "./CustomerResultsList";
import { FoundOrderPanel } from "./FoundOrderPanel";
import { HistoryPanel } from "./HistoryPanel";

type Tab = "give" | "done";

/** Ажилтан нөгөө гартаа хайрцаг барьж байгаа — товч доод талд, том. */
export function HandoverPage() {
  const toast = useToast();

  const [tab, setTab] = useState<Tab>("give");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [payMethod, setPayMethod] = useState<HandoverPayMethod | null>(null);

  useEffect(
    () =>
      deferEffect(() => {
        setPayMethod(readPayMethod());
      }),
    [],
  );

  const choosePayMethod = (value: HandoverPayMethod) => {
    setPayMethod(value);
    writePayMethod(value);
  };
  const [store, setStore] = useState<HandoverReceiptStore | undefined>();

  useEffect(() => {
    void api
      .store()
      .then((s) =>
        setStore({
          name: s.storeName,
          phone: s.phone,
          address: s.address,
        }),
      )
      .catch(() => undefined);
  }, []);

  const history = useHandoverHistory();
  const search = useHandoverSearch({ setBusy, setError, setDone });

  const goToDone = () => {
    setTab("done");
    history.goToToday();
  };

  const { markReceived, complete } = useHandoverMutation({
    found: search.found,
    setFound: search.setFound,
    activeCustomer: search.activeCustomer,
    setActiveCustomer: search.setActiveCustomer,
    setCustomers: search.setCustomers,
    setCode: search.setCode,
    setCustomerQ: search.setCustomerQ,
    pickableSelected: search.pickableSelected,
    dueForSelected: search.dueForSelected,
    payMethod,
    loadPending: search.loadPending,
    goToDone,
    resetSelection: search.resetSelection,
    setBusy,
    setError,
    setDone,
  });

  const printSlip = () => {
    if (!search.activeCustomer) return;
    const items =
      search.printItems.length > 0
        ? search.printItems
        : search.activeCustomer.items.filter(isReceiptItem);
    if (items.length === 0) {
      toast.error("Хэвлэх бараа байхгүй.");
      return;
    }
    try {
      printCustomerReceipt(
        search.activeCustomer,
        items,
        search.dueForSelected,
        payMethod,
        store,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Хэвлэж чадсангүй.");
    }
  };

  const printFoundSlip = () => {
    if (!search.found) return;
    const items = search.found.items.filter(isReceiptItem);
    if (items.length === 0) {
      toast.error("Хэвлэх бараа байхгүй.");
      return;
    }
    try {
      printFoundOrderReceipt(search.found, items, payMethod, store);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Хэвлэж чадсангүй.");
    }
  };

  const tabBar = (
    <div className="no-scrollbar mb-5 flex gap-2 overflow-x-auto">
      {(
        [
          { key: "give" as const, label: "Өгөх" },
          { key: "done" as const, label: "Өгсөн" },
        ] as const
      ).map((t) => (
        <button
          key={t.key}
          type="button"
          onClick={() => setTab(t.key)}
          className={`h-10 shrink-0 cursor-pointer whitespace-nowrap rounded-[8px] border px-4 text-[14px] ${
            tab === t.key ? "border-ink bg-ink text-white" : "border-line bg-bg text-ink"
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );

  // Байдал: хэрэглэгчийн мөрүүд
  if (search.activeCustomer) {
    return (
      <CustomerItemsPanel
        customer={search.activeCustomer}
        selected={search.selected}
        dueForSelected={search.dueForSelected}
        pickableSelected={search.pickableSelected}
        printItems={search.printItems}
        payMethod={payMethod}
        error={error}
        busy={busy}
        onToggleItem={search.toggleItem}
        onPayMethod={choosePayMethod}
        onBack={() => {
          search.setActiveCustomer(null);
          search.resetSelection();
          if (search.customers && search.customers.length <= 1) search.setCustomers(null);
        }}
        onPrint={printSlip}
        onMarkReceived={markReceived}
      />
    );
  }

  // Олон хэрэглэгч олдсон
  if (search.customers && search.customers.length > 1) {
    return (
      <CustomerResultsList
        customers={search.customers}
        onBack={() => search.setCustomers(null)}
        onOpen={search.openCustomer}
      />
    );
  }

  // Байдал 2 — захиалга олдсон (код/QR)
  if (search.found) {
    return (
      <FoundOrderPanel
        found={search.found}
        payMethod={payMethod}
        error={error}
        busy={busy}
        onPayMethod={choosePayMethod}
        onCancel={() => {
          search.setFound(null);
        }}
        onPrint={printFoundSlip}
        onComplete={complete}
      />
    );
  }

  // Байдал 1 — хайлт / өгсөн түүх
  return (
    <div className="mx-auto max-w-[560px]">
      <PageHead
        title="Хүлээлгэн өгөх"
        hint={
          tab === "done"
            ? "Өмнө өгсөн хүмүүс, тухайн өдрийн бэлэн орлого"
            : search.loading
              ? "Ачаалж байна…"
              : `Өнөөдөр авах ёстой: ${search.pending.length}`
        }
      />

      {tabBar}

      {tab === "done" ? (
        <HistoryPanel
          year={history.year}
          month={history.month}
          years={history.years}
          onYear={history.setYear}
          onMonth={history.setMonth}
          history={history.history}
          loading={history.historyLoading}
          error={history.historyError}
          openDate={history.openDate}
          onOpenDate={history.setOpenDate}
          store={store}
        />
      ) : (
        <>
          {history.todayTake && (
            <div className="mb-4 grid grid-cols-3 gap-3">
              <Metric
                label="Өнөөдөр бэлэн"
                value={money(history.todayTake.cash)}
                tone="ok"
                sub="дэлгүүрт орсон"
              />
              <Metric label="Карт" value={money(history.todayTake.card)} sub="өнөөдөр" />
              <Metric label="Данс" value={money(history.todayTake.bank)} sub="өнөөдөр" />
            </div>
          )}

          {done && (
            <Card className="mb-4 border-ok bg-ok-bg p-4">
              <span className="tnum text-[14px] text-ok">{done} — хүлээлгэн өгсөн.</span>
            </Card>
          )}

          {search.scanning ? (
            <div className="mb-4">
              <QrScanner onResult={search.lookup} />
              <Button full variant="outline" className="mt-3" onClick={() => search.setScanning(false)}>
                Скан хаах
              </Button>
            </div>
          ) : (
            <Button full variant="outline" className="mb-4 h-14" onClick={() => search.setScanning(true)}>
              QR уншуулах
            </Button>
          )}

          <Card className="mb-4 flex flex-col gap-3 p-4">
            <div className="text-[14px] font-medium">Утас, нэр эсвэл и-мэйл</div>
            <p className="m-0 text-[13px] leading-[1.4] text-muted">
              Утсаар захиалсан / сайт дээр «өөрөө авна» дараагүй байсан ч утасны дугаараар олж өгнө.
            </p>
            <Input
              value={search.customerQ}
              onChange={search.setCustomerQ}
              placeholder="99112233 / Бат / you@gmail.com"
            />
            <Button
              full
              onClick={() => void search.searchCustomer()}
              loading={busy}
              disabled={search.customerQ.trim().length < 2}
            >
              Хэрэглэгч хайх
            </Button>
          </Card>

          <Card className="mb-6 flex flex-col gap-3 p-4">
            <div className="text-[14px] text-ink-2">Эсвэл захиалгын код</div>
            <Input
              value={search.code}
              onChange={(v) => search.setCode(v.toUpperCase())}
              placeholder="PH-XXXXXX"
              maxLength={9}
            />
            <Button full onClick={() => search.lookup(search.code)} loading={busy} disabled={search.code.length < 3}>
              Кодоор хайх
            </Button>
            {error && <ErrorNote>{error}</ErrorNote>}
          </Card>

          <Divider className="mb-4" />

          <div className="mb-2 text-[15px] font-medium">Хүлээгдэж буй</div>
          {search.loading ? (
            <div className="flex justify-center py-10">
              <Spinner className="text-muted" />
            </div>
          ) : search.pending.length === 0 ? (
            <Empty>Хүлээгдэж буй захиалга алга.</Empty>
          ) : (
            <div className="flex flex-col gap-3">
              {search.pending.map((order) => (
                <Card key={order.id} className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="tnum text-[15px] font-medium">{order.code}</div>
                      <div className="text-[13px] text-muted">
                        {order.customer.name ?? "Нэргүй"} ·{" "}
                        <span className="tnum">{phoneLabel(order.customer.phone)}</span>
                      </div>
                    </div>
                    <OrderBadge status={order.status} />
                  </div>
                  <div className="mt-2 flex items-baseline justify-between gap-2 text-[13px]">
                    <span className="text-muted">
                      {order.itemCount} бараа ·{" "}
                      {order.fulfilment === "DELIVERY"
                        ? "Хүргэлт"
                        : order.fulfilment === "PICKUP"
                          ? "Өөрөө авна"
                          : "Сонгоогүй"}
                      {(order.storageFee ?? 0) > 0 ? ` · Агуулах ${money(order.storageFee)}` : ""}
                      {(order.cargoFee ?? 0) > 0 ? ` · Карго ${money(order.cargoFee)}` : ""}
                    </span>
                    <span
                      className={`tnum font-medium ${
                        shopDueOf(order) > 0
                          ? "text-warn"
                          : leasingAccountDue(order) > 0
                            ? "text-ink-2"
                            : "text-ok"
                      }`}
                    >
                      {shopDueOf(order) > 0
                        ? `Авах ${money(shopDueOf(order))}`
                        : leasingAccountDue(order) > 0
                          ? `Лизинг ${money(leasingAccountDue(order))}`
                          : "Төлөгдсөн"}
                    </span>
                  </div>
                  <Button full variant="outline" className="mt-3" onClick={() => search.lookup(order.code)}>
                    Нээх
                  </Button>
                </Card>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
