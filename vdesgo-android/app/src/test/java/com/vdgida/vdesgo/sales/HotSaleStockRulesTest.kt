package com.vdgida.vdesgo.sales

import com.vdgida.vdesgo.sales.data.CreditLimitCheck
import com.vdgida.vdesgo.sales.data.CreditLimitRules
import com.vdgida.vdesgo.sales.data.CustomerCreateRequest
import com.vdgida.vdesgo.sales.data.CustomerIdentityRules
import com.vdgida.vdesgo.sales.data.HotSaleStockCheck
import com.vdgida.vdesgo.sales.data.HotSaleStockRules
import com.vdgida.vdesgo.sales.data.QuoteResponse
import com.vdgida.vdesgo.sales.data.SaleStockOperation
import com.vdgida.vdesgo.sales.data.StockCartLine
import com.vdgida.vdesgo.sales.data.VehicleStockAvailability
import com.vdgida.vdesgo.sales.ui.creditLimitRejectionMessage
import com.vdgida.vdesgo.sales.ui.promotionalRewardLines
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class HotSaleStockRulesTest {
    private val json = Json { ignoreUnknownKeys = true; explicitNulls = false }

    private fun rows(raw: String): List<JsonObject> =
        json.parseToJsonElement(raw).jsonObject["stock"]!!.let { element ->
            (element as kotlinx.serialization.json.JsonArray).map { it.jsonObject }
        }

    // 120 ADET in the vehicle; KOLI = 24 ADET, PAKET has no stock-side conversion.
    private val stock: VehicleStockAvailability = HotSaleStockRules.parse(
        rows(
            """{"warehouseCode":"ARAC01","stock":[
              {"productCode":"P1","productName":"Su","unit":"ADET","quantity":120,
               "units":[{"unit":"KOLI","innerQuantity":24},{"unit":"PAKET","innerQuantity":null}]},
              {"productCode":"P2","productName":"Çay","unit":"KG","quantity":"2,5","units":[]}
            ]}""",
        ),
        warehouseCode = "ARAC01",
        fetchedAt = "2025-01-01T08:00:00Z",
        fromCache = false,
    )

    @Test
    fun parsesBaseQuantitiesAndConversions() {
        val p1 = stock.levels.getValue("P1")
        assertEquals(120.0, p1.availableBaseQuantity, 1e-9)
        assertEquals(mapOf("KOLI" to 24.0, "ADET" to 1.0), p1.unitInnerQuantities)
        assertEquals(2.5, stock.levels.getValue("P2").availableBaseQuantity, 1e-9)
    }

    @Test
    fun showsAvailableStockConvertedToSelectedUnit() {
        val result = HotSaleStockRules.check(stock, "P1", "KOLI", 5.0, emptyList(), null)
        result as HotSaleStockCheck.Allowed
        assertEquals(5.0, result.availableInUnit, 1e-9)
        assertEquals(5.0, result.maxWholeQuantity, 1e-9)
        assertTrue(HotSaleStockRules.check(stock, "P1", "KOLI", 6.0, emptyList(), null) is HotSaleStockCheck.Exceeds)
    }

    @Test
    fun aggregatesOtherCartLinesAcrossUnits() {
        val cart = listOf(StockCartLine("a", "P1", "KOLI", 4.0)) // 96 ADET used
        val allowed = HotSaleStockRules.check(stock, "P1", "ADET", 24.0, cart, excludedLineId = "edited")
        allowed as HotSaleStockCheck.Allowed
        assertEquals(24.0, allowed.availableInUnit, 1e-9)
        val exceeded = HotSaleStockRules.check(stock, "P1", "ADET", 25.0, cart, excludedLineId = "edited")
        exceeded as HotSaleStockCheck.Exceeds
        assertEquals(24.0, exceeded.maxWholeQuantity, 1e-9)
        val koli = HotSaleStockRules.check(stock, "P1", "KOLI", 1.0, cart + StockCartLine("b", "P1", "ADET", 1.0), "x")
        assertTrue(koli is HotSaleStockCheck.Exceeds)
        assertTrue(HotSaleStockRules.message("Su", "KOLI", koli)!!.contains("En fazla 0 KOLI"))
    }

    @Test
    fun validatesWholeCartIncludingFractionalBaseUnits() {
        assertNull(HotSaleStockRules.validateCart(stock, listOf(
            StockCartLine(null, "P1", "KOLI", 4.0),
            StockCartLine(null, "P1", "ADET", 24.0),
            StockCartLine(null, "P2", "KG", 2.5),
        )))
        val violation = HotSaleStockRules.validateCart(stock, listOf(
            StockCartLine(null, "P1", "KOLI", 4.0),
            StockCartLine(null, "P1", "ADET", 25.0),
        ))!!
        assertEquals("P1", violation.first.productCode)
        assertTrue(violation.second is HotSaleStockCheck.Exceeds)
    }

    @Test
    fun blocksMissingStockUnknownStockAndUnknownConversion() {
        assertEquals(HotSaleStockCheck.NoStock, HotSaleStockRules.check(stock, "P9", "ADET", 1.0, emptyList(), null, productBaseUnit = "ADET"))
        assertEquals(HotSaleStockCheck.UnknownStock, HotSaleStockRules.check(null, "P1", "ADET", 1.0, emptyList(), null))
        assertEquals(HotSaleStockCheck.UnknownConversion, HotSaleStockRules.check(stock, "P1", "PAKET", 1.0, emptyList(), null))
        // Product master conversion is used when the stock row has none.
        val viaProduct = HotSaleStockRules.check(stock, "P1", "PAKET", 10.0, emptyList(), null, mapOf("PAKET" to 12.0))
        assertTrue(viaProduct is HotSaleStockCheck.Allowed)
        assertTrue(HotSaleStockRules.message("X", "ADET", HotSaleStockCheck.NoStock)!!.contains("stok yok"))
    }

    @Test
    fun pendingSalesReserveStockAndCorrectionsReleaseOriginalLines() {
        fun payload(quantity: Int, unit: String = "ADET") =
            """{"customerCode":"C1","priceRevision":"1","promotionRevision":"1","lines":[{"productCode":"P1","unitCode":"$unit","quantity":$quantity}]}"""
        val lines: (String) -> List<StockCartLine> = { raw ->
            json.decodeFromString(com.vdgida.vdesgo.sales.data.OrderPayload.serializer(), raw).lines
                .map { StockCartLine(null, it.productCode, it.unitCode, it.quantity) }
        }
        val operations = listOf(
            SaleStockOperation("pending", "pending", payload(10)),
            SaleStockOperation("retry", "retry", payload(1, "KOLI")),
            SaleStockOperation("cancelled-send", "retry", payload(2)), // SYNC_CANCELLED_UNCONFIRMED keeps reserving
            SaleStockOperation("rejected-new", "rejected", payload(50)),
            SaleStockOperation("accepted-before-fetch", "accepted", payload(30)),
            SaleStockOperation("accepted-after-fetch", "accepted", payload(5)),
            SaleStockOperation("rejected-after-fetch", "rejected", payload(7)),
            SaleStockOperation("corrected-elsewhere", "accepted", payload(8)),
            SaleStockOperation("editing", "accepted", payload(20)),
        )
        val included = mapOf(
            "accepted-before-fetch" to payload(30),
            "rejected-after-fetch" to payload(7),
            "corrected-elsewhere" to payload(3),
            "editing" to payload(20),
        )
        val adjustments = HotSaleStockRules.saleAdjustments(operations, included, "editing", lines)
        val adjusted = HotSaleStockRules.adjust(stock, adjustments.reserved, adjustments.released)
        // 120 - 10 - 24 - 2 - 5 + 7 - (8 - 3) + 20 (edited sale released) = 101
        assertEquals(101.0, adjusted.levels.getValue("P1").availableBaseQuantity, 1e-9)
    }

    @Test
    fun releasedCorrectionLinesRestoreProductMissingFromSnapshot() {
        val released = listOf(StockCartLine(null, "P9", "KOLI", 1.0))
        val adjusted = HotSaleStockRules.adjust(
            stock, emptyList(), released,
            mapOf("P9" to mapOf("ADET" to 1.0, "KOLI" to 12.0)), mapOf("P9" to "ADET"),
        )
        assertEquals(12.0, adjusted.levels.getValue("P9").availableBaseQuantity, 1e-9)
    }

    @Test
    fun reservationWithUnknownConversionNeverOverEstimatesStock() {
        val adjusted = HotSaleStockRules.adjust(stock, listOf(StockCartLine(null, "P1", "PAKET", 1.0)))
        assertEquals(0.0, adjusted.levels.getValue("P1").availableBaseQuantity, 1e-9)
    }

    @Test
    fun pendingPaidPlusFreeSaleCannotOverestimateAvailableStock() {
        val stored = com.vdgida.vdesgo.sales.data.OrderPayload(
            customerCode = "C1",
            priceRevision = "1",
            promotionRevision = "1",
            lines = listOf(com.vdgida.vdesgo.sales.data.OrderLinePayload("P1", "KOLI", 4.0)), // 96 ADET paid
            stockRewardSnapshot = listOf(com.vdgida.vdesgo.sales.data.OrderLinePayload("P1", "ADET", 12.0)), // free
        )
        val payload = json.encodeToString(com.vdgida.vdesgo.sales.data.OrderPayload.serializer(), stored)
        val lines: (String) -> List<StockCartLine> = { com.vdgida.vdesgo.sales.data.saleStockLines(json, it) }
        val pending = HotSaleStockRules.saleAdjustments(
            listOf(SaleStockOperation("pending", "pending", payload)), emptyMap(), null, lines,
        )
        val adjusted = HotSaleStockRules.adjust(stock, pending.reserved, pending.released)
        // 120 - 96 paid - 12 free = 12 ADET left, not 24.
        assertEquals(12.0, adjusted.levels.getValue("P1").availableBaseQuantity, 1e-9)
        assertTrue(HotSaleStockRules.check(adjusted, "P1", "ADET", 13.0, emptyList(), null) is HotSaleStockCheck.Exceeds)
        assertTrue(HotSaleStockRules.check(adjusted, "P1", "ADET", 12.0, emptyList(), null) is HotSaleStockCheck.Allowed)

        // Accepted at fetch time and later corrected: both old and new free goods are accounted for.
        val corrected = json.encodeToString(
            com.vdgida.vdesgo.sales.data.OrderPayload.serializer(),
            stored.copy(stockRewardSnapshot = listOf(com.vdgida.vdesgo.sales.data.OrderLinePayload("P1", "ADET", 20.0))),
        )
        val correction = HotSaleStockRules.saleAdjustments(
            listOf(SaleStockOperation("sale", "accepted", corrected)), mapOf("sale" to payload), null, lines,
        )
        val afterCorrection = HotSaleStockRules.adjust(stock, correction.reserved, correction.released)
        assertEquals(112.0, afterCorrection.levels.getValue("P1").availableBaseQuantity, 1e-9) // 120 + 108 - 116
        // Editing that sale releases its stored paid + free lines.
        val editing = HotSaleStockRules.saleAdjustments(
            listOf(SaleStockOperation("sale", "accepted", payload)), mapOf("sale" to payload), "sale", lines,
        )
        assertEquals(108.0 + 120.0, HotSaleStockRules.adjust(stock, editing.reserved, editing.released)
            .levels.getValue("P1").availableBaseQuantity, 1e-9)
    }

    @Test
    fun rewardSnapshotIsNeverSentToServer() {
        val stored = json.parseToJsonElement(
            """{"customerCode":"C1","priceRevision":"1","promotionRevision":"1",
               "lines":[{"productCode":"P1","unitCode":"KOLI","quantity":1}],
               "stockRewardSnapshot":[{"productCode":"P1","unitCode":"ADET","quantity":2}]}""",
        ).jsonObject
        val sent = com.vdgida.vdesgo.sales.data.repository.operationPayloadForWorkSession("sale.submit", stored, "ws-1")
        assertFalse(com.vdgida.vdesgo.sales.data.STOCK_REWARD_SNAPSHOT_FIELD in sent)
        assertEquals(stored["lines"], sent["lines"])
        assertEquals("\"ws-1\"", sent["workSessionId"].toString())
        val noSnapshot = com.vdgida.vdesgo.sales.data.OrderPayload("C1", "1", "1", emptyList())
        assertFalse(com.vdgida.vdesgo.sales.data.STOCK_REWARD_SNAPSHOT_FIELD in
            json.parseToJsonElement(json.encodeToString(com.vdgida.vdesgo.sales.data.OrderPayload.serializer(), noSnapshot)).jsonObject)
    }

    @Test
    fun promotionalRewardLinesFromQuoteConsumeStock() {
        val quote = QuoteResponse(
            quoteStatus = "ok",
            result = json.parseToJsonElement(
                """{"grandTotal":100,"lines":[
                  {"productCode":"P1","unitCode":"KOLI","quantity":4,"priceSource":"PRICE_LIST"},
                  {"productCode":"P1","unitCode":"ADET","quantity":25,"priceSource":"PROMOTION_FREE_GOODS"}]}""",
            ).jsonObject,
        )
        val rewards = quote.promotionalRewardLines()
        assertEquals(1, rewards.size)
        assertEquals(25.0, rewards.single().quantity, 1e-9)
        val cart = listOf(StockCartLine(null, "P1", "KOLI", 4.0)) +
            rewards.map { StockCartLine(null, it.productCode, it.unitCode, it.quantity) }
        assertTrue(HotSaleStockRules.validateCart(stock, cart)!!.second is HotSaleStockCheck.Exceeds)
        assertTrue((null as QuoteResponse?).promotionalRewardLines().isEmpty())
    }
}

