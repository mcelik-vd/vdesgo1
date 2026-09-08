# Merkez Promosyon Politikası

## Status
Kararlaştırılmış / İmplementasyon Hazırlık — VD Gıda tarafından onaylanmış kurallar

## Otorite
**VD Gıda** — tüm promosyon kararları merkezi olarak alınır. Dağıtıcı ve satış temsilcileri sadece istisnai talep yapabilir.

---

## 1. Promosyon Seçim Algoritması (Kurallı Seçim)

### Kural 1: Sadece BİR Promosyon Uygulanır
Aynı order'de hiçbir zaman 2+ promosyon aynı anda uygulanmaz. Uygun promosyonlar varsa, **EN UYGUN BİRİ** seçilir.

### Kural 2: "En Uygun" Promosyon Tanımı
Uygunluk sırası (azalan):

1. **Tür Önceliği:**
   - **Tier 1:** Bedava Ürün (free_goods) — HER ZAMAN SEÇİLİR
   - **Tier 2:** % İskonto (percentage_discount)
   - **Tier 3:** Sabit Tutar İskonto (fixed_discount)

2. **Aynı Tür İçinde:**
   - **Priority Değeri** (yüksek sayı = yüksek öncelik)
   - Tie-breaker: `created_at` (eski promosyon kazanır)

### Kural 3: Seçim Algoritması (Pseudocode)

```typescript
function selectBestPromotion(eligiblePromotions: Promotion[]): Promotion | null {
  if (!eligiblePromotions.length) return null;
  
  // Adım 1: Bedava ürün promosyonları ayır
  const freeGoodsPromotions = eligiblePromotions.filter(
    p => p.reward_type === 'free_goods'
  );
  
  // Adım 2: Bedava ürün varsa, en yüksek priority'si seç
  if (freeGoodsPromotions.length > 0) {
    return selectByPriority(freeGoodsPromotions);
  }
  
  // Adım 3: Bedava yoksa, % iskonto promosyonları ayır
  const percentDiscountPromotions = eligiblePromotions.filter(
    p => p.reward_type === 'percentage_discount'
  );
  if (percentDiscountPromotions.length > 0) {
    return selectByPriority(percentDiscountPromotions);
  }
  
  // Adım 4: % iskonto yoksa, sabit tutar iskonto
  const fixedDiscountPromotions = eligiblePromotions.filter(
    p => p.reward_type === 'fixed_discount'
  );
  if (fixedDiscountPromotions.length > 0) {
    return selectByPriority(fixedDiscountPromotions);
  }
  
  return null;
}

function selectByPriority(promotions: Promotion[]): Promotion {
  // Priority'ye göre sırala (yüksek önce)
  promotions.sort((a, b) => {
    if (b.priority !== a.priority) {
      return (b.priority || 0) - (a.priority || 0);
    }
    // Tie-breaker: eski (created_at) kazanır
    return a.created_at.getTime() - b.created_at.getTime();
  });
  
  return promotions[0];
}
```

---

## 2. Örnek Senaryolar

### Senaryo 1: Bedava Ürün vs % İskonto

```
Order: 10 koli Ürün A

Promosyon 1: 10 koli → 1 koli bedava
  - reward_type: free_goods
  - priority: 50
  
Promosyon 2: 10 koli → %10 iskonto
  - reward_type: percentage_discount
  - priority: 100

SONUÇ: Promosyon 1 seçilir (Bedava > % iskonto)
Müşteri: 1 koli bedaya alır
```

### Senaryo 2: İki Bedava Ürün Promosyonu (Priority Farkı)

```
Order: 20 koli Ürün B

Promosyon 1: 20 koli → 1 koli bedava
  - reward_type: free_goods
  - priority: 50
  - created_at: 2026-08-01
  
Promosyon 2: 20 koli → 2 koli bedava
  - reward_type: free_goods
  - priority: 100
  - created_at: 2026-08-15

SONUÇ: Promosyon 2 seçilir (Priority 100 > 50)
Müşteri: 2 koli bedaya alır
```

### Senaryo 3: Aynı Priority, Tie-breaker

```
Order: 15 koli Ürün C

Promosyon 1: 15 koli → %8 iskonto
  - reward_type: percentage_discount
  - priority: 75
  - created_at: 2026-07-20
  
Promosyon 2: 15 koli → %8 iskonto
  - reward_type: percentage_discount
  - priority: 75
  - created_at: 2026-08-10

SONUÇ: Promosyon 1 seçilir (Priority eşit, eski kazanır)
Müşteri: %8 iskonto (Promosyon 1)
```

### Senaryo 4: Bedava Ürün Priority'sine Rağmen Seçilir

