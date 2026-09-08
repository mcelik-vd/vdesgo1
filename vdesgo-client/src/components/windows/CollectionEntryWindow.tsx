import { useEffect, useState } from "react";

type CollectionType = "Tahsilat" | "Bakiye Düşürme" | "Bakiye Yükseltme";
type Customer = {
  code: string;
  name: string;
  title: string;
  balance?: string;
  active?: boolean;
};

const parseBalance = (value: string) =>
  Number(
    String(value || "0")
      .replace(/\./g, "")
      .replace(",", ".")
      .replace(/[^0-9.-]/g, ""),
  ) || 0;
const formatBalance = (value: number) =>
  `${value.toFixed(2).replace(".", ",")} TL`;

export function CollectionEntryWindow({
  collectionType,
  onSaved,
}: {
  collectionType: CollectionType;
  onSaved?: () => void;
}) {
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
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [customerPickerOpen, setCustomerPickerOpen] = useState(false);
  const [customerSearch, setCustomerSearch] = useState("");
  const [form, setForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    amount: "",
    description: "",
  });

  useEffect(() => {
    fetch(`${apiUrl}/data/customers`, { headers: authHeaders })
      .then((response) => response.json())
      .then((data: Customer[]) =>
        setCustomers(data.filter((item) => item.active !== false)),
      )
      .catch(() => setCustomers([]));
  }, [apiUrl]);

  const delta = collectionType === "Bakiye Yükseltme" ? 1 : -1;
  const filteredCustomers = customers.filter((item) => {
    const query = customerSearch.trim().toLocaleLowerCase("tr-TR");
    return !query || [item.code, item.name, item.title].some((value) =>
      value.toLocaleLowerCase("tr-TR").includes(query),
    );
  });
  const newBalance = customer
    ? parseBalance(customer.balance || "") +
      delta * (Number(form.amount.replace(",", ".")) || 0)
    : null;
  const save = async () => {
    if (!customer) return window.alert("Cari seçiniz.");
    const amount = Number(form.amount.replace(",", ".")) || 0;
    if (amount <= 0) return window.alert("Tutar sıfırdan büyük olmalıdır.");
    if (collectionType !== "Tahsilat" && !form.description.trim()) return window.alert("Açıklama giriniz.");
    const response = await fetch(`${apiUrl}/collection-operations`, {
      method: "POST",
      headers: { ...authHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({
        customerCode: customer.code,
        operationType: collectionType,
        amount,
        description: form.description.trim(),
        operationDate: form.date,
      }),
    });
    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      return window.alert(result.error || "Tahsilat işlemi kaydedilemedi.");
    }
    const record = await response.json();
    window.dispatchEvent(
      new CustomEvent("vdesgo:collection-saved", { detail: { record } }),
    );
    onSaved?.();
  };

  return (
    <div className="collection-entry-window">
      <header>
        <p className="definition-kicker">TAHSİLAT İŞLEMLERİ</p>
        <h2>{collectionType}</h2>
        <p>
          {collectionType === "Tahsilat"
            ? "Müşteriden alacak tahsilatı."
            : collectionType === "Bakiye Düşürme"
              ? "Cari bakiyesini düşürme işlemi."
              : "Cari bakiyesini yükseltme işlemi."}
        </p>
      </header>
      <div className="collection-form-grid">
        <label>
          Tarih
          <input
            type="date"
            value={form.date}
            onChange={(event) => setForm({ ...form, date: event.target.value })}
          />
        </label>
        <label>
          Cari / Müşteri
          <button
            className="collection-customer-button"
            onClick={() => setCustomerPickerOpen(true)}
            type="button"
          >
            {customer
              ? `${customer.code} · ${customer.name} · ${customer.title}`
              : "Cari seçiniz"}
          </button>
        </label>
        <label>
          Önceki Bakiye
          <input readOnly value={customer?.balance || "-"} />
        </label>
        <label>
          Tutar
          <input
            inputMode="decimal"
            min="0"
            onKeyDown={(event) => {
              if (event.key === "-" || event.key === "e" || event.key === "E") {
                event.preventDefault();
              }
            }}
            value={form.amount}
            onChange={(event) => {
              const value = event.target.value.replace(/-/g, "");
              setForm({ ...form, amount: value });
            }}
            type="number"
          />
        </label>
        <label className="collection-description">
          Açıklama
          <textarea
            value={form.description}
            onChange={(event) =>
              setForm({ ...form, description: event.target.value })
            }
          />
        </label>
        <label>
          Yeni Bakiye
          <input
            readOnly
            value={newBalance === null ? "-" : formatBalance(newBalance)}
          />
        </label>
      </div>
      <div className="collection-actions">
        <button className="primary-action" onClick={save} type="button">
          Kaydet
        </button>
      </div>
      {customerPickerOpen && (
        <div
          className="customer-picker-backdrop"
          onClick={() => setCustomerPickerOpen(false)}
        >
          <section
            className="customer-picker-dialog"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="definition-panel-heading">
              <h2>Cari / Müşteri Listesi</h2>
              <button
                className="ghost-button"
                onClick={() => setCustomerPickerOpen(false)}
                type="button"
              >
                Kapat
              </button>
            </div>
            <input
              autoFocus
              className="customer-picker-search"
              placeholder="Cari filtrele..."
              value={customerSearch}
              onChange={(event) => setCustomerSearch(event.target.value)}
            />
            <div className="customer-picker-list">
              {filteredCustomers.map((item) => (
                <button
                  key={item.code}
                  onClick={() => {
                    setCustomer(item);
                    setCustomerPickerOpen(false);
                    setCustomerSearch("");
                  }}
                  type="button"
                >
                  <strong>{item.name}</strong>
                  <span>{item.code} · {item.title}</span>
                </button>
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
