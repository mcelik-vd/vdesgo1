import { useEffect, useState } from "react";
import { ProductCodePicker } from "../ProductCodePicker";

type Product = { code: string; name: string; active: boolean };
type ProductUnit = {
  productCode: string;
  unit: string;
  innerQuantity: string;
  barcode: string;
};
type Warehouse = { code: string; name: string; type: string; active: boolean };
type LoadingLine = {
  productCode: string;
  productName: string;
  unit: string;
  innerQuantity: string;
  quantity: string;
  totalQuantity: string;
};
const emptyLine = (): LoadingLine => ({
  productCode: "",
  productName: "",
  unit: "",
  innerQuantity: "",
  quantity: "",
  totalQuantity: "",
});
const numberValue = (value: string) =>
  Number.parseFloat(value.replace(",", "."));
const today = new Date();
const maxDate = today.toISOString().slice(0, 10);
const minDate = new Date(today.getTime() - 5 * 86400000)
  .toISOString()
  .slice(0, 10);

export function VehicleLoadingWindow({ onSaved }: { onSaved?: () => void }) {
  const [receiptNo, setReceiptNo] = useState<number | null>(null);
  const [loadingDate, setLoadingDate] = useState(maxDate);
  const [enteringWarehouseCode, setEnteringWarehouseCode] = useState("");
  const [exitingWarehouseCode, setExitingWarehouseCode] = useState("");
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [units, setUnits] = useState<ProductUnit[]>([]);
  const [line, setLine] = useState<LoadingLine>(emptyLine());
  const [lines, setLines] = useState<LoadingLine[]>([]);
  const [stock, setStock] = useState<number | null>(null);
  const [message, setMessage] = useState("");
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
  useEffect(() => {
    Promise.all([
      fetch(`${apiUrl}/inventory/vehicle-loadings/next-number`, {
        headers: authHeaders,
      }).then((r) => r.json()),
      fetch(`${apiUrl}/data/warehouses`, { headers: authHeaders }).then((r) =>
        r.json(),
      ),
      fetch(`${apiUrl}/data/products`).then((r) => r.json()),
      fetch(`${apiUrl}/data/productUnits`).then((r) => r.json()),
    ])
      .then(([number, warehouseData, productData, unitData]) => {
        setReceiptNo(number.receiptNo);
        setWarehouses(warehouseData.filter((item: Warehouse) => item.active));
        setProducts(productData.filter((item: Product) => item.active));
        setUnits(unitData);
      })
      .catch(() => setMessage("Araç yükleme bilgileri alınamadı."));
  }, [apiUrl]);
  const findProduct = (selectedProduct?: Product) => {
    if (
      enteringWarehouseCode &&
      exitingWarehouseCode &&
      enteringWarehouseCode === exitingWarehouseCode
    ) {
      window.alert("Giren depo ve çıkan depo aynı olamaz.");
      return;
    }
    const product = selectedProduct || products.find(
      (item) => item.code.toLowerCase() === line.productCode.trim().toLowerCase(),
    );
    if (!product) {
      setLine({ ...line, productName: "", unit: "", innerQuantity: "" });
      setMessage("Ürün kodu bulunamadı.");
      return;
    }
    const firstUnit = units.find((item) => item.productCode === product.code);
    setLine({
      ...line,
      productCode: product.code,
      productName: product.name,
      unit: firstUnit?.unit || "",
      innerQuantity: firstUnit?.innerQuantity || "",
    });
    setMessage("");
  };
  const productUnits = units.filter(
    (item) => item.productCode === line.productCode,
  );
  const content = numberValue(line.innerQuantity);
  const total = content * Number(line.quantity);
  const stockInUnit =
    stock === null || !Number.isFinite(content) || content <= 0
      ? null
      : stock / content;
  useEffect(() => {
    if (!exitingWarehouseCode || !line.productCode) {
      setStock(null);
      return;
    }
    fetch(
      `${apiUrl}/inventory/stock?warehouseCode=${encodeURIComponent(exitingWarehouseCode)}&productCode=${encodeURIComponent(line.productCode)}`,
      { headers: authHeaders },
    )
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data: { baseQuantity: number }) => setStock(data.baseQuantity))
      .catch(() => setStock(null));
  }, [apiUrl, exitingWarehouseCode, line.productCode]);
  const addLine = () => {
    if (!enteringWarehouseCode || !exitingWarehouseCode) {
      window.alert("Lütfen giren araç deposunu ve çıkan depoyu seçiniz.");
      return;
    }
    if (!line.productName || !line.unit)
      return setMessage("Geçerli ürün ve birim seçiniz.");
    if (!line.quantity || Number(line.quantity) <= 0 || !Number.isFinite(total))
      return setMessage("Miktar sıfırdan büyük olmalıdır.");
    if (stock !== null && total > stock)
      return setMessage("Çıkan depoda yeterli stok bulunmuyor.");
    setLines([...lines, { ...line, totalQuantity: String(total) }]);
    setLine(emptyLine());
    setMessage("");
  };
  const save = async () => {
    if (
      !receiptNo ||
      !enteringWarehouseCode ||
      !exitingWarehouseCode ||
      lines.length === 0
    )
      return setMessage("Araç deposu, çıkan depo ve ürün satırı zorunludur.");
    const response = await fetch(`${apiUrl}/inventory/vehicle-loadings`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({
        receiptNo,
        loadingDate,
        enteringWarehouseCode,
        exitingWarehouseCode,
        lines,
      }),
    });
    if (!response.ok) {
      const error = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      setMessage(error.error || "Araç yükleme kaydedilemedi.");
      return;
    }
    setMessage(`Araç yükleme fişi ${receiptNo} kaydedildi.`);
    onSaved?.();
  };
  return (
    <div className="other-stock-entry-window">
      <section className="shipment-form-panel">
        <div className="definition-panel-heading">
          <div>
            <p className="definition-kicker">DEPO İŞLEMLERİ</p>
            <h2>Araç Yükleme</h2>
          </div>
          <span className="mock-badge">FİŞ KAYDI</span>
        </div>
        <div className="shipment-form-grid">
          <label>
            Fiş No
            <input value={receiptNo ?? "Alınıyor..."} readOnly />
          </label>
          <label>
            Tarih
            <input
              max={maxDate}
              min={minDate}
              type="date"
              value={loadingDate}
              onChange={(e) => setLoadingDate(e.target.value)}
            />
          </label>
          <label>
            Giren Depo (Araç Deposu)
            <select
              value={enteringWarehouseCode}
              onChange={(e) => setEnteringWarehouseCode(e.target.value)}
            >
              <option value="">Araç deposu seçiniz</option>
              {warehouses
                .filter((item) =>
                  ["Araç Deposu", "Arac Deposu"].includes(item.type),
                )
                .map((item) => (
                  <option key={item.code} value={item.code}>
                    {item.name} ({item.code})
                  </option>
                ))}
            </select>
          </label>
          <label>
            Çıkan Depo
            <select
              value={exitingWarehouseCode}
              onChange={(e) => setExitingWarehouseCode(e.target.value)}
            >
              <option value="">Depo seçiniz</option>
              {warehouses.map((item) => (
                <option key={item.code} value={item.code}>
                  {item.name} ({item.code})
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>
      <section className="shipment-form-panel">
        <div className="definition-panel-heading">
          <div>
            <p className="definition-kicker">ÜRÜN SEÇİMİ</p>
            <h2>Yüklenecek Ürün</h2>
          </div>
        </div>
        <div className="shipment-form-grid">
          <label>
            Ürün Kodu
            <ProductCodePicker
              products={products}
              value={line.productCode}
              onChange={(value) => setLine({ ...line, productCode: value })}
              onCommit={() => findProduct()}
              onSelect={(product) => findProduct(product)}
            />
          </label>
          <label>
            Ürün Adı
            <input value={line.productName} readOnly />
          </label>
          <label>
            Birim
            <select
              value={line.unit}
              onChange={(e) => {
                const selected = productUnits.find(
                  (item) => item.unit === e.target.value,
                );
                setLine({
                  ...line,
                  unit: e.target.value,
                  innerQuantity: selected?.innerQuantity || "",
                });
              }}
            >
              <option value="">Birim seçiniz</option>
              {productUnits.map((item) => (
                <option key={item.barcode} value={item.unit}>
                  {item.unit}
                </option>
              ))}
            </select>
          </label>
          <label>
            Birim İçeriği
            <div className="entry-info-value">{line.innerQuantity || "-"}</div>
          </label>
          <label>
            Miktar
            <input
              min="0"
              type="number"
              value={line.quantity}
              onChange={(e) => setLine({ ...line, quantity: e.target.value })}
            />
          </label>
          <label>
            Toplam Miktar
            <div className="entry-info-value entry-total-value">
              {line.quantity && line.innerQuantity ? total : "-"}
            </div>
          </label>
          <label>
            Çıkan Depo Mevcut Stok
            <div className="entry-info-value entry-stock-value">
              {stockInUnit === null ? "-" : `${stockInUnit} ${line.unit}`}
            </div>
          </label>
          <button className="primary-action" onClick={addLine} type="button">
            Ekle
          </button>
        </div>
        {message && (
          <p className="unit-error" role="alert">
            {message}
          </p>
        )}
      </section>
      <section className="shipment-list-panel">
        <div className="customers-toolbar">
          <div>
            <strong>Yükleme Ürünleri</strong>
            <span>{lines.length} satır</span>
          </div>
          <button
            className="primary-action"
            disabled={!lines.length}
            onClick={() => void save()}
            type="button"
          >
            Yüklemeyi Kaydet
          </button>
        </div>
        <div className="customers-table-wrap">
          <table className="customers-table">
            <thead>
              <tr>
                <th>Ürün Kodu</th>
                <th>Ürün Adı</th>
                <th>Birim</th>
                <th>Miktar</th>
                <th>Toplam</th>
                <th>İşlem</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((item, index) => (
                <tr key={`${item.productCode}-${index}`}>
                  <td>{item.productCode}</td>
                  <td>{item.productName}</td>
                  <td>{item.unit}</td>
                  <td>{item.quantity}</td>
                  <td>{item.totalQuantity}</td>
                  <td>
                    <button
                      className="danger-button"
                      onClick={() =>
                        setLines(lines.filter((_, i) => i !== index))
                      }
                      type="button"
                    >
                      Sil
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
