package com.vdgida.vdesgo.sales.data.repository

import com.vdgida.vdesgo.sales.core.security.UserSession
import com.vdgida.vdesgo.sales.data.OperationUiState
import com.vdgida.vdesgo.sales.data.OutsideRouteAssignment
import com.vdgida.vdesgo.sales.data.CustomerCreateRequest
import com.vdgida.vdesgo.sales.data.CustomerTypeOption
import com.vdgida.vdesgo.sales.data.WorkdaySession
import com.vdgida.vdesgo.sales.data.LocationReading
import kotlinx.serialization.json.JsonObject
import kotlinx.coroutines.flow.StateFlow

data class CustomerSummary(
    val code: String,
    val name: String,
    val address: String?,
    val phone: String?,
    val province: String?,
    val district: String?,
    val visitState: String?,
    val title: String? = null,
    val taxOffice: String? = null,
    val taxNo: String? = null,
    val tckn: String? = null,
    val balance: String? = null,
    /** Maximum allowed debt balance in TL; null means unlimited. */
    val creditLimit: Double? = null,
    /** Open (not invoiced) order total in TL as reported by the server; null when unknown. */
    val openOrderAmount: Double? = null,
    val locationLatitude: Double? = null,
    val locationLongitude: Double? = null,
    val locationAccuracyM: Double? = null,
    val locationCapturedAt: String? = null,
)

data class ProductSummary(
    val code: String,
    val name: String,
    val unit: String,
    val netPrice: Double?,
    val orderable: Boolean = true,
    val units: List<String> = listOf(unit),
    val unitInnerQuantities: Map<String, Double> = emptyMap(),
    val ePoint: String? = null,
    val weight: String? = null,
    val volume: String? = null,
    val imageDataUrl: String? = null,
)

data class WorkdayCloseResult(
    val routePointsSyncError: String?,
)

data class UnitPriceSummary(
    val unitPrice: Double,
    val baseUnitPrice: Double,
    val innerQuantity: Double,
    val priceRevision: String = "0",
)

data class DraftSummary(
    val id: String,
    val customerCode: String,
    val customerName: String,
    val state: String,
    val createdAt: String,
    val lines: List<DraftLineSummary>,
    val netEstimate: Double,
    val documentType: String = "order",
)

data class DraftLineSummary(
    val id: String,
    val productCode: String,
    val productName: String,
    val unitCode: String,
    val quantity: Double,
    val unitNetPrice: Double?,
    val manualDiscountPercent: Double = 0.0,
)

data class SaleCorrectionDraft(
    val draftId: String,
    val discountSelection: Set<String>,
    val selectedPromotionId: String?,
)

data class OperationSummary(
    val id: String,
    val status: OperationUiState,
    val documentNumber: String?,
    val error: String?,
    val result: String?,
    val draftId: String? = null,
    val type: String = "",
    val createdAt: String = "",
    val payload: String = "",
    val printedAt: String? = null,
    val printNumber: String? = null,
    val cancellationRequested: Boolean = false,
)

data class SalesContextSummary(
    val customer: CustomerSummary,
    val balance: String?,
    val lastOrder: String?,
    val discountRates: Map<String, Double> = emptyMap(),
    val accountMovements: List<AccountMovementSummary>? = null,
)

data class AccountMovementSummary(
    val date: String,
    val type: String,
    val reference: String?,
    val description: String?,
    val balanceEffect: Double,
)

data class OutsideRouteData(
    val days: List<String>,
    val assignments: List<OutsideRouteAssignment>,
)

sealed interface LoginOutcome {
    data class Authorized(val session: UserSession) : LoginOutcome
    data object DevicePending : LoginOutcome
    data class Failed(val message: String, val code: String? = null) : LoginOutcome
}

sealed interface QuoteOutcome {
    data class Available(val response: com.vdgida.vdesgo.sales.data.QuoteResponse) : QuoteOutcome
    data class Failed(val message: String) : QuoteOutcome
}