class CreditLimitRulesTest {
    private val json = Json { ignoreUnknownKeys = true; explicitNulls = false }

    @Test
    fun parsesOptionalInputWithoutInventingZero() {
        assertNull(CreditLimitRules.parseInput("  ").getOrThrow())
        assertEquals(0.0, CreditLimitRules.parseInput("0").getOrThrow()!!, 0.0)
        assertEquals(1500.25, CreditLimitRules.parseInput("1500,25").getOrThrow()!!, 1e-9)
        assertTrue(CreditLimitRules.parseInput("-1").isFailure)
        assertTrue(CreditLimitRules.parseInput("1.2.3").isFailure)
        assertTrue(CreditLimitRules.parseInput("10,123").isFailure)
    }

    @Test
    fun checksOnlyWhenBalanceInformationIsSufficient() {
        assertEquals(CreditLimitCheck.Unlimited, CreditLimitRules.check(null, "999999", 0.0, 10.0))
        assertEquals(CreditLimitCheck.InsufficientInfo, CreditLimitRules.check(1000.0, null, 0.0, 10.0))
        assertEquals(CreditLimitCheck.InsufficientInfo, CreditLimitRules.check(1000.0, "500", null, 10.0))
        assertEquals(CreditLimitCheck.InsufficientInfo, CreditLimitRules.check(1000.0, "500", 0.0, null))
        assertEquals(CreditLimitCheck.Allowed, CreditLimitRules.check(1000.0, "500", 300.0, 200.0))
        val exceeded = CreditLimitRules.check(1000.0, "1.250,50 TL", 0.0, 10.0) as CreditLimitCheck.Exceeded
        assertEquals(260.5, exceeded.excessAmount, 1e-9)
        assertTrue(CreditLimitRules.check(0.0, "0", 0.0, 0.01) is CreditLimitCheck.Exceeded)
    }