```
Order: 5 koli Ürün D

Promosyon 1: 5 koli → 0,5 koli bedava (1. üründen)
  - reward_type: free_goods
  - priority: 10 (düşük)
  
Promosyon 2: 5 koli → %15 iskonto
  - reward_type: percentage_discount
  - priority: 100 (yüksek)

SONUÇ: Promosyon 1 seçilir (Bedava > % iskonto, priority'ne bakılmaz)
Müşteri: 0,5 koli bedaya alır (% iskonto verilmez)
```

---

## 3. Promosyon Koşulu ve Ödül Kombinasyonları

### Desteklenen Kombinasyonlar

| Koşul Tipi | Ödül Tipi | Örnek | Uygun |
|---|---|---|---|
| min_quantity_product | free_goods | 10 al → 1 bedava (aynı ürün) | ✅ |
| min_quantity_product | free_goods | 10 al → 2 farklı ürün bedava | ✅ |
| min_quantity_product | percentage_discount | 10 → %5 iskonto | ✅ |
| min_quantity_product | fixed_discount | 10 → 50 TL iskonto | ✅ |
| min_distinct_sku | free_goods | 8 farklı SKU → 1 bedava | ✅ |
| min_basket_amount | percentage_discount | 10.000 TL → %5 iskonto | ✅ |
| min_quantity_group | free_goods | Grupa ait 20 koli → 2 bedava | ✅ |

---

## 4. Promosyon Uygulanma Sırası (İş Akışı)

```
1. Müşteri + Dağıtıcı + Ürünler belirlendi
   ↓
2. FİYAT ÇÖZÜMLEMESİ (Decision 9 — base/volume/distributor/customer)
   ↓
3. Aktif promosyonları bul (tenant=VD_GIDA, tarih geçerli, status=active)
   ↓
4. Her promosyonun koşulunu kontrol et
   ↓
5. Uygun promosyonlar: [Prom1, Prom2, Prom3, ...]
   ↓
6. 👉 EN UYGUN BİRİNİ SEÇ (selectBestPromotion algoritması)
   ↓
7. Seçilen promosyonun ödülünü hesapla ve uygula
   ↓
8. promotion_applications'a kayıt (immutable snapshot)
   ↓
9. Inventory ledger hareketini oluştur (bedava ürünler dahil)
   ↓
10. Audit log kaydı
   ↓
11. Order tamamlandı
```

---

## 5. Priority Değer Kılavuzu (Tavsiye)

VD Gıda tarafından promosyon oluşturulurken priority atarken:

| Priority Aralığı | Kullanım | Örnek |
|---|---|---|
| 10–25 | Düşük öncelikli, "hediye" niteliğinde promosyonlar | Mevsimsel, az kârlı ürünler |
| 26–50 | Standart promosyonlar | Düzenli satış kampanyaları |
| 51–75 | Yüksek öncelikli, esas satış promosyonları | Büyük hacim hedefleri |
| 76–100 | En yüksek, stratejik promosyonlar | Yeni ürün lansmanı, pazar payı |

---

## 6. Promosyon Kaydı İçin Gerekli Bilgiler

Sistem bir promosyon oluşturduğunda mutlaka bu alanlar doldurulmalı:

- [ ] **promotion_type** — Açıklayıcı kategori (buy_x_get_y, quantity_discount, vb.)
- [ ] **condition_type** — min_quantity_product / min_distinct_sku / min_basket_amount / vb.
- [ ] **reward_type** — free_goods / percentage_discount / fixed_discount
- [ ] **priority** — 1–100 arası (ör: 50)
- [ ] **status** — draft / active / inactive
- [ ] **valid_from** — Başlangıç tarihi
- [ ] **valid_to** — Bitiş tarihi
- [ ] **target_type** — all / specific_customer / specific_distributor

---

## 7. Audit & Logging

Her promosyon uygulaması immutable şekilde kaydedilir:

```typescript
// promotion_applications tablosuna kaydedilen bilgiler
{
  id: uuid,
  order_id: uuid,
  promotion_id: uuid,
  promotion_snapshot: {
    code: "SUMMER2024",
    reward_type: "free_goods",
    reward_quantity: 1,
    reward_product_id: "PRD-123",
    applied_at: "2026-09-04T10:30:00Z"
  },
  applied_discount_amount: 0,
  applied_free_goods_quantity: 1,
  created_by: "vdesgo-system",
  created_at: "2026-09-04T10:30:00Z"
}
```

Promosyon tanımı değişse bile, bu kayıt hiç değişmez.

---

## 8. Dağıtıcı / Satış Temsilcisi İstisnai Talebii

Eğer sistem promosyon uygulamıyorsa veya başkasını uygulamışsa, dağıtıcı/satış temsilcisi istisnai talep gönderebilir:

