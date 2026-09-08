import { useEffect, useMemo, useState } from "react";
import { useWindowStore } from "../../stores/useWindowStore";

type ReceiptType =
  "Satış Faturası" | "Alış Faturası" | "İade Faturası" | "Sipariş";
type ReceiptRecord = {
  id: number;
  no: string;
  date: string;
  customer: string;
  total: string;
  saleType?: "Soğuk Satış" | "Sıcak Satış";
  printed?: boolean;
  cancelled?: boolean;
};
const receiptTypes: ReceiptType[] = [
  "Satış Faturası",
  "Alış Faturası",
  "İade Faturası",
  "Sipariş",
];
const moduleNames: Record<ReceiptType, string> = {
  "Satış Faturası": "SalesInvoiceEntry",
  "Alış Faturası": "PurchaseInvoiceEntry",
  "İade Faturası": "ReturnInvoiceEntry",
  Sipariş: "OrderEntry",
};

export function ReceiptOperationsWindow() {
  const [activeType, setActiveType] = useState<ReceiptType>("Satış Faturası");
  const [records, setRecords] = useState<Record<ReceiptType, ReceiptRecord[]>>({
    "Satış Faturası": [],
    "Alış Faturası": [],
    "İade Faturası": [],
    Sipariş: [],
  });
  const [saleTypePickerOpen, setSaleTypePickerOpen] = useState(false);
  const [returnTypePickerOpen, setReturnTypePickerOpen] = useState(false);
  const [customerFilter, setCustomerFilter] = useState("");
  const [dateSort, setDateSort] = useState<"newest" | "oldest">("newest");
  const [invoiceTypeFilter, setInvoiceTypeFilter] = useState<
    "all" | "Soğuk Satış" | "Sıcak Satış"
  >("all");
  const apiUrl = import.meta.env.VITE_API_URL || "http://localhost:4000";
  const authHeaders: Record<string, string> = (() => {
    try {
      const user = JSON.parse(localStorage.getItem("vdesgo-user") || "{}");
      return {
        "x-vdesgo-account-type": user.accountType || "",
        "x-vdesgo-username": user.username || "",
      };
    } catch {
      return { "x-vdesgo-account-type": "", "x-vdesgo-username": "" };
    }
  })();
  const openWindow = useWindowStore((state) => state.openWindow);
  const maximizeWindow = useWindowStore((state) => state.maximizeWindow);

  useEffect(() => {
    const handleReceiptSaved = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          receiptType: ReceiptType;
          record: ReceiptRecord;
        }>
      ).detail;
      if (!detail?.receiptType || !detail.record) return;
      setRecords((current) => ({
        ...current,
        [detail.receiptType]: [
          { ...detail.record, printed: false, cancelled: false },
          ...current[detail.receiptType],
        ],
      }));
      setActiveType(detail.receiptType);
    };
    window.addEventListener("vdesgo:receipt-saved", handleReceiptSaved);
    return () =>
      window.removeEventListener("vdesgo:receipt-saved", handleReceiptSaved);
  }, []);

  const openNew = () => {
    if (activeType === "Satış Faturası") {
      setSaleTypePickerOpen(true);
      return;
    }
    if (activeType === "İade Faturası") {
      setReturnTypePickerOpen(true);
      return;
    }
    const windowId = openWindow({
      moduleName: moduleNames[activeType],
      title: `Yeni ${activeType}`,
      instanceType: "MULTIPLE",
      x: 120,
      y: 110,
      width: 620,
      height: 390,
    });
    maximizeWindow(windowId);
  };
  const openReturnInvoice = (returnType: "Sağlam" | "Bozuk") => {
    const windowId = openWindow({
      moduleName: moduleNames["İade Faturası"],
      title: `Yeni ${returnType} İade Faturası`,
      receiptReturnType: returnType,
      instanceType: "MULTIPLE",
      x: 120,
      y: 110,
      width: 620,
      height: 390,
    });
    maximizeWindow(windowId);
    setReturnTypePickerOpen(false);
  };
  const openSaleInvoice = (saleType: "Soğuk Satış" | "Sıcak Satış") => {
    const windowId = openWindow({
      moduleName: moduleNames["Satış Faturası"],
      title: `Yeni Satış Faturası - ${saleType}`,
      receiptSaleType: saleType,
      instanceType: "MULTIPLE",
      x: 120,
      y: 110,
      width: 620,
      height: 390,
    });
    maximizeWindow(windowId);
    setSaleTypePickerOpen(false);
  };
  const updateRecord = (id: number, changes: Partial<ReceiptRecord>) =>
    setRecords((current) => ({
      ...current,
      [activeType]: current[activeType].map((record) =>
        record.id === id ? { ...record, ...changes } : record,
      ),
    }));
  const deleteOrder = async (id: number) => {
    if (!window.confirm("Bu siparişi tamamen silmek istiyor musunuz?")) return;
    const response = await fetch(`${apiUrl}/orders/${id}`, {
      method: "DELETE",
      headers: authHeaders,
    });
    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      return window.alert(result.error || "Sipariş silinemedi.");
    }
    setRecords((current) => ({
      ...current,
      Sipariş: current.Sipariş.filter((record) => record.id !== id),
    }));
  };
  const deletePurchaseInvoice = async (id: number) => {
    if (!window.confirm("Bu alış faturasını tamamen silmek istiyor musunuz?")) return;
    const response = await fetch(`${apiUrl}/purchase-invoices/${id}`, {
      method: "DELETE",
      headers: authHeaders,
    });
    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      return window.alert(result.error || "Alış faturası silinemedi.");
    }
    setRecords((current) => ({
      ...current,
      "Alış Faturası": current["Alış Faturası"].filter((record) => record.id !== id),
    }));
  };
  const visibleRecords = useMemo(
    () =>
      records[activeType]
        .filter(
          (record) =>
            !customerFilter ||
            record.customer
              .toLocaleLowerCase("tr-TR")
              .includes(customerFilter.toLocaleLowerCase("tr-TR")),
        )
        .filter(
          (record) =>
            activeType !== "Satış Faturası" ||
            invoiceTypeFilter === "all" ||
            record.saleType === invoiceTypeFilter,
        )
        .sort((left, right) => {
          const result = left.date.localeCompare(right.date);
          return dateSort === "newest" ? -result : result;
        }),
    [activeType, customerFilter, dateSort, invoiceTypeFilter, records],
  );

  return (
    <div className="receipt-operations-window">
      <div className="receipt-operation-layout">
        <aside className="receipt-operation-menu" aria-label="Fatura işlemleri">
          <p className="definition-kicker">FATURA İŞLEMLERİ</p>
          {receiptTypes.map((type) => (
            <button
              className={activeType === type ? "is-selected" : ""}
              key={type}
              onClick={() => setActiveType(type)}
              type="button"
            >
              {type}
            </button>
          ))}
        </aside>
        <section className="receipt-operation-content">
          <div className="customers-toolbar">
            <div>
              <strong>{activeType} Listesi</strong>
              <span>
                {visibleRecords.length} / {records[activeType].length} kayıt
              </span>
            </div>
            <button className="primary-action" onClick={openNew} type="button">
              Yeni
            </button>
          </div>
          <div className="receipt-list-filters">
            <input
              aria-label="Müşteri ara"
              onChange={(event) => setCustomerFilter(event.target.value)}
              placeholder="Müşteri ara..."
              value={customerFilter}
            />
            <select
              aria-label="Tarih sıralaması"
              onChange={(event) =>
                setDateSort(event.target.value as "newest" | "oldest")
              }
              value={dateSort}
            >
              <option value="newest">Tarih: Yeni → Eski</option>
              <option value="oldest">Tarih: Eski → Yeni</option>
            </select>
            {activeType === "Satış Faturası" && (
              <select
                aria-label="Fatura tipi filtresi"
                onChange={(event) =>
                  setInvoiceTypeFilter(
                    event.target.value as "all" | "Soğuk Satış" | "Sıcak Satış",
                  )
                }
                value={invoiceTypeFilter}
              >
                <option value="all">Fatura tipi: Tümü</option>
                <option value="Soğuk Satış">Soğuk Satış</option>
                <option value="Sıcak Satış">Sıcak Satış</option>
              </select>
            )}
          </div>
          <div className="customers-table-wrap receipt-operation-table">
            <table className="customers-table">
              <thead>
                <tr>
                  <th>Belge No</th>
                  <th>Tarih</th>
                  <th>Fatura Tipi</th>
                  <th>Cari / Müşteri</th>
                  <th>Toplam Tutar</th>
                  <th>Durum</th>
                  <th>İşlem</th>
                </tr>
              </thead>
              <tbody>
                {visibleRecords.length === 0 ? (
                  <tr>
                    <td className="operation-list-empty" colSpan={7}>
                      Kayıt bulunmuyor.
                    </td>
                  </tr>
                ) : (
                  visibleRecords.map((record) => (
                    <tr
                      className={
                        record.cancelled ? "receipt-cancelled-row" : ""
                      }
                      key={record.id}
                    >
                      <td className="customer-code">{record.no}</td>
                      <td>{record.date}</td>
                      <td>
                        {record.saleType ||
                          (activeType === "Satış Faturası" ? "-" : activeType)}
                      </td>
                      <td>{record.customer}</td>
                      <td>{record.total}</td>
                      <td>
                        <span
                          className={
                            record.cancelled
                              ? "receipt-status-cancelled"
                              : record.printed
                                ? "receipt-status-printed"
                                : "receipt-status-pending"
                          }
                        >
                          {record.cancelled
                            ? "İptal"
                            : record.printed
                              ? "Yazdırıldı"
                              : "Yazdırılmadı"}
                        </span>
                      </td>
                      <td>
                        <div className="user-row-actions">
                          {activeType !== "Sipariş" && activeType !== "Alış Faturası" && (
                            <button
                              disabled={record.cancelled}
                              onClick={() =>
                                updateRecord(record.id, { printed: true })
                              }
                              type="button"
                            >
                              Yazdır
                            </button>
                          )}
                          {activeType === "Sipariş" ? (
                            <button
                              className="delete-action"
                              onClick={() => deleteOrder(record.id)}
                              type="button"
                            >
                              İptal
                            </button>
                          ) : activeType === "Alış Faturası" ? (
                            <button
                              className="delete-action"
                              onClick={() => deletePurchaseInvoice(record.id)}
                              type="button"
                            >
                              Sil
                            </button>
                          ) : (
                            <button
                              className="delete-action"
                              disabled={record.cancelled}
                              onClick={() => {
                                if (
                                  window.confirm(
                                    "Bu faturayı iptal etmek istiyor musunuz?",
                                  )
                                )
                                  updateRecord(record.id, { cancelled: true });
                              }}
                              type="button"
                            >
                              İptal
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
      {saleTypePickerOpen && (
        <div
          className="customer-picker-backdrop"
          onClick={() => setSaleTypePickerOpen(false)}
        >
          <section
            className="sale-type-dialog"
            onClick={(event) => event.stopPropagation()}
          >
            <p className="definition-kicker">SATIŞ TİPİ</p>
            <h2>Satış türünü seçiniz</h2>
            <p>Fatura ekranı seçtiğiniz satış türüne göre açılacaktır.</p>
            <div className="sale-type-actions">
              <button
                className="primary-action"
                onClick={() => openSaleInvoice("Soğuk Satış")}
                type="button"
              >
                Soğuk Satış
              </button>
              <button
                className="secondary-action"
                onClick={() => openSaleInvoice("Sıcak Satış")}
                type="button"
              >
                Sıcak Satış
              </button>
            </div>
          </section>
        </div>
      )}
      {returnTypePickerOpen && (
        <div
          className="customer-picker-backdrop"
          onClick={() => setReturnTypePickerOpen(false)}
        >
          <section
            className="unit-prompt-dialog"
            onClick={(event) => event.stopPropagation()}
          >
            <h2>İade Faturası Türü</h2>
            <p>İade türünü seçiniz.</p>
            <div className="dialog-actions">
              <button
                className="secondary-action"
                onClick={() => openReturnInvoice("Sağlam")}
                type="button"
              >
                Sağlam İade Faturası
              </button>
              <button
                className="primary-action"
                onClick={() => openReturnInvoice("Bozuk")}
                type="button"
              >
                Bozuk İade Faturası
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