    @Test
    fun customerCreateSendsNumericLimitAndOmitsUnlimited() {
        fun request(limit: Double?) = CustomerCreateRequest(
            taxNo = "1", taxOffice = "X", locationLatitude = 1.0, locationLongitude = 2.0,
            locationAccuracyM = 3.0, locationCapturedAt = "t", creditLimit = limit,
        )
        val limited = json.parseToJsonElement(json.encodeToString(CustomerCreateRequest.serializer(), request(2500.5))).jsonObject
        assertEquals("2500.5", limited["creditLimit"].toString())
        val unlimited = json.parseToJsonElement(json.encodeToString(CustomerCreateRequest.serializer(), request(null))).jsonObject
        assertFalse("creditLimit" in unlimited)
        assertNull(json.decodeFromString(CustomerCreateRequest.serializer(), """{"taxNo":"1","taxOffice":"X","locationLatitude":1,"locationLongitude":2,"locationAccuracyM":3,"locationCapturedAt":"t","creditLimit":null}""").creditLimit)
    }

    @Test
    fun customerCreatePreservesTcknAndReadsOlderQueuedRequests() {
        val oldPayload = """{"taxNo":"1234567890","taxOffice":"X","locationLatitude":1,"locationLongitude":2,"locationAccuracyM":3,"locationCapturedAt":"t"}"""
        val oldRequest = json.decodeFromString(CustomerCreateRequest.serializer(), oldPayload)
        assertEquals("", oldRequest.tckn)
        val personal = oldRequest.copy(taxNo = "", tckn = "11111111111")
        val roundTrip = json.decodeFromString(
            CustomerCreateRequest.serializer(),
            json.encodeToString(CustomerCreateRequest.serializer(), personal),
        )
        assertEquals("", roundTrip.taxNo)
        assertEquals("11111111111", roundTrip.tckn)
    }