```typescript
{
  order_id: uuid,
  requester_role: "sales_representative" | "distributor_admin",
  requested_promotion_id: uuid, // Hangi promosyonun uygulanmasını istediği
  reason: "Müşteri özel anlaşma vardı",
  status: "pending", // pending / approved / rejected
  approved_by: "vd_gida_admin",
  approval_date: "2026-09-04T14:00:00Z"
}
```

İstisnai talep **VD Gıda tarafından onaylanmalıdır**. Onaylanırsa, order'a manuel ek indirim/bedava ürün eklenebilir.

---

## 9. Teknik Implementasyon Notları

### Veritabanı Tasarımı

```sql
-- Promosyon tanımı
CREATE TABLE promotions (
  id UUID PRIMARY KEY,
  tenant_id VARCHAR(50) NOT NULL DEFAULT 'VD_GIDA',
  code VARCHAR(50) UNIQUE,
  name VARCHAR(255) NOT NULL,
  promotion_type VARCHAR(50),
  status VARCHAR(20) DEFAULT 'draft',
  priority INT DEFAULT 0,
  valid_from DATE NOT NULL,
  valid_to DATE NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Promosyon koşulu
CREATE TABLE promotion_conditions (
  id UUID PRIMARY KEY,
  promotion_id UUID NOT NULL REFERENCES promotions(id),
  condition_type VARCHAR(50) NOT NULL,
  min_quantity INT,
  min_amount NUMERIC(12,2),
  product_id UUID REFERENCES products(id),
  tier_level INT DEFAULT 1
);

-- Promosyon ödülü
CREATE TABLE promotion_rewards (
  id UUID PRIMARY KEY,
  promotion_id UUID NOT NULL REFERENCES promotions(id),
  reward_type VARCHAR(50) NOT NULL, -- free_goods, percentage_discount, fixed_discount
  reward_product_id UUID REFERENCES products(id),
  reward_quantity NUMERIC(10,2),
  discount_percentage NUMERIC(5,2),
  discount_amount NUMERIC(12,2),
  tier_level INT DEFAULT 1
);

-- Uygulandı kayıtları (immutable)
CREATE TABLE promotion_applications (
  id UUID PRIMARY KEY,
  order_id UUID NOT NULL REFERENCES orders(id),
  promotion_id UUID NOT NULL REFERENCES promotions(id),
  promotion_snapshot JSONB NOT NULL,
  applied_at TIMESTAMP DEFAULT NOW()
);
```

### Uygulama Kodu (TypeScript)

```typescript
// Promosyon seçim motoru
class PromotionEngine {
  /**
   * Order'daki uygun promosyonları bul ve EN UYGUN BİRİNİ seç
   */
  async selectPromotion(
    orderLineItems: OrderLineItem[],
    customer: Customer,
    distributor: Distributor
  ): Promise<Promotion | null> {
    // 1. Uygun promosyonları filtrele
    const eligiblePromotions = await this.findEligiblePromotions(
      orderLineItems,
      customer,
      distributor
    );
    
    if (eligiblePromotions.length === 0) return null;
    
    // 2. En uygun promosyonu seç
    return this.selectBestPromotion(eligiblePromotions);
  }
  
  /**
   * Bedava > % iskonto > Sabit iskonto, ardından priority
   */
  private selectBestPromotion(promotions: Promotion[]): Promotion {
    const rewardTypePriority = {
      'free_goods': 0,
      'percentage_discount': 1,
      'fixed_discount': 2
    };
    
    return promotions.sort((a, b) => {
      // 1. Ödül türüne göre
      const typeRankDiff =
        (rewardTypePriority[a.reward_type] ?? 99) -
        (rewardTypePriority[b.reward_type] ?? 99);
      
      if (typeRankDiff !== 0) return typeRankDiff;
      
      // 2. Priority'ye göre (yüksek önce)
      const priorityDiff = (b.priority ?? 0) - (a.priority ?? 0);
      if (priorityDiff !== 0) return priorityDiff;
      
      // 3. Tie-breaker: eski promosyon
      return a.created_at.getTime() - b.created_at.getTime();
    })[0];
  }
}
```

---

## 10. Karar Özeti

| Konu | Karar |
|---|---|
| Aynı order'de promosyon sayısı | **Sadece 1** |
| Seçim stratejisi | **Bedava > % iskonto > Sabit iskonto**, sonra **Priority** |
| Priority zorunlu mu? | **Hayır**, default = 0 (tie-breaker için) |
| VD Gıda override edebilir mi? | **Evet**, istisnai talep ile |
| Promosyon değişim tarihi | Yalnızca **promotion_applications** değişmez |

---

**Son Güncelleme:** 2026-09-04
**Durum:** Onaylanmış ve İmplementasyona Hazır
