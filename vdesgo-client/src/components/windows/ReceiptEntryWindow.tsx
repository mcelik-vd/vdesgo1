import { useEffect, useState } from "react";
import { Search } from "lucide-react";

type ReceiptType =
  "Satış Faturası" | "Alış Faturası" | "İade Faturası" | "Sipariş";
type Customer = {
  code: string;
  name: string;
  title: string;
  taxOffice?: string;
  taxNo?: string;
  balance?: string;
  customerDiscount1?: string;
  customerDiscount2?: string;
  customerDiscount3?: string;
  customerGroupCode?: string;
  type?: string;
  salesRepresentative?: string;
  cashDiscount?: string;
  deferredDiscount?: string;
  active?: boolean;
};
type Product = {
  code: string;
  name: string;
  unit: string;
  vat: string;
  ePoint: string;
  volume: string;
  weight: string;
  category?: string;
  productType?: string;
  active?: boolean;
};
type Unit = {
  productCode: string;
  unit: string;
  innerQuantity: string;
  barcode: string;
};
type Price = {
  productCode: string;
  purchasePrice: string;
  salesPrice: string;
  status: string;
};
type Warehouse = { code: string; name: string; type: string; active: boolean };
type BasketLine = {
  code: string;
  product: string;
  quantity: string;
  unit: string;
  innerQuantity: string;
  unitPrice: string;
  discount1: string;
  discount2: string;
  vatRate: number;
  productType: string;
  productGroup: string;
  isPromotional?: boolean;
  gross: string;
  total: string;
};
type Promotion = {
  id: number;
  code: string;
  name: string;
  promotionType: string;
  conditionType: string;
  conditionUnit: string;
  threshold: number;
  rewardValue: number;
  rewardType: string;
  rewardProductCodes: string[];
  rewardProductUnits: Record<string, string>;
  priority: number;
  startDate: string;
  endDate: string | null;
  active: boolean;
  customerTypeCodes: string[];
  customerGroupCodes: string[];
  customerCodes: string[];
  productTypeCodes: string[];
  productGroupCodes: string[];
  productCodes: string[];
};
type DiscountKey = "m1" | "cash" | "m2" | "deferred" | "m3";
const discountLabels: Array<[DiscountKey, string]> = [
  ["m1", "M1 İsk"],
  ["m2", "M2 İsk"],
  ["m3", "M3 İsk"],
  ["deferred", "Vadeli İsk"],
  ["cash", "Peşin İsk"],
];
const emptyProduct = () => ({
  code: "",
  name: "",
  quantity: "1",
  unit: "",
  innerQuantity: "",
  baseUnitPrice: "0,00",
  unitPrice: "0,00",
  discount1: "0",
  discount2: "0",
  vatRate: 0,
  productType: "",
  category: "",
});
const rate = (value: string) =>
  Number.parseFloat(value.replace(",", ".").replace("%", "")) || 0;