interface MobileRepository {
    val session: StateFlow<UserSession?>
    val serverReachable: StateFlow<Boolean?>
    suspend fun restoreSession(): UserSession?
    suspend fun checkServer(): Boolean
    suspend fun login(username: String, password: String): LoginOutcome
    suspend fun logout()
    suspend fun refreshBootstrap(): Result<Unit>
    suspend fun pullChanges(): Result<Unit>
    suspend fun syncOutbox(): Result<Unit>
    suspend fun refreshDailyData(): Result<Boolean>
    suspend fun customers(): List<CustomerSummary>
    suspend fun customerTypes(): List<CustomerTypeOption>
    suspend fun customerTaxNumberExists(taxNo: String): Result<Boolean>
    suspend fun createCustomer(request: CustomerCreateRequest): Result<Unit>
    suspend fun customer(code: String): CustomerSummary?
    suspend fun salesContext(code: String): SalesContextSummary?
    suspend fun unitPrice(
        customerCode: String,
        productCode: String,
        unitCode: String,
        documentType: String,
    ): UnitPriceSummary
    suspend fun todayRoute(): List<CustomerSummary>
    suspend fun currentWorkday(): Result<WorkdaySession?>
    suspend fun currentVehicleStock(): Result<List<JsonObject>>
    /**
     * Assigned vehicle warehouse stock adjusted with local sales not yet reflected in the fetched stock.
     * Falls back to the last synced stock when the server is unreachable.
     */
    suspend fun hotSaleStock(
        correctedOperationId: String? = null,
        refresh: Boolean = true,
    ): Result<com.vdgida.vdesgo.sales.data.VehicleStockAvailability>
    /** Returns a user message when [lines] (aggregated per product) exceed vehicle stock, otherwise null. */
    suspend fun validateHotSaleStock(
        lines: List<com.vdgida.vdesgo.sales.data.OrderLinePayload>,
        correctedOperationId: String? = null,
    ): String?
    suspend fun openWorkday(openingOdometerKm: Double): Result<WorkdaySession>
    suspend fun closeWorkday(
        closingOdometerKm: Double,
        routeOrder: List<String>,
        openingOdometerKm: Double? = null,
    ): Result<WorkdayCloseResult>
    suspend fun submitCollection(
        operationId: String,
        customerCode: String,
        amount: Double,
        operationDate: String,
        description: String,
    ): Result<Unit>
    suspend fun outsideRoute(day: String? = null): Result<OutsideRouteData>
    suspend fun products(): List<ProductSummary>
    suspend fun drafts(): List<DraftSummary>
    suspend fun draft(id: String): DraftSummary?
    suspend fun reviewConflict(draftId: String): String?
    suspend fun operations(): List<OperationSummary>
    suspend fun pendingOperationCount(): Int
    suspend fun markDocumentPrinted(operationId: String, printNumber: String?): Result<Unit>
    suspend fun cancelDocument(operationId: String): Result<Unit>
    suspend fun deleteDocument(operationId: String): Result<Unit>
    suspend fun deleteCustomerCreation(operationId: String): Result<Unit>
    suspend fun editCustomerCreation(operationId: String, request: CustomerCreateRequest): Result<Unit>
    suspend fun dismissCustomerCreation(operationId: String): Result<Unit>
    suspend fun createSaleCorrection(operationId: String): SaleCorrectionDraft?
    suspend fun replaceSalesInvoice(
        operationId: String,
        draftId: String,
        discountSelection: Map<String, Boolean>,
        selectedPromotionId: String?,
        rewardSnapshot: List<com.vdgida.vdesgo.sales.data.OrderLinePayload> = emptyList(),
    ): Result<Unit>
    suspend fun createDraft(customerCode: String, documentType: String = "order"): String
    suspend fun changeDraftQuantity(draftId: String, productCode: String, unitCode: String, delta: Double)
    suspend fun changeDraftDiscount(draftId: String, productCode: String, unitCode: String, percent: Double)
    suspend fun queueVisitStart(
        customerCode: String,
        location: LocationReading?,
        allowUnverifiedLocation: Boolean = false,
        unverifiedReason: String? = null,
    ): Result<String>
    suspend fun completeLatestVisit(customerCode: String, visitResult: String, note: String): Result<Unit>
    suspend fun quoteDraft(
        draftId: String,
        discountSelection: Map<String, Boolean> = emptyMap(),
        selectedPromotionId: String? = null,
    ): QuoteOutcome
    suspend fun submitDraft(
        draftId: String,
        discountSelection: Map<String, Boolean> = emptyMap(),
        selectedPromotionId: String? = null,
        rewardSnapshot: List<com.vdgida.vdesgo.sales.data.OrderLinePayload> = emptyList(),
    ): Result<String>
    suspend fun currentSyncTime(): String?
    suspend fun syncCursor(): String
    fun maskedDeviceId(): String
    fun apiBaseUrl(): String
    fun mockModeEnabled(): Boolean
}