    @Test
    fun customerCreateRequiresTaxOfficeAndOneIdentityNumber() {
        assertEquals(
            "Vergi dairesi zorunludur.",
            CustomerIdentityRules.missingFieldsMessage("", "1234567890", ""),
        )
        assertEquals(
            "VKN veya T.C. Kimlik Numarası (TCKN) girilmelidir.",
            CustomerIdentityRules.missingFieldsMessage("Test Vergi Dairesi", "", ""),
        )
        assertEquals(
            "TCKN 11 haneli rakamlardan oluşmalıdır.",
            CustomerIdentityRules.missingFieldsMessage("Test Vergi Dairesi", "", "123"),
        )
        assertEquals(
            "VKN 10 haneli rakamlardan oluşmalıdır.",
            CustomerIdentityRules.missingFieldsMessage("Test Vergi Dairesi", "123", ""),
        )
        assertTrue(CustomerIdentityRules.isValid("Test Vergi Dairesi", "1234567890", ""))
        assertTrue(CustomerIdentityRules.isValid("Test Vergi Dairesi", "", "11111111111"))
    }

    @Test
    fun formatsServerCreditRejectionDetails() {
        val message = creditLimitRejectionMessage(
            """{"customerCode":"C1","balance":900,"openOrderAmount":50,"creditLimit":1000,"projectedBalance":1100,"excessAmount":100,"message":"Limit aşıldı"}""",
        )!!
        assertTrue(message.startsWith("Limit aşıldı"))
        assertTrue(message.contains("Aşım: 100,00 TL"))
    }
}