const calculateProductNet = (gross: number, discount1: string, discount2: string) => {
  const afterDiscount1 = gross * (1 - rate(discount1) / 100);
  return afterDiscount1 * (1 - rate(discount2) / 100);
};
const addDays = (dateString: string, days: number) => {
  if (!dateString) return "";
  const date = new Date(`${dateString}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

export function ReceiptEntryWindow({
  receiptType,
  saleType,
  returnType,
  onSaved,
  onMissingSalesRepresentative,
}: {
  receiptType: ReceiptType;
  saleType?: 'Soğuk Satış' | 'Sıcak Satış';
  returnType?: 'Sağlam' | 'Bozuk';
  onSaved?: (record: { id?: number; no: string; date: string; customer: string; total: string; saleType?: 'Soğuk Satış' | 'Sıcak Satış' }) => void;
  onMissingSalesRepresentative?: () => void;
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
  const [customerSearch, setCustomerSearch] = useState("");
  const [customerPickerOpen, setCustomerPickerOpen] = useState(false);
  const [products, setProducts] = useState<Product[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [prices, setPrices] = useState<Price[]>([]);
  const [productSearch, setProductSearch] = useState("");
  const [productPickerOpen, setProductPickerOpen] = useState(false);
  const [form, setForm] = useState({
    no: "",
    date: new Date().toISOString().slice(0, 10),
    depot: "",
    payment: "Diğer",
    dueDate: "",
    note: "",
    saleType: saleType || "",
    returnType: returnType || "",
  });
  const [product, setProduct] = useState(emptyProduct);
  const [basket, setBasket] = useState<BasketLine[]>([]);
  const [discounts, setDiscounts] = useState<Record<DiscountKey, boolean>>({
    m1: false,
    m2: false,
    m3: false,
    deferred: false,
    cash: false,
  });
  const [discountRates, setDiscountRates] = useState<
    Record<DiscountKey, string>
  >({ m1: "0", m2: "0", m3: "0", deferred: "0", cash: "0" });
  const [warehouseStock, setWarehouseStock] = useState<number | null>(null);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [rewardPickerOpen, setRewardPickerOpen] = useState(false);
  const [rewardPickerPromotionId, setRewardPickerPromotionId] = useState<number | null>(null);
  const [selectedRewardCode, setSelectedRewardCode] = useState<string | null>(null);
  const [promotionPickerOpen, setPromotionPickerOpen] = useState(false);
  const [selectedPromotionId, setSelectedPromotionId] = useState<number | null>(null);
  const [orderStockReservation, setOrderStockReservation] = useState<boolean | null>(
    receiptType === "Sipariş" ? null : false,
  );
  const [orderStockReservationDialogOpen, setOrderStockReservationDialogOpen] =
    useState(receiptType === "Sipariş");
  useEffect(() => {
    if (receiptType !== "Sipariş") return;
    setOrderStockReservationDialogOpen(true);
  }, [receiptType]);
  useEffect(() => {
    if (receiptType !== "Satış Faturası" && receiptType !== "Sipariş") {
      setPromotions([]);
      return;
    }
    fetch(`${apiUrl}/promotions`, { headers: authHeaders })
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then((data: Promotion[]) => setPromotions(data))
      .catch(() => setPromotions([]));
  }, [apiUrl, receiptType]);
  useEffect(() => {
    Promise.all([
      fetch(`${apiUrl}/data/customers`, { headers: authHeaders }),
      fetch(`${apiUrl}/data/products`),
      fetch(`${apiUrl}/data/productUnits`),
      fetch(`${apiUrl}/data/prices`),
      fetch(`${apiUrl}/data/warehouses`, { headers: authHeaders }),
    ])
      .then(
        async ([
          customersResponse,
          productsResponse,
          unitsResponse,
          pricesResponse,
          warehouseResponse,
        ]) => {
          const customersData = (await customersResponse.json()) as Customer[];
          const productsData = (await productsResponse.json()) as Product[];
          const warehouseData = (await warehouseResponse.json()) as Warehouse[];
          setCustomers(customersData.filter((item) => item.active !== false));
          setProducts(productsData.filter((item) => item.active !== false));
          setUnits((await unitsResponse.json()) as Unit[]);
          if (pricesResponse.ok)
            setPrices((await pricesResponse.json()) as Price[]);
          const activeWarehouses = warehouseData.filter((warehouse: Warehouse) => warehouse.active);
          const filteredWarehouses = receiptType !== "İade Faturası"
            ? activeWarehouses
            : returnType === "Bozuk"
              ? activeWarehouses.filter((warehouse) => warehouse.type === "İade Deposu" || warehouse.type === "Iade Deposu")
              : activeWarehouses.filter((warehouse) => warehouse.type !== "Araç Deposu" && warehouse.type !== "Arac Deposu");
          setWarehouses(filteredWarehouses);
        },
      )
      .catch(() => undefined);
  }, [apiUrl, receiptType, returnType]);
  useEffect(() => {
    if (!customer) return;
    const m1 = customer.customerDiscount1 || "0";
    const m2 = customer.customerDiscount2 || "0";
    const m3 = customer.customerDiscount3 || "0";
    const deferred = customer.deferredDiscount || "0";
    const cash = customer.cashDiscount || "0";
    setDiscountRates({ m1, m2, m3, deferred, cash });
  }, [customer]);
  const filteredCustomers = customers.filter((item) => {
    const query = customerSearch.toLocaleLowerCase("tr-TR");
    return (
      !query ||
      [item.code, item.name, item.title, item.taxNo || ""].some((value) =>
        value.toLocaleLowerCase("tr-TR").includes(query),
      )
    );
  });
  const filteredProducts = products.filter((item) => {
    const query = productSearch.toLocaleLowerCase("tr-TR");
    return (
      !query ||
      [item.code, item.name, item.unit, item.vat].some((value) =>
        value.toLocaleLowerCase("tr-TR").includes(query),
      )
    );
  });
  const selectProduct = (item: Product) => {
    const firstUnit = units.find((unit) => unit.productCode === item.code);
    const price =
      prices.find(
        (itemPrice) =>
          itemPrice.productCode === item.code && itemPrice.status === "Aktif",
      ) || prices.find((itemPrice) => itemPrice.productCode === item.code);
    const selectedPrice =
      receiptType === "Alış Faturası"
        ? price?.purchasePrice
        : price?.salesPrice;
    const baseUnitPrice = selectedPrice || "0,00";
    const innerQuantity = firstUnit?.innerQuantity || "1";
    setProduct({
      ...emptyProduct(),
      code: item.code,
      name: item.name,
      unit: firstUnit?.unit || item.unit,
      innerQuantity,
      baseUnitPrice,
      unitPrice: (rate(baseUnitPrice) * rate(innerQuantity))
        .toFixed(2)
        .replace(".", ","),
      vatRate: rate(item.vat),
      productType: item.productType || "",
      category: item.category || "",
    });
    setProductPickerOpen(false);
    setProductSearch("");
  };
  useEffect(() => {
    const item = products.find(
      (productItem) =>
        productItem.code.toLocaleLowerCase("tr-TR") ===
        product.code.trim().toLocaleLowerCase("tr-TR"),
    );
    if (item && product.name !== item.name) selectProduct(item);
  }, [product.code, products]);
  const productUnits = units.filter(
    (item) => item.productCode === product.code,
  );
  const subtotal = basket.reduce(
    (sum, item) => sum + Number(item.total.replace(",", ".")),
    0,
  );

  const today = form.date;
  const unitFactor = (productCode: string, unitName: string) => {
    const unit = units.find((item) => item.productCode === productCode && item.unit === unitName);
    return unit ? rate(unit.innerQuantity) : 0;
  };
  const regularBasket = basket.filter((item) => !item.isPromotional);
  const promotionBaseQuantity = (promotion: Promotion) => {
    const qualifyingLines = regularBasket.filter((item) => promotion.productCodes.length === 0 || promotion.productCodes.includes(item.code));
    if (!qualifyingLines.length) return { baseQuantity: 0, thresholdBase: 0 };
    const referenceLine = qualifyingLines[0];
    const conditionFactor = unitFactor(referenceLine.code, promotion.conditionUnit);
    const baseQuantity = qualifyingLines.reduce((sum, item) => sum + rate(item.quantity) * rate(item.innerQuantity), 0);
    return { baseQuantity, thresholdBase: Number(promotion.threshold) * conditionFactor };
  };
  const promotionMultiplier = (promotion: Promotion) => {
    if (promotion.conditionType !== "min_quantity_product") return 1;
    const { baseQuantity, thresholdBase } = promotionBaseQuantity(promotion);
    return thresholdBase > 0 ? Math.floor(baseQuantity / thresholdBase) : 0;
  };
  const promotionMatchesScope = (promotion: Promotion) => {
    const matches = (selected: string[], value: string | undefined) => selected.length === 0 || Boolean(value && selected.includes(value));
    const customerMatches = matches(promotion.customerCodes, customer?.code)
      && matches(promotion.customerTypeCodes, customer?.type)
      && matches(promotion.customerGroupCodes, customer?.customerGroupCode);
    const productMatches = regularBasket.some((item) => matches(promotion.productCodes, item.code)
      && matches(promotion.productTypeCodes, item.productType)
      && matches(promotion.productGroupCodes, item.productGroup));
    const thresholdMatches = promotion.conditionType === "min_basket_amount"
      ? subtotal >= promotion.threshold
      : promotion.conditionType === "min_distinct_sku"
        ? new Set(regularBasket.filter((item) => matches(promotion.productCodes, item.code)).map((item) => item.code)).size >= promotion.threshold
        : promotionMultiplier(promotion) >= 1;
    return promotion.active && promotion.startDate <= today && (!promotion.endDate || promotion.endDate >= today) && customerMatches && productMatches && thresholdMatches;
  };
  const eligiblePromotions = (receiptType === "Satış Faturası" || receiptType === "Sipariş")
    ? promotions.filter((promotion) => (promotion.rewardType === "free_goods" || promotion.rewardType === "discount") && promotionMatchesScope(promotion)).sort((left, right) => right.priority - left.priority)
    : [];
  const eligiblePromotion = eligiblePromotions.find((promotion) => promotion.id === selectedPromotionId) || (eligiblePromotions.length === 1 ? eligiblePromotions[0] : undefined);
  useEffect(() => {
    if (eligiblePromotions.length <= 1) {
      setPromotionPickerOpen(false);
      setSelectedPromotionId(eligiblePromotions[0]?.id ?? null);
      return;
    }
    if (!eligiblePromotions.some((promotion) => promotion.id === selectedPromotionId)) {
      setSelectedPromotionId(null);
      setPromotionPickerOpen(true);
    }
  }, [eligiblePromotions.map((promotion) => promotion.id).join(','), selectedPromotionId]);
  useEffect(() => {
    if (eligiblePromotion?.rewardType !== "free_goods") {
      setBasket((current) => current.filter((item) => !item.isPromotional));
      return;
    }
    const rewardCodes = eligiblePromotion?.rewardProductCodes ?? [];
    setBasket((current) => {
      const regularLines = current.filter((item) => !item.isPromotional);
      if (!eligiblePromotion || rewardCodes.length === 0) return regularLines;
      if (rewardCodes.length > 1 && rewardPickerPromotionId !== eligiblePromotion.id) {
        setRewardPickerPromotionId(eligiblePromotion.id);
        setSelectedRewardCode(null);
        setRewardPickerOpen(true);
        return regularLines;
      }
      const selectedCodes = rewardCodes.length === 1 ? rewardCodes : selectedRewardCode ? [selectedRewardCode] : [];
      if (selectedCodes.length === 0) return regularLines;
      const rewardQuantity = Math.max(1, Number(eligiblePromotion.rewardValue || 1)) * promotionMultiplier(eligiblePromotion);
      const rewardLines = selectedCodes.flatMap((code) => {
        const item = products.find((product) => product.code === code);
        if (!item) return [];
        const unit = units.find((entry) => entry.productCode === code);
        const rewardUnit = eligiblePromotion.rewardProductUnits?.[code];
        const selectedRewardUnit = units.find((entry) => entry.productCode === code && entry.unit === rewardUnit);
        if (!selectedRewardUnit) return [];
        return [{
          code, product: item.name, quantity: String(rewardQuantity), unit: selectedRewardUnit.unit,
          innerQuantity: selectedRewardUnit.innerQuantity || unit?.innerQuantity || "1", unitPrice: "0,00", discount1: "0", discount2: "0",
          vatRate: rate(item.vat), productType: item.productType || "", productGroup: item.category || "",
          gross: "0,00", total: "0,00", isPromotional: true,
        }];
      });
      return [...regularLines, ...rewardLines];
    });
  }, [eligiblePromotion?.id, products, units, rewardPickerPromotionId, selectedRewardCode]);

  // Ürün iskontosu (İsk1, İsk2)
  const subtotalGross = basket.reduce(
    (sum, item) => sum + Number(item.gross.replace(",", ".")),
    0,
  );
  const productDiscountAmount = subtotalGross - subtotal;

  // Müşteri indirimi (M1, M2, M3)
  let subtotalAfterCustomerDiscount = subtotal;
  const customerDiscounts = [
    discounts.m1 ? rate(discountRates.m1) : 0,
    discounts.m2 ? rate(discountRates.m2) : 0,
    discounts.m3 ? rate(discountRates.m3) : 0,
  ].filter((d) => d > 0);
  customerDiscounts.forEach((discountRate) => {
    subtotalAfterCustomerDiscount =
      subtotalAfterCustomerDiscount * (1 - discountRate / 100);
  });
  const customerDiscountAmount = subtotal - subtotalAfterCustomerDiscount;
  const promotionDiscountAmount = eligiblePromotion?.rewardType === "discount"
    ? subtotalAfterCustomerDiscount * (Number(eligiblePromotion.rewardValue || 0) / 100)
    : 0;
  subtotalAfterCustomerDiscount -= promotionDiscountAmount;

  // Ödeme indirimi (Vadeli, Peşin)
  let grandTotal = subtotalAfterCustomerDiscount;
  const paymentDiscounts = [
    discounts.deferred ? rate(discountRates.deferred) : 0,
    discounts.cash ? rate(discountRates.cash) : 0,
  ].filter((d) => d > 0);
  paymentDiscounts.forEach((discountRate) => {
    grandTotal = grandTotal * (1 - discountRate / 100);
  });
  const paymentDiscountAmount = subtotalAfterCustomerDiscount - grandTotal;
  const totalDiscountAmount = subtotalGross - grandTotal;

  // KDV hesaplaması - her ürün için ayrı ayrı
  const vatAmounts = basket.map((item) => {
    // Her ürünün net tutarı (İsk1+İsk2 uygulanmış)
    let netAmount = Number(item.total.replace(",", "."));

    // Müşteri iskontosunu uygula
    customerDiscounts.forEach((discountRate) => {
      netAmount = netAmount * (1 - discountRate / 100);
    });


    // Ödeme iskontosunu uygula
    paymentDiscounts.forEach((discountRate) => {
      netAmount = netAmount * (1 - discountRate / 100);
    });

    if (promotionDiscountAmount > 0 && subtotalAfterCustomerDiscount + promotionDiscountAmount > 0) {
      netAmount *= subtotalAfterCustomerDiscount / (subtotalAfterCustomerDiscount + promotionDiscountAmount);
    }

    // KDV tutarını hesapla
    const vat = netAmount * (item.vatRate / 100);
    return { vatRate: item.vatRate, vat };
  });

  // KDV oranlarına göre grupla
  const vat1 = vatAmounts
    .filter((item) => item.vatRate === 1)
    .reduce((sum, item) => sum + item.vat, 0);
  const vat10 = vatAmounts
    .filter((item) => item.vatRate === 10)
    .reduce((sum, item) => sum + item.vat, 0);
  const vat20 = vatAmounts
    .filter((item) => item.vatRate === 20)
    .reduce((sum, item) => sum + item.vat, 0);
  const totalVat = vat1 + vat10 + vat20;
  const finalTotal = grandTotal + totalVat;
  useEffect(() => {
    const content = rate(product.innerQuantity);
    const basePrice = rate(product.baseUnitPrice);
    if (content > 0 && basePrice >= 0) {
      const calculatedPrice = (basePrice * content)
        .toFixed(2)
        .replace(".", ",");
      if (product.unitPrice !== calculatedPrice)
        setProduct((current) => ({ ...current, unitPrice: calculatedPrice }));
    }
  }, [product.baseUnitPrice, product.innerQuantity]);
  const selectedUnitContent =
    warehouseStock === null || !product.innerQuantity
      ? null
      : warehouseStock / rate(product.innerQuantity);
  useEffect(() => {
    if (!form.depot || !product.code) return setWarehouseStock(null);
    fetch(
      `${apiUrl}/inventory/stock?warehouseCode=${encodeURIComponent(form.depot)}&productCode=${encodeURIComponent(product.code)}`,
      { headers: authHeaders },
    )
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then((stock: { baseQuantity: number }) =>
        setWarehouseStock(stock.baseQuantity),
      )
      .catch(() => setWarehouseStock(null));
  }, [apiUrl, form.depot, product.code, authHeaders]);
  const addProduct = () => {
    const quantity = rate(product.quantity);
    const price = rate(product.unitPrice);
    const innerQuantity = rate(product.innerQuantity);
    if (!product.code || !product.name) return window.alert("Ürün seçiniz.");
    if (!quantity || quantity <= 0)
      return window.alert("Miktar sıfırdan büyük olmalıdır.");
    if (!innerQuantity || innerQuantity <= 0)
      return window.alert("Ürün birim adedi bulunamadı.");
    const requestedBaseQuantity = quantity * innerQuantity;
    if (warehouseStock !== null && warehouseStock < requestedBaseQuantity) {
      const confirmed = window.confirm(`Bu stok miktarı yetersiz. Mevcut stok: ${warehouseStock}, istenen: ${requestedBaseQuantity}. Eksi stoğa düşerek eklemek istediğinize emin misiniz?`);
      if (!confirmed) return;
    }
    const gross = quantity * price;
    const net = calculateProductNet(gross, product.discount1, product.discount2);
    setSelectedPromotionId(null);
    setPromotionPickerOpen(false);
    setRewardPickerPromotionId(null);
    setSelectedRewardCode(null);
    setRewardPickerOpen(false);
    setBasket((current) => [
      ...current,
      {
        code: product.code,
        product: product.name,
        productType: product.productType || "",
        productGroup: product.category || "",
        quantity: product.quantity,
        unit: product.unit || "-",
        innerQuantity: product.innerQuantity,
        unitPrice: product.unitPrice,
        discount1: product.discount1,
        discount2: product.discount2,
        vatRate: product.vatRate,
        gross: gross.toFixed(2).replace(".", ","),
        total: net.toFixed(2).replace(".", ","),
      },
    ]);
    setProduct(emptyProduct());
  };
  const removeBasketLine = (indexToRemove: number) => {
    setBasket((current) =>
      current.filter((_, index) => index !== indexToRemove),
    );
    window.alert("Ürün sepetten çıkarıldı.");
  };
  useEffect(() => {
    const handleDoubleClick = (event: MouseEvent) => {
      const row = (event.target as HTMLElement).closest(
        ".invoice-basket tbody tr",
      );
      if (!row || !row.parentElement) return;
      const index = Array.from(row.parentElement.children).indexOf(row);
      if (index >= 0) removeBasketLine(index);
    };
    document.addEventListener("dblclick", handleDoubleClick);
    return () => document.removeEventListener("dblclick", handleDoubleClick);
  }, []);
  const save = async () => {
    if (!customer) return window.alert("Cari veya müşteri seçiniz.");
    if (!basket.length)
      return window.alert("Faturaya en az bir ürün ekleyiniz.");
    if (!form.depot) return window.alert("Depo seçiniz.");
    if (receiptType === "Sipariş") {
      const response = await fetch(`${apiUrl}/orders`, {
        method: "POST",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({
          orderNo: form.no,
          orderDate: form.date,
          customerCode: customer.code,
          warehouseCode: form.depot,
          totalAmount: finalTotal,
          stockReserved: orderStockReservation === true,
          lines: basket.map((line) => ({
            productCode: line.code,
            productName: line.product,
            unit: line.unit,
            quantity: rate(line.quantity),
            innerQuantity: rate(line.innerQuantity),
            unitPrice: rate(line.unitPrice),
            lineTotal: rate(line.total),
          })),
        }),
      });
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        return window.alert(result.error || "Sipariş kaydedilemedi.");
      }
      const savedOrder = (await response.json()) as { id?: number };
      onSaved?.({
        id: savedOrder.id,
        no: form.no,
        date: form.date,
        customer: customer.title || customer.name,
        total: finalTotal.toFixed(2).replace(".", ","),
        saleType,
      });
      return;
    }
    if (receiptType === "Alış Faturası" || receiptType === "İade Faturası") {
      const endpoint = receiptType === "Alış Faturası" ? "purchase-invoices" : "return-invoices";
      const response = await fetch(`${apiUrl}/${endpoint}`, {
        method: "POST",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({
          invoiceNo: form.no,
          invoiceDate: form.date,
          customerCode: customer.code,
          customerName: customer.title || customer.name,
          warehouseCode: form.depot,
          totalAmount: finalTotal,
          returnType: receiptType === "İade Faturası" ? returnType : undefined,
          lines: basket.map((line) => ({
            productCode: line.code,
            productName: line.product,
            unit: line.unit,
            quantity: rate(line.quantity),
            innerQuantity: rate(line.innerQuantity),
            unitPrice: rate(line.unitPrice),
            lineTotal: rate(line.total),
          })),
        }),
      });
      if (!response.ok) { const result = await response.json().catch(() => ({})); return window.alert(result.error || `${receiptType} kaydedilemedi.`); }
      const savedDocument = (await response.json()) as { id?: number };
      onSaved?.({ id: savedDocument.id, no: form.no, date: form.date, customer: customer.title || customer.name, total: finalTotal.toFixed(2).replace('.', ','), saleType });
      return;
    }
    if (receiptType !== "Satış Faturası") return window.alert(`${receiptType} kaydedildi.`);
    const response = await fetch(`${apiUrl}/sales-invoices`, {
      method: "POST",
      headers: { ...authHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({
        invoiceNo: form.no, invoiceDate: form.date, customerCode: customer.code, customerName: customer.title || customer.name,
        salesRepresentative: customer.salesRepresentative || "", saleType, warehouseCode: form.depot, totalAmount: finalTotal,
        lines: basket.map((line) => ({ productCode: line.code, productName: line.product, unit: line.unit, quantity: rate(line.quantity), innerQuantity: rate(line.innerQuantity), unitPrice: rate(line.unitPrice), lineTotal: rate(line.total), isPromotional: line.isPromotional === true })),
      }),
    });
    if (!response.ok) { const result = await response.json().catch(() => ({})); return window.alert(result.error || "Satış faturası kaydedilemedi."); }
    const savedInvoice = (await response.json()) as { id?: number };
    onSaved?.({ id: savedInvoice.id, no: form.no, date: form.date, customer: customer.title || customer.name, total: finalTotal.toFixed(2).replace('.', ','), saleType });
  };
  return (
    <div className={`invoice-entry-window invoice-entry-${receiptType === "Alış Faturası" ? "purchase" : receiptType === "İade Faturası" ? "return" : receiptType === "Sipariş" ? "order" : "sales"}`}>
      {orderStockReservationDialogOpen && (
        <div className="customer-picker-backdrop">
          <section
            className="unit-prompt-dialog"
            onClick={(event) => event.stopPropagation()}
          >
            <h2>Stok Rezervasyonu</h2>
            <p>
              Bu siparişin ürünleri ilgili depo stoklarından rezerve edilip
              düşülsün mü?
            </p>
            <div className="dialog-actions">
              <button
                className="secondary-action"
                onClick={() => {
                  setOrderStockReservation(false);
                  setOrderStockReservationDialogOpen(false);
                }}
                type="button"
              >
                Hayır
              </button>
              <button
                className="primary-action"
                onClick={() => {
                  setOrderStockReservation(true);
                  setOrderStockReservationDialogOpen(false);
                }}
                type="button"
              >
                Evet
              </button>
            </div>
          </section>
        </div>
      )}
      <div className="invoice-entry-main">
        <section className="invoice-entry-header">
          {saleType && <div className="invoice-sale-type-badge">{saleType}</div>}
          {receiptType !== "Satış Faturası" && receiptType !== "Sipariş" && <div className="receipt-form-kind">{receiptType}</div>}
          <div className="invoice-customer-block">
            <button
              aria-label="Cari ara"
              className="invoice-search-button"
              onClick={() => setCustomerPickerOpen(true)}
              type="button"
            >
              <Search size={19} />
            </button>
            <button
              className="invoice-customer-input"
              onClick={() => setCustomerPickerOpen(true)}
              type="button"
            >
              {customer
                ? `${customer.code} · ${customer.name} · ${customer.title}`
                : "Cari / müşteri seçiniz"}
            </button>
            <div className="invoice-customer-summary">
              <span>
                Vergi Dairesi <b>{customer?.taxOffice || "-"}</b>
              </span>
              <span>
                Vergi No <b>{customer?.taxNo || "-"}</b>
              </span>
              <span>
                Bakiye <b>{customer?.balance || "0,00"}</b>
              </span>
              <span>
                Satış Temsilcisi <b>{customer?.salesRepresentative || "-"}</b>
              </span>
            </div>
          </div>
          <div className="invoice-meta-grid">
            <label>
              Tarih
              <input
                type="date"
                value={form.date}
                onChange={(event) => {
                  const date = event.target.value;
                  setForm({ ...form, date, dueDate: addDays(date, 15) });
                }}
              />
            </label>
            <label>
              Fatura No
              <input
                value={form.no}
                onChange={(event) =>
                  setForm({ ...form, no: event.target.value })
                }
              />
            </label>
            <label>
              Depo Adı
              <select
                value={form.depot}
                onChange={(event) =>
                  setForm({ ...form, depot: event.target.value })
                }
              >
                <option value="">Depo seçiniz</option>
                {warehouses.map((warehouse) => (
                  <option key={warehouse.code} value={warehouse.code}>
                    {warehouse.name} ({warehouse.code})
                  </option>
                ))}
              </select>
            </label>
            <label>
              Ödeme Türü
              <select
                value={form.payment}
                onChange={(event) =>
                  setForm({ ...form, payment: event.target.value })
                }
              >
                <option>Diğer</option>
                <option>Nakit</option>
                <option>Vadeli</option>
              </select>
            </label>
            <label>
              Vade Tarihi
              <input
                type="date"
                value={form.dueDate}
                onChange={(event) =>
                  setForm({ ...form, dueDate: event.target.value })
                }
              />
            </label>
            <label>
              Not
              <input
                value={form.note}
                onChange={(event) =>
                  setForm({ ...form, note: event.target.value })
                }
              />
            </label>
            {discountLabels.map(([key, label]) => (
              <label className="invoice-discount-field" key={key}>
                <span className="invoice-discount-label">
                  <input
                    checked={discounts[key]}
                    onChange={(event) =>
                      setDiscounts({
                        ...discounts,
                        [key]: event.target.checked,
                      })
                    }
                    type="checkbox"
                  />{" "}
                  {label} %
                </span>
                <input readOnly value={discountRates[key]} />
              </label>
            ))}
          </div>
        </section>
        <section className="invoice-basket">
          <div className="invoice-basket-empty">
            {basket.length ? (
              <table>
                <thead>
                  <tr>
                    <th>Kod</th>
                    <th>Ürün</th>
                    <th>Miktar</th>
                    <th>Birim</th>
                    <th>Birim Fiyatı</th>
                    <th>İsk 1</th>
                    <th>İsk 2</th>
                    <th>KDV %</th>
                    <th>Toplam</th>
                  </tr>
                </thead>
                <tbody>
                  {basket.map((item, index) => (
                    <tr key={`${item.code}-${index}`}>
                      <td>{item.code}</td>
                      <td>{item.product}</td>
                      <td>{item.quantity}</td>
                      <td>{item.unit}</td>
                      <td>{item.unitPrice}</td>
                      <td>{item.discount1}%</td>
                      <td>{item.discount2}%</td>
                      <td>{item.vatRate}%</td>
                      <td>{item.total}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              "Sepete ürün eklemek için aşağıdaki ürün alanını kullanın."
            )}
          </div>
        </section>
        {form.depot !== "" && customer !== null ? (
          <section className="invoice-product-entry">
            <div className="invoice-product-fields">
              <label>
                Ürün Kodu
                <div className="invoice-product-code-field">
                  <input
                    value={product.code}
                    onChange={(event) =>
                      setProduct({ ...product, code: event.target.value })
                    }
                  />
                  <button
                    aria-label="Ürün ara"
                    onClick={() => setProductPickerOpen(true)}
                    type="button"
                  >
                    <Search size={15} />
                  </button>
                </div>
              </label>
              <label>
                Ürün Adı
                <input value={product.name} readOnly />
              </label>
              <label>
                Birim İçeriği
                <div className="entry-info-value">
                  {product.innerQuantity || "-"}
                </div>
              </label>
              <label>
                Depodaki Stok
                <div className="entry-info-value entry-stock-value">
                  {selectedUnitContent === null
                    ? "-"
                    : `${selectedUnitContent} ${product.unit || ""}`}
                </div>
              </label>
              <label>
                Miktar
                <input
                  value={product.quantity}
                  onChange={(event) =>
                    setProduct({ ...product, quantity: event.target.value })
                  }
                />
              </label>
              <label>
                Birim
                <select
                  value={product.unit}
                  onChange={(event) => {
                    const selected = productUnits.find(
                      (item) => item.unit === event.target.value,
                    );
                    setProduct({
                      ...product,
                      unit: event.target.value,
                      innerQuantity: selected?.innerQuantity || "",
                    });
                  }}
                >
                  <option value="">Birim</option>
                  {productUnits.map((item) => (
                    <option key={item.barcode} value={item.unit}>
                      {item.unit}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Birim Fiyatı
                <input
                  value={product.unitPrice}
                  onChange={(event) =>
                    setProduct({ ...product, unitPrice: event.target.value })
                  }
                />
              </label>
              <label>
                İsk 1
                <input
                  value={product.discount1}
                  onChange={(event) =>
                    setProduct({ ...product, discount1: event.target.value })
                  }
                />
              </label>
              <label>
                İsk 2
                <input
                  value={product.discount2}
                  onChange={(event) =>
                    setProduct({ ...product, discount2: event.target.value })
                  }
                />
              </label>
              <label>
                Toplam
                <div className="entry-info-value entry-total-value">
                  {product.quantity && product.unitPrice
                    ? calculateProductNet(
                        rate(product.quantity) * rate(product.unitPrice),
                        product.discount1,
                        product.discount2,
                      ).toFixed(2)
                    : "0,00"}
                </div>
              </label>
              <button
                className="invoice-add-button"
                onClick={addProduct}
                type="button"
              >
                Ekle
              </button>
            </div>
          </section>
        ) : (
          <div style={{ padding: "20px", textAlign: "center", color: "#999" }}>
            Ürün seçmek için önce cari/müşteri ve depo seçiniz
          </div>
        )}
      </div>
      <aside className="invoice-summary">
        <h2>Fatura Alt Bilgileri</h2>
        <div className="invoice-summary-lines">
          <span>
            Ödeme İndirimi{" "}
            <b>{paymentDiscountAmount.toFixed(2).replace(".", ",")}</b>
          </span>
          <span>
            Müşteri İndirimi{" "}
            <b>{customerDiscountAmount.toFixed(2).replace(".", ",")}</b>
          </span>
          <span>
            Ürün İndirimi{" "}
            <b>{productDiscountAmount.toFixed(2).replace(".", ",")}</b>
          </span>
          {promotionDiscountAmount > 0 && (
            <span>
              Promosyon İskontosu{" "}
              <b>{promotionDiscountAmount.toFixed(2).replace(".", ",")}</b>
            </span>
          )}
          <span>
            Bedelsiz Ürün <b>{basket.filter((item) => item.isPromotional).reduce((sum, item) => sum + rate(item.quantity), 0).toFixed(2).replace(".", ",")}</b>
          </span>
          <span>
            E-Puan İndirimi <b>0,00</b>
          </span>
          <span>
            Sepet Toplamı <b>{subtotalGross.toFixed(2).replace(".", ",")}</b>
          </span>
          <span>
            Toplam İndirim{" "}
            <b>{totalDiscountAmount.toFixed(2).replace(".", ",")}</b>
          </span>
          <strong>
            Ara Toplam{" "}
            <b>{subtotalAfterCustomerDiscount.toFixed(2).replace(".", ",")}</b>
          </strong>
          <span>
            Kdv %1 <b>{vat1.toFixed(2).replace(".", ",")}</b>
          </span>
          <span>
            Kdv %10 <b>{vat10.toFixed(2).replace(".", ",")}</b>
          </span>
          <span>
            Kdv %20 <b>{vat20.toFixed(2).replace(".", ",")}</b>
          </span>
          <strong>
            Genel Toplam <b>{finalTotal.toFixed(2).replace(".", ",")}</b>
          </strong>
          <span>
            Toplam Çeşit <b>{basket.length}</b>
          </span>
          <span>
            Toplam Kalem{" "}
            <b>{basket.reduce((sum, item) => sum + rate(item.quantity), 0)}</b>
          </span>
          <span>
            Toplam Ağırlık <b>0,00</b>
          </span>
          <span>
            Toplam Hacim <b>0,00</b>
          </span>
          <span>
            Toplam E-Puan <b>0,00</b>
          </span>
        </div>
        <button className="invoice-save-button" onClick={save} type="button">
          Kaydet
        </button>
        <button className="invoice-cancel-button" type="button">
          Vazgeç
        </button>
      </aside>
      {promotionPickerOpen && eligiblePromotions.length > 1 && (
        <div className="customer-picker-backdrop">
          <section className="customer-picker-dialog promotion-reward-dialog" onClick={(event) => event.stopPropagation()}>
            <div className="definition-panel-heading">
              <div>
                <p className="definition-kicker">PROMOSYON SEÇİMİ</p>
                <h2>Uygulanacak promosyonu seçiniz</h2>
              </div>
            </div>
            <p className="dialog-hint">Birden fazla promosyon koşulu sağlandı. Satış faturasında yalnızca bir promosyon uygulanabilir.</p>
            <div className="promotion-reward-list">
              {eligiblePromotions.map((promotion) => (
                <label key={promotion.id}>
                  <input checked={selectedPromotionId === promotion.id} onChange={() => setSelectedPromotionId(promotion.id)} type="radio" name="eligible-promotion" />
                  <span><strong>{promotion.code}</strong> · {promotion.name} · {promotion.rewardType === "discount" ? `%${promotion.rewardValue} iskonto` : "Mal fazlası / bedelsiz ürün"}</span>
                </label>
              ))}
            </div>
            <div className="dialog-actions"><button className="primary-action" disabled={!selectedPromotionId} onClick={() => setPromotionPickerOpen(false)} type="button">Promosyonu uygula</button></div>
          </section>
        </div>
      )}
      {rewardPickerOpen && eligiblePromotion && (
        <div className="customer-picker-backdrop" onClick={() => setRewardPickerOpen(false)}>
          <section className="customer-picker-dialog promotion-reward-dialog" onClick={(event) => event.stopPropagation()}>
            <div className="definition-panel-heading">
              <div>
                <p className="definition-kicker">PROMOSYON ÖDÜLÜ</p>
                <h2>Bedelsiz ürün seçiniz</h2>
              </div>
              <button className="ghost-button" onClick={() => setRewardPickerOpen(false)} type="button">Kapat</button>
            </div>
            <p className="dialog-hint">Promosyon koşulu tamamlandı. Aşağıdaki ürünlerden birini bedelsiz olarak seçebilirsiniz.</p>
            <div className="promotion-reward-list">
              {eligiblePromotion.rewardProductCodes.map((code) => {
                const rewardProduct = products.find((item) => item.code === code);
                if (!rewardProduct) return null;
                return <label key={code}><input checked={selectedRewardCode === code} onChange={() => setSelectedRewardCode(code)} type="checkbox" /><span><strong>{code}</strong> · {rewardProduct.name}</span></label>;
              })}
            </div>
            <div className="dialog-actions"><button className="primary-action" disabled={!selectedRewardCode} onClick={() => setRewardPickerOpen(false)} type="button">Ürünü ekle</button></div>
          </section>
        </div>
      )}
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
              onChange={(event) => setCustomerSearch(event.target.value)}
              placeholder="Cari filtrele..."
              value={customerSearch}
            />
            <div className="customer-picker-list">
              {filteredCustomers.map((item) => (
                <button
                  key={item.code}
                  onClick={() => {
                    if (!item.salesRepresentative?.trim()) {
                      setCustomer(null);
                      setCustomerPickerOpen(false);
                      setCustomerSearch("");
                      window.alert("Müşteri carisine satış temsilcisi atayın.");
                      onMissingSalesRepresentative?.();
                      return;
                    }
                    setCustomer(item);
                    setCustomerPickerOpen(false);
                    setCustomerSearch("");
                  }}
                  type="button"
                >
                  <strong>{item.name}</strong>
                  <span>
                    {item.code} · {item.title}
                  </span>
                </button>
              ))}
            </div>
          </section>
        </div>
      )}
      {productPickerOpen && (
        <div
          className="customer-picker-backdrop"
          onClick={() => setProductPickerOpen(false)}
        >
          <section
            className="customer-picker-dialog"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="definition-panel-heading">
              <h2>Ürün Listesi</h2>
              <button
                className="ghost-button"
                onClick={() => setProductPickerOpen(false)}
                type="button"
              >
                Kapat
              </button>
            </div>
            <input
              autoFocus
              className="customer-picker-search"
              onChange={(event) => setProductSearch(event.target.value)}
              placeholder="Ürün kodu, adı veya birimi filtrele..."
              value={productSearch}
            />
            <div className="customer-picker-list">
              {filteredProducts.map((item) => (
                <button
                  key={item.code}
                  onClick={() => selectProduct(item)}
                  type="button"
                >
                  <strong>
                    {item.code} · {item.name}
                  </strong>
                  <span>
                    Birim: {item.unit} · KDV: {item.vat}
                  </span>
                </button>
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
