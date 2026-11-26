package com.vdgida.vdesgo.sales.ui

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.vdgida.vdesgo.sales.R
import com.vdgida.vdesgo.sales.core.security.UserSession
import com.vdgida.vdesgo.sales.data.QuoteResponse
import com.vdgida.vdesgo.sales.data.OrderPayload
import com.vdgida.vdesgo.sales.data.OutsideRouteAssignment
import com.vdgida.vdesgo.sales.data.WorkdaySession
import com.vdgida.vdesgo.sales.data.LocationReading
import com.vdgida.vdesgo.sales.data.CustomerCreateRequest
import com.vdgida.vdesgo.sales.data.CustomerTypeOption
import com.vdgida.vdesgo.sales.data.CreditLimitCheck
import com.vdgida.vdesgo.sales.data.CreditLimitRules
import com.vdgida.vdesgo.sales.data.HotSaleStockRules
import com.vdgida.vdesgo.sales.data.OrderLinePayload
import com.vdgida.vdesgo.sales.data.StockCartLine
import com.vdgida.vdesgo.sales.data.VehicleStockAvailability
import com.vdgida.vdesgo.sales.data.repository.CustomerSummary
import com.vdgida.vdesgo.sales.data.repository.DraftSummary
import com.vdgida.vdesgo.sales.data.repository.LoginOutcome
import com.vdgida.vdesgo.sales.data.repository.MobileRepository
import com.vdgida.vdesgo.sales.data.repository.OperationSummary
import com.vdgida.vdesgo.sales.data.repository.ProductSummary
import com.vdgida.vdesgo.sales.data.repository.UnitPriceSummary
import com.vdgida.vdesgo.sales.data.repository.SalesContextSummary
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import com.vdgida.vdesgo.sales.location.HighAccuracyLocationProvider
import java.io.IOException
import javax.inject.Inject
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.Json
import kotlinx.serialization.SerializationException

sealed interface SyncOverlayState {
    data object Running : SyncOverlayState
    data object Completed : SyncOverlayState
    data class Cancelled(val message: String) : SyncOverlayState
}

const val SYNC_CANCELLED_MESSAGE =
    "Eşitleme iptal edildi. Sunucuya ulaşmış kayıtlar geri alınmaz; durumları bir sonraki eşitlemede doğrulanır."

/** Free promotional goods from a quote; they consume vehicle stock like paid lines. */
fun QuoteResponse?.promotionalRewardLines(): List<OrderLinePayload> =
    this?.result?.get("lines")?.let { runCatching { it.jsonArray }.getOrNull() }.orEmpty().mapNotNull { element ->
        val line = runCatching { element.jsonObject }.getOrNull() ?: return@mapNotNull null
        if (line["priceSource"]?.jsonPrimitive?.contentOrNull != "PROMOTION_FREE_GOODS") return@mapNotNull null
        val productCode = line["productCode"]?.jsonPrimitive?.contentOrNull ?: return@mapNotNull null
        val unitCode = line["unitCode"]?.jsonPrimitive?.contentOrNull ?: return@mapNotNull null
        val quantity = line["quantity"]?.jsonPrimitive?.doubleOrNull?.takeIf { it > 0.0 } ?: return@mapNotNull null
        OrderLinePayload(productCode, unitCode, quantity)
    }

data class MobileUiState(
    val session: UserSession? = null,
    val mockMode: Boolean = false,
    val pendingDevice: Boolean = false,
    val loading: Boolean = false,
    val refreshing: Boolean = false,
    val dailyLoading: Boolean = false,
    val error: String? = null,
    val dailyInfoMessage: String? = null,
    val search: String = "",
    val customers: List<CustomerSummary> = emptyList(),
    val customerTypes: List<CustomerTypeOption> = emptyList(),
    val customerTypesLoading: Boolean = false,
    val customerCreating: Boolean = false,
    val route: List<CustomerSummary> = emptyList(),
    val products: List<ProductSummary> = emptyList(),
    val unitPrices: Map<String, UnitPriceSummary> = emptyMap(),
    val loadingUnitPrices: Set<String> = emptySet(),
    val unitPriceErrors: Map<String, String> = emptyMap(),
    val drafts: List<DraftSummary> = emptyList(),
    val operations: List<OperationSummary> = emptyList(),
    val pendingCount: Int = 0,
    val selectedCustomer: CustomerSummary? = null,
    val salesContext: SalesContextSummary? = null,
    val activeDraft: DraftSummary? = null,
    val quote: QuoteResponse? = null,
    val saleDiscountSelections: Map<String, Set<String>> = emptyMap(),
    val saleSelectedPromotions: Map<String, String> = emptyMap(),
    val serverReachable: Boolean? = null,
    val lastSync: String? = null,
    val cursor: String = "0",
    val syncMessage: String? = null,
    val workday: WorkdaySession? = null,
    val workdayNeedsClosing: Boolean = false,
    val workdayChecked: Boolean = false,
    val vehicleStock: List<JsonObject> = emptyList(),
    val vehicleStockLoading: Boolean = false,
    val vehicleStockError: String? = null,
    val outsideDays: List<String> = emptyList(),
    val outsideAssignments: List<OutsideRouteAssignment> = emptyList(),
    val outsideDay: String? = null,
    val stockCounts: Map<String, String> = emptyMap(),
    val routeOrder: List<String> = emptyList(),
    val syncOverlay: SyncOverlayState? = null,
    val hotSaleStock: VehicleStockAvailability? = null,
    val hotSaleStockLoading: Boolean = false,
    val hotSaleStockError: String? = null,
    val saleCorrections: Map<String, String> = emptyMap(),
)

private fun WorkdaySession.routeCustomerCodes(): List<String> =
    openingSnapshot["route"]?.let { runCatching { it.jsonArray }.getOrNull() }.orEmpty().mapNotNull { item ->
        item.jsonObject["customerCode"]?.jsonPrimitive?.contentOrNull
    }

@HiltViewModel
class AppViewModel @Inject constructor(
    private val repository: MobileRepository,
    private val locationProvider: HighAccuracyLocationProvider,
    @ApplicationContext private val context: Context,
) : ViewModel() {
    private val mutableState = MutableStateFlow(MobileUiState(mockMode = repository.mockModeEnabled()))
    private val workdayRefreshMutex = Mutex()
    private val dailyDataRefreshMutex = Mutex()
    private var syncJob: Job? = null
    val state: StateFlow<MobileUiState> = mutableState.asStateFlow()

    init {
        viewModelScope.launch {
            repository.session.collect { session ->
                mutableState.update {
                    it.copy(
                        session = session,
                        workday = null,
                        workdayNeedsClosing = false,
                        workdayChecked = session == null,
                        routeOrder = emptyList(),
                        dailyLoading = false,
                        dailyInfoMessage = null,
                    )
                }
                if (session != null) {
                    refreshWorkday()
                    refreshData()
                }
            }
        }
        viewModelScope.launch {
            repository.serverReachable.collect { reachable ->
                mutableState.update { it.copy(serverReachable = reachable) }
            }
        }
        viewModelScope.launch {
            val session = repository.restoreSession()
            mutableState.update { it.copy(session = session) }
            if (session != null) {
                repository.checkServer()
                refreshWorkday()
                refreshData()
            }
        }
    }

    fun login(username: String, password: String, onPending: () -> Unit) {
        viewModelScope.launch {
            mutableState.update { it.copy(loading = true, error = null, pendingDevice = false) }
            when (val outcome = repository.login(username, password)) {
                is LoginOutcome.Authorized -> {
                    mutableState.update { it.copy(loading = false, error = null) }
                    repository.checkServer()
                    refreshWorkday()
                    refreshData()
                }
                LoginOutcome.DevicePending -> {
                    mutableState.update { it.copy(loading = false, pendingDevice = true) }
                    onPending()
                }
                is LoginOutcome.Failed -> mutableState.update {
                    it.copy(loading = false, error = outcome.message)
                }
            }
        }
    }

    fun returnToLogin() {
        mutableState.update { it.copy(pendingDevice = false, error = null) }
    }

    fun logout() {
        viewModelScope.launch {
            repository.logout()
            mutableState.value = MobileUiState(mockMode = repository.mockModeEnabled())
        }
    }

    fun debugDeviceId(): String = repository.maskedDeviceId()
    fun debugApiUrl(): String = repository.apiBaseUrl()
    fun debugMockMode(): Boolean = repository.mockModeEnabled()

    fun updateSearch(value: String) {
        mutableState.update { it.copy(search = value) }
    }

    fun refreshWorkday() {
        mutableState.update { it.copy(loading = true, error = null, workdayChecked = false) }
        viewModelScope.launch { refreshWorkdayNow() }
    }

    /** User-triggered workday refresh with the blocking progress overlay. */
    fun refreshWorkdayWithProgress() {
        runWithSyncOverlay {
            mutableState.update { it.copy(loading = true, error = null, workdayChecked = false) }
            refreshWorkdayNow()
            state.value.error == null
        }
    }

    private suspend fun refreshWorkdayNow() {
        try {
            workdayRefreshMutex.withLock {
                val current = repository.currentWorkday()
                val workday = current.getOrNull()
                val dailyRefreshError = if (workday?.status == "open" && !workday.requiresClosing) {
                    dailyDataRefreshMutex.withLock {
                        repository.refreshDailyData().exceptionOrNull()?.message
                    }
                } else null
                mutableState.update {
                    val routeCodes = workday?.routeCustomerCodes().orEmpty()
                    val preferredOrder = it.routeOrder.takeIf { order ->
                        order.size == routeCodes.size && order.toSet() == routeCodes.toSet()
                    } ?: routeCodes
                    it.copy(
                        loading = false,
                        error = current.exceptionOrNull()?.message ?: dailyRefreshError,
                        workday = workday,
                        workdayNeedsClosing = workday?.requiresClosing == true,
                        workdayChecked = current.isSuccess,
                        stockCounts = emptyMap(),
                        routeOrder = preferredOrder,
                        unitPrices = emptyMap(),
                        unitPriceErrors = emptyMap(),
                    )
                }
                if (workday != null) refreshData()
            }
        } finally {
            mutableState.update { it.copy(loading = false) }
        }
    }

    fun cancelSync() {
        syncJob?.cancel()
    }

    fun dismissSyncOverlay() {
        if (syncJob?.isActive != true) mutableState.update { it.copy(syncOverlay = null) }
    }

    /** Runs [block] behind the blocking overlay; [block] returns true on full success. */
    private fun runWithSyncOverlay(block: suspend () -> Boolean) {
        if (syncJob?.isActive == true) return
        mutableState.update { it.copy(syncOverlay = SyncOverlayState.Running) }
        syncJob = viewModelScope.launch {
            var outcome: SyncOverlayState? = null
            try {
                outcome = if (block()) SyncOverlayState.Completed else null
            } catch (error: CancellationException) {
                outcome = SyncOverlayState.Cancelled(SYNC_CANCELLED_MESSAGE)
                throw error
            } finally {
                withContext(NonCancellable) {
                    mutableState.update { it.copy(refreshing = false, loading = false, syncOverlay = outcome) }
                    if (outcome is SyncOverlayState.Cancelled) refreshData()
                }
            }
        }
    }

    fun openWorkday(openingOdometerKm: Double, onOpened: () -> Unit = {}) {
        viewModelScope.launch {
            mutableState.update { it.copy(loading = true, error = null) }
            val result = repository.openWorkday(openingOdometerKm)
            val openingError = result.exceptionOrNull()
            if (openingError?.message?.startsWith("STALE_WORKDAY_OPEN:") == true) {
                val current = repository.currentWorkday()
                val workday = current.getOrNull()
                mutableState.update {
                    val routeCodes = workday?.routeCustomerCodes().orEmpty()
                    val preferredOrder = it.routeOrder.takeIf { order ->
                        order.size == routeCodes.size && order.toSet() == routeCodes.toSet()
                    } ?: routeCodes
                    val recoveryError = when {
                        current.isFailure ->
                            "${openingError.message}\nGüncel iş günü bilgisi alınamadı: ${current.exceptionOrNull()?.message}"
                        workday?.requiresClosing == true -> null
                        else ->
                            "${openingError.message}\nKapatılması gereken eski açık oturum güncel sunucu yanıtında bulunamadı. Günlük bilgileri yenileyip tekrar deneyin."
                    }
                    it.copy(
                        loading = false,
                        error = recoveryError,
                        workday = workday ?: it.workday,
                        workdayNeedsClosing = workday?.requiresClosing == true,
                        workdayChecked = current.isSuccess,
                        stockCounts = emptyMap(),
                        routeOrder = preferredOrder,
                    )
                }
                if (workday != null) refreshData()
                return@launch
            }
            mutableState.update {
                val workday = result.getOrNull() ?: it.workday
                val routeCodes = workday?.routeCustomerCodes().orEmpty()
                val preferredOrder = it.routeOrder.takeIf { order ->
                    order.size == routeCodes.size && order.toSet() == routeCodes.toSet()
                } ?: routeCodes
                it.copy(
                    loading = false,
                    error = result.exceptionOrNull()?.message,
                    workday = workday,
                    workdayNeedsClosing = false,
                    stockCounts = emptyMap(),
                    workdayChecked = result.isSuccess || it.workdayChecked,
                    routeOrder = preferredOrder,
                )
            }
            if (result.isSuccess) onOpened()
        }
    }

    fun loadOutsideRoute(day: String? = null) {
        viewModelScope.launch {
            mutableState.update { it.copy(loading = true, error = null, outsideDay = day) }
            val result = repository.outsideRoute(day)
            mutableState.update {
                it.copy(
                    loading = false,
                    error = result.exceptionOrNull()?.message,
                    outsideDays = result.getOrNull()?.days.orEmpty(),
                    outsideAssignments = result.getOrNull()?.assignments.orEmpty(),
                )
            }
        }
    }

    fun updateStockCount(productCode: String, value: String) {
        mutableState.update { it.copy(stockCounts = it.stockCounts + (productCode to value)) }
    }

    fun loadVehicleStock() {
        viewModelScope.launch {
            mutableState.update {
                it.copy(vehicleStock = emptyList(), vehicleStockLoading = true, vehicleStockError = null)
            }
            val result = repository.currentVehicleStock()
            mutableState.update {
                it.copy(
                    vehicleStock = result.getOrNull() ?: it.vehicleStock,
                    vehicleStockLoading = false,
                    vehicleStockError = result.exceptionOrNull()?.message,
                )
            }
        }
    }

    fun updateRouteOrder(customerCodes: List<String>) {
        mutableState.update { it.copy(routeOrder = customerCodes) }
    }

    fun closeWorkday(
        closingOdometerKm: Double,
        openingOdometerKm: Double? = null,
        onClosed: (String?) -> Unit = {},
    ) {
        viewModelScope.launch {
            val current = state.value
            val openingRoute = current.workday?.openingSnapshot?.get("route")
                ?.let { runCatching { it.jsonArray }.getOrNull() }.orEmpty()
            val routeCodes = openingRoute.mapNotNull { item ->
                item.jsonObject["customerCode"]?.jsonPrimitive?.contentOrNull
            }
            val chosenRoute = current.routeOrder.takeIf { it.size == routeCodes.size && it.toSet() == routeCodes.toSet() }
                ?: routeCodes
            mutableState.update { it.copy(loading = true, error = null) }
            val result = repository.closeWorkday(closingOdometerKm, chosenRoute, openingOdometerKm)
            if (result.isSuccess) {
                val routePointsSyncError = result.getOrNull()?.routePointsSyncError
                mutableState.update {
                    it.copy(
                        loading = false,
                        error = null,
                        dailyInfoMessage = if (routePointsSyncError == null) {
                            "Gün kapanışı başarıyla yapıldı."
                        } else {
                            "Gün kapatıldı; GPS kayıtları eşitlenemedi: $routePointsSyncError"
                        },
                    )
                }
                refreshWorkday()
                onClosed(routePointsSyncError)
            } else {
                mutableState.update {
                    it.copy(
                        loading = false,
                        error = result.exceptionOrNull()?.message,
                    )
                }
            }
        }
    }

    fun refresh() {
        runWithSyncOverlay {
            var completed = false
            mutableState.update { it.copy(refreshing = true, error = null) }
            dailyDataRefreshMutex.withLock {
                val dailyRefresh = repository.refreshDailyData()
                if (dailyRefresh.isSuccess) {
                    if (dailyRefresh.getOrNull() == true) {
                        val syncResult = repository.syncOutbox()
                        if (syncResult.isFailure) {
                            mutableState.update { it.copy(error = syncResult.exceptionOrNull()?.message) }
                        } else {
                            completed = true
                        }
                        mutableState.update { it.copy(dailyInfoMessage = "Bugünün müşteri, iskonto ve fiyat bilgileri yenilendi.") }
                    } else {
                        mutableState.update {
                            it.copy(dailyInfoMessage = "Bağlantı yok. Bugün için daha önce indirilen bilgiler kullanılıyor.")
                        }
                    }
                } else {
                    mutableState.update { it.copy(error = dailyRefresh.exceptionOrNull()?.message) }
                }
                if (!refreshData()) completed = false
            }
            if (state.value.activeDraft?.documentType == "van_sale") {
                loadHotSaleStockNow(state.value.saleCorrections[state.value.activeDraft?.id], refresh = completed)
            }
            completed
        }
    }

    fun loadHotSaleStock(draftId: String, refresh: Boolean = true) {
        viewModelScope.launch { loadHotSaleStockNow(state.value.saleCorrections[draftId], refresh) }
    }

    private suspend fun loadHotSaleStockNow(correctedOperationId: String?, refresh: Boolean) {
        mutableState.update { it.copy(hotSaleStockLoading = true, hotSaleStockError = null) }
        val result = repository.hotSaleStock(correctedOperationId, refresh && repository.serverReachable.value != false)
        mutableState.update {
            it.copy(
                hotSaleStock = result.getOrNull(),
                hotSaleStockLoading = false,
                hotSaleStockError = result.exceptionOrNull()?.message,
            )
        }
    }

    fun registerSaleCorrection(draftId: String, operationId: String) {
        if (state.value.saleCorrections[draftId] == operationId) return
        mutableState.update { it.copy(saleCorrections = it.saleCorrections + (draftId to operationId)) }
        loadHotSaleStock(draftId, refresh = true)
    }

    /**
     * Stock check for a hot-sale line editor: the other cart lines of the product (all units, converted to the
     * base unit) are consumed first. Returns null for non hot-sale drafts.
     */
    fun hotSaleLineStockCheck(
        draftId: String,
        product: ProductSummary,
        originalUnit: String?,
        unit: String,
        quantity: Double,
    ): com.vdgida.vdesgo.sales.data.HotSaleStockCheck? {
        val current = state.value
        val draft = current.activeDraft?.takeIf { it.id == draftId } ?: current.drafts.firstOrNull { it.id == draftId }
        if (draft?.documentType != "van_sale") return null
        val otherLines = draft.lines
            .filter { it.productCode == product.code && it.unitCode != originalUnit }
            .map { StockCartLine(it.id, it.productCode, it.unitCode, it.quantity) }
        return HotSaleStockRules.check(
            availability = current.hotSaleStock,
            productCode = product.code,
            unitCode = unit,
            quantity = quantity,
            otherLines = otherLines,
            excludedLineId = null,
            productUnitInnerQuantities = product.unitInnerQuantities,
            productBaseUnit = product.unit,
        )
    }

    /** Message when the hot-sale cart (after replacing the edited line) exceeds vehicle stock, else null. */
    fun hotSaleLineStockMessage(
        draftId: String,
        product: ProductSummary,
        originalUnit: String?,
        unit: String,
        quantity: Double,
    ): String? = hotSaleLineStockCheck(draftId, product, originalUnit, unit, quantity)
        ?.let { HotSaleStockRules.message(product.name, unit, it) }

    private suspend fun creditLimitMessage(customerCode: String): String? {
        val customer = repository.customer(customerCode) ?: return null
        val amount = state.value.quote?.result?.get("grandTotal")?.jsonPrimitive?.doubleOrNull
        val result = CreditLimitRules.check(customer.creditLimit, customer.balance, customer.openOrderAmount, amount)
        return (result as? CreditLimitCheck.Exceeded)?.let(CreditLimitRules::message)
    }

    private fun linesWithRewards(draft: DraftSummary): List<OrderLinePayload> =
        draft.lines.map { OrderLinePayload(it.productCode, it.unitCode, it.quantity) } +
            state.value.quote.promotionalRewardLines()

    fun deleteDocument(operationId: String) {
        viewModelScope.launch {
            mutableState.update { it.copy(loading = true, error = null) }
            val result = repository.deleteDocument(operationId)
            if (result.isFailure) {
                mutableState.update {
                    it.copy(loading = false, error = result.exceptionOrNull()?.message)
                }
                return@launch
            }
            refreshData()
            mutableState.update { it.copy(loading = false) }
        }
    }

    fun markDocumentPrinted(operationId: String, printNumber: String?) {
        viewModelScope.launch {
            mutableState.update { it.copy(loading = true, error = null) }
            val result = repository.markDocumentPrinted(operationId, printNumber)
            refreshData()
            mutableState.update {
                it.copy(loading = false, error = result.exceptionOrNull()?.message)
            }
        }
    }

    fun cancelDocument(operationId: String) {
        viewModelScope.launch {
            mutableState.update { it.copy(loading = true, error = null) }
            val result = repository.cancelDocument(operationId)
            refreshData()
            mutableState.update {
                it.copy(loading = false, error = result.exceptionOrNull()?.message)
            }
        }
    }

    fun createSaleCorrection(operation: OperationSummary, onReady: (String) -> Unit) {
        if (operation.type != "sale.submit" || operation.status != com.vdgida.vdesgo.sales.data.OperationUiState.ACCEPTED) {
            mutableState.update { it.copy(error = "Yalnızca kaydedilmiş sıcak satış faturaları düzeltilebilir.") }
            return
        }
        viewModelScope.launch {
            mutableState.update { it.copy(loading = true, error = null) }
            val correction = repository.createSaleCorrection(operation.id)
            if (correction == null) {
                mutableState.update {
                    it.copy(loading = false, error = "Fatura düzeltme taslağı oluşturulamadı.")
                }
                return@launch
            }
            mutableState.update { it.copy(saleCorrections = it.saleCorrections + (correction.draftId to operation.id)) }
            loadDraft(correction.draftId)
            loadHotSaleStockNow(operation.id, refresh = true)
            updateSaleSelections(correction.draftId, correction.discountSelection, correction.selectedPromotionId)
            mutableState.update { it.copy(loading = false) }
            onReady(correction.draftId)
        }
    }

    fun replaceSalesInvoice(
        operationId: String,
        draftId: String,
        discountSelection: Map<String, Boolean>,
        selectedPromotionId: String?,
        onSaved: () -> Unit,
    ) {
        viewModelScope.launch {
            mutableState.update { it.copy(loading = true, error = null) }
            val draft = repository.draft(draftId)
            if (draft != null) {
                repository.validateHotSaleStock(linesWithRewards(draft), operationId)?.let { message ->
                    mutableState.update { it.copy(loading = false, error = message) }
                    return@launch
                }
            }
            val result = repository.replaceSalesInvoice(
                operationId,
                draftId,
                discountSelection,
                selectedPromotionId,
                state.value.quote.promotionalRewardLines(),
            )
            if (result.isFailure) {
                mutableState.update { it.copy(loading = false, error = result.exceptionOrNull()?.message) }
                return@launch
            }
            refreshData()
            mutableState.update {
                it.copy(loading = false, quote = null, saleCorrections = it.saleCorrections - draftId)
            }
            onSaved()
        }
    }

    fun loadDailyData(onReady: () -> Unit) {
        viewModelScope.launch {
            dailyDataRefreshMutex.withLock {
                mutableState.update { it.copy(dailyLoading = true, error = null, dailyInfoMessage = null) }
                val result = repository.refreshDailyData()
                if (result.isFailure) {
                    mutableState.update {
                        it.copy(dailyLoading = false, error = result.exceptionOrNull()?.message)
                    }
                    return@withLock
                }
                val refreshed = refreshData()
                if (!refreshed) {
                    mutableState.update {
                        it.copy(dailyLoading = false, error = it.error ?: "Günlük bilgiler cihazda açılamadı.")
                    }
                    return@withLock
                }
                mutableState.update {
                    it.copy(
                        dailyLoading = false,
                        dailyInfoMessage = if (result.getOrNull() == true) {
                            "Bugünün müşteri, iskonto ve fiyat bilgileri hazır."
                        } else {
                            "Bağlantı yok. Bugün için daha önce indirilen bilgiler kullanılıyor."
                        },
                    )
                }
                onReady()
            }
        }
    }

    fun loadCustomerTypes() {
        viewModelScope.launch {
            mutableState.update { it.copy(customerTypesLoading = true, error = null) }
            try {
                val types = repository.customerTypes()
                mutableState.update {
                    it.copy(
                        customerTypes = types,
                        customerTypesLoading = false,
                        error = if (types.isEmpty()) "Sistemde tanımlı müşteri türü bulunamadı." else null,
                    )
                }
            } catch (error: IOException) {
                mutableState.update { it.copy(customerTypesLoading = false, error = error.message) }
            } catch (error: IllegalStateException) {
                mutableState.update { it.copy(customerTypesLoading = false, error = error.message) }
            }
        }
    }

    fun createCustomer(request: CustomerCreateRequest, onCreated: () -> Unit) {
        viewModelScope.launch {
            mutableState.update { it.copy(customerCreating = true, error = null) }
            val result = repository.createCustomer(request)
            if (result.isFailure) {
                mutableState.update {
                    it.copy(customerCreating = false, error = result.exceptionOrNull()?.message)
                }
                return@launch
            }
            refreshData()
            mutableState.update { it.copy(customerCreating = false) }
            onCreated()
        }
    }

    fun deleteCustomerCreation(operationId: String) {
        viewModelScope.launch {
            mutableState.update { it.copy(loading = true, error = null) }
            val result = repository.deleteCustomerCreation(operationId)
            if (result.isFailure) {
                mutableState.update {
                    it.copy(loading = false, error = result.exceptionOrNull()?.message)
                }
            } else {
                refreshData()
                mutableState.update { it.copy(loading = false) }
            }
        }
    }

    fun editCustomerCreation(operationId: String, request: CustomerCreateRequest, onEdited: () -> Unit) {
        viewModelScope.launch {
            mutableState.update { it.copy(customerCreating = true, error = null) }
            val result = repository.editCustomerCreation(operationId, request)
            if (result.isFailure) {
                mutableState.update {
                    it.copy(customerCreating = false, error = result.exceptionOrNull()?.message)
                }
            } else {
                refreshData()
                mutableState.update { it.copy(customerCreating = false) }
                onEdited()
            }
        }
    }

    fun dismissCustomerCreation(operationId: String) {
        viewModelScope.launch {
            val result = repository.dismissCustomerCreation(operationId)
            if (result.isFailure) {
                mutableState.update { it.copy(error = result.exceptionOrNull()?.message) }
            } else {
                refreshData()
            }
        }
    }

    suspend fun checkCustomerTaxNumber(taxNo: String): Result<Boolean> =
        repository.customerTaxNumberExists(taxNo)

    fun selectCustomer(customer: CustomerSummary) {
        mutableState.update { it.copy(selectedCustomer = customer, salesContext = null, loading = true, error = null) }
        viewModelScope.launch {
            try {
                val detail = repository.salesContext(customer.code)
                mutableState.update { it.copy(salesContext = detail, loading = false) }
            } catch (error: IOException) {
                mutableState.update { it.copy(salesContext = null, loading = false, error = error.message) }
            } catch (error: IllegalStateException) {
                mutableState.update { it.copy(salesContext = null, loading = false, error = error.message) }
            }
        }
    }

    fun submitCollection(
        operationId: String,
        customerCode: String,
        amount: Double,
        operationDate: String,
        description: String,
        onComplete: (Boolean) -> Unit,
    ) {
        viewModelScope.launch {
            mutableState.update { it.copy(loading = true, error = null) }
            val result = repository.submitCollection(operationId, customerCode, amount, operationDate, description)
            mutableState.update {
                it.copy(
                    loading = false,
                    error = result.exceptionOrNull()?.message,
                )
            }
            if (result.isSuccess) {
                state.value.selectedCustomer?.let(::selectCustomer)
            }
            onComplete(result.isSuccess)
        }
    }

    fun clearSelectedCustomer() {
        mutableState.update { it.copy(selectedCustomer = null, salesContext = null) }
    }

    fun createOrder(customer: CustomerSummary, onReady: (String) -> Unit) {
        createDraft(customer, "order", onReady)
    }

    fun createHotSale(customer: CustomerSummary, onReady: (String) -> Unit) {
        createDraft(customer, "van_sale", onReady)
    }

    private fun createDraft(customer: CustomerSummary, documentType: String, onReady: (String) -> Unit) {
        viewModelScope.launch {
            mutableState.update { it.copy(loading = true, error = null) }
            try {
                val salesContext = repository.salesContext(customer.code)
                mutableState.update { it.copy(selectedCustomer = customer, salesContext = salesContext) }
                val draftId = repository.createDraft(customer.code, documentType)
                loadDraft(draftId)
                if (documentType == "van_sale") loadHotSaleStockNow(null, refresh = true)
                onReady(draftId)
            } catch (error: IllegalStateException) {
                mutableState.update { it.copy(error = error.message) }
            } finally {
                mutableState.update { it.copy(loading = false) }
            }
        }
    }

    fun openDraft(draftId: String, onReady: () -> Unit) {
        viewModelScope.launch {
            loadDraft(draftId)
            if (state.value.activeDraft?.documentType == "van_sale") {
                loadHotSaleStockNow(state.value.saleCorrections[draftId], refresh = false)
            }
            onReady()
        }
    }

    fun reviewConflict(operation: OperationSummary, onReady: (String) -> Unit) {
        viewModelScope.launch {
            mutableState.update { it.copy(refreshing = true, error = null) }
            val pull = repository.pullChanges()
            if (pull.isFailure) {
                mutableState.update {
                    it.copy(
                        refreshing = false,
                        error = pull.exceptionOrNull()?.message ?: context.getString(R.string.error_generic),
                    )
                }
                return@launch
            }
            val sourceDraftId = operation.draftId
            if (sourceDraftId == null) {
                mutableState.update {
                    it.copy(refreshing = false, error = context.getString(R.string.error_draft_missing))
                }
                return@launch
            }
            val original = if (operation.error == "WORKDAY_NOT_OPEN") {
                try {
                    Json { ignoreUnknownKeys = true }.decodeFromString(
                        OrderPayload.serializer(), operation.payload,
                    )
                } catch (error: SerializationException) {
                    mutableState.update {
                        it.copy(refreshing = false, error = context.getString(R.string.error_unexpected_response))
                    }
                    return@launch
                }
            } else null
            val draft = repository.reviewConflict(sourceDraftId)
            if (draft == null) {
                mutableState.update {
                    it.copy(
                        refreshing = false,
                        error = operation.error ?: context.getString(R.string.error_draft_missing),
                    )
                }
                return@launch
            }
            original?.let {
                val promotion = if (it.skipPromotions) "SKIP" else it.selectedPromotionId?.let { id ->
                    listOfNotNull(id, it.selectedRewardProductCode).joinToString(":")
                }
                updateSaleSelections(draft, it.discountSelection.filterValues { selected -> selected }.keys, promotion)
            }
            loadDraft(draft)
            mutableState.update { it.copy(refreshing = false) }
            onReady(draft)
        }
    }

    fun changeQuantity(draftId: String, product: ProductSummary, unit: String, delta: Double) {
        viewModelScope.launch {
            try {
                repository.changeDraftQuantity(draftId, product.code, unit, delta)
                mutableState.update { it.copy(quote = null, error = null) }
                loadDraft(draftId)
            } catch (error: IllegalStateException) {
                mutableState.update { it.copy(error = error.message) }
            }
        }
    }

    fun saveHotSaleLine(
        draftId: String,
        product: ProductSummary,
        originalUnit: String?,
        originalQuantity: Double?,
        unit: String,
        quantity: Double,
        discountPercent: Double,
        onSaved: () -> Unit,
    ) {
        hotSaleLineStockMessage(draftId, product, originalUnit, unit, quantity)?.let { message ->
            mutableState.update { it.copy(error = message) }
            return
        }
        viewModelScope.launch {
            mutableState.update { it.copy(loading = true, quote = null, error = null) }
            try {
                if (originalUnit == null || originalQuantity == null) {
                    repository.changeDraftQuantity(draftId, product.code, unit, quantity)
                } else if (originalUnit == unit) {
                    repository.changeDraftQuantity(
                        draftId,
                        product.code,
                        unit,
                        quantity - originalQuantity,
                    )
                } else {
                    repository.changeDraftQuantity(draftId, product.code, originalUnit, -originalQuantity)
                    repository.changeDraftQuantity(draftId, product.code, unit, quantity)
                }
                repository.changeDraftDiscount(draftId, product.code, unit, discountPercent)
                loadDraft(draftId)
                onSaved()
            } catch (error: IllegalArgumentException) {
                mutableState.update { it.copy(error = error.message) }
            } catch (error: IllegalStateException) {
                mutableState.update { it.copy(error = error.message) }
            } finally {
                mutableState.update { it.copy(loading = false) }
            }
        }
    }

    fun loadUnitPrice(customerCode: String, productCode: String, unitCode: String, documentType: String) {
        val key = "$customerCode::$productCode::$unitCode::$documentType"
        if (key in mutableState.value.unitPrices || key in mutableState.value.loadingUnitPrices) return
        mutableState.update {
            it.copy(
                loadingUnitPrices = it.loadingUnitPrices + key,
                unitPriceErrors = it.unitPriceErrors - key,
            )
        }
        viewModelScope.launch {
            try {
                val price = repository.unitPrice(customerCode, productCode, unitCode, documentType)
                mutableState.update {
                    it.copy(
                        unitPrices = it.unitPrices + (key to price),
                        loadingUnitPrices = it.loadingUnitPrices - key,
                        unitPriceErrors = it.unitPriceErrors - key,
                    )
                }
            } catch (error: IOException) {
                mutableState.update {
                    it.copy(
                        loadingUnitPrices = it.loadingUnitPrices - key,
                        unitPriceErrors = it.unitPriceErrors + (key to (error.message ?: context.getString(R.string.error_generic))),
                    )
                }
            } catch (error: IllegalStateException) {
                mutableState.update {
                    it.copy(
                        loadingUnitPrices = it.loadingUnitPrices - key,
                        unitPriceErrors = it.unitPriceErrors + (key to (error.message ?: context.getString(R.string.error_generic))),
                    )
                }
            }
        }
    }

    fun changeDiscount(draftId: String, product: ProductSummary, unit: String, percent: Double) {
        viewModelScope.launch {
            try {
                repository.changeDraftDiscount(draftId, product.code, unit, percent)
                mutableState.update { it.copy(quote = null, error = null) }
                loadDraft(draftId)
            } catch (error: IllegalArgumentException) {
                mutableState.update { it.copy(error = error.message) }
            } catch (error: IllegalStateException) {
                mutableState.update { it.copy(error = error.message) }
            }
        }
    }

    fun captureBestLocation(onResult: (Result<LocationReading>) -> Unit) {
        viewModelScope.launch {
            val result = withTimeoutOrNull(20_000) {
                locationProvider.capture(timeoutMillis = 20_000)
            } ?: Result.failure(
                IllegalStateException("Konum 20 saniye içinde doğrulanamadı."),
            )
            onResult(result)
        }
    }

    fun startVisit(
        customerCode: String,
        location: LocationReading?,
        allowUnverifiedLocation: Boolean,
        unverifiedReason: String?,
        onCompleted: (Result<Unit>) -> Unit,
    ) {
        viewModelScope.launch {
            mutableState.update { it.copy(error = null) }
            if (repository.serverReachable.value != true) {
                val result = Result.failure<Unit>(IOException("Konum doğrulaması için internet bağlantısı gereklidir."))
                mutableState.update { it.copy(error = result.exceptionOrNull()?.message) }
                onCompleted(result)
                return@launch
            }
            val result = repository.queueVisitStart(
                customerCode,
                location,
                allowUnverifiedLocation,
                unverifiedReason,
            )
            refreshData()
            val unitResult = result.map { Unit }
            mutableState.update { it.copy(error = unitResult.exceptionOrNull()?.message ?: it.error) }
            onCompleted(unitResult)
        }
    }

    fun finishVisit(
        customerCode: String,
        result: String,
        note: String,
        onCompleted: (Result<Unit>) -> Unit,
    ) {
        viewModelScope.launch {
            val finished = repository.completeLatestVisit(customerCode, result, note)
            if (finished.isFailure) {
                val error = finished.exceptionOrNull()
                mutableState.update { it.copy(error = error?.message) }
                onCompleted(Result.failure(error ?: IllegalStateException("Ziyaret tamamlanamadı.")))
                return@launch
            }
            if (repository.serverReachable.value == true) repository.syncOutbox()
            refreshData()
            onCompleted(Result.success(Unit))
        }
    }

    fun quote(draftId: String, discountSelection: Map<String, Boolean> = emptyMap(), selectedPromotionId: String? = null) {
        viewModelScope.launch {
            mutableState.update { it.copy(loading = true, quote = null, error = null) }
            when (val quote = repository.quoteDraft(draftId, discountSelection, selectedPromotionId)) {
                is com.vdgida.vdesgo.sales.data.repository.QuoteOutcome.Available ->
                    mutableState.update { it.copy(loading = false, quote = quote.response) }
                is com.vdgida.vdesgo.sales.data.repository.QuoteOutcome.Failed ->
                    mutableState.update { it.copy(loading = false, error = quote.message) }
            }
        }
    }

    fun clearQuote() {
        mutableState.update { it.copy(quote = null) }
    }

    fun updateSaleSelections(draftId: String, discountSelection: Set<String>, selectedPromotionId: String?) {
        mutableState.update { current ->
            current.copy(
                quote = null,
                saleDiscountSelections = current.saleDiscountSelections + (draftId to discountSelection),
                saleSelectedPromotions = if (selectedPromotionId == null) {
                    current.saleSelectedPromotions - draftId
                } else {
                    current.saleSelectedPromotions + (draftId to selectedPromotionId)
                },
            )
        }
    }

    fun submitDraft(
        draftId: String,
        discountSelection: Map<String, Boolean> = emptyMap(),
        selectedPromotionId: String? = null,
        onQueued: () -> Unit,
    ) {
        viewModelScope.launch {
            mutableState.update { it.copy(loading = true, error = null) }
            val draft = repository.draft(draftId)
            if (draft != null) {
                val blocked = if (draft.documentType == "van_sale") {
                    repository.validateHotSaleStock(linesWithRewards(draft), null)
                } else null
                (blocked ?: creditLimitMessage(draft.customerCode))?.let { message ->
                    mutableState.update { it.copy(loading = false, error = message) }
                    return@launch
                }
            }
            val rewardSnapshot = if (draft?.documentType == "van_sale") state.value.quote.promotionalRewardLines() else emptyList()
            val result = repository.submitDraft(draftId, discountSelection, selectedPromotionId, rewardSnapshot)
            if (result.isFailure) {
                mutableState.update { it.copy(loading = false, error = result.exceptionOrNull()?.message) }
                return@launch
            }

            repository.syncOutbox()
            refreshData()
            loadDraft(draftId)
            if (draft?.documentType == "van_sale") loadHotSaleStockNow(null, refresh = false)
            mutableState.update { it.copy(loading = false) }
            onQueued()
        }
    }

    private suspend fun refreshData(): Boolean {
        mutableState.update { it.copy(refreshing = true) }
        try {
            val customers = repository.customers()
            val route = repository.todayRoute()
            val products = repository.products()
            val drafts = repository.drafts()
            val operations = repository.operations()
            val pendingCount = repository.pendingOperationCount()
            val lastSync = repository.currentSyncTime()
            val cursor = repository.syncCursor()
            mutableState.update { current ->
                val activeDraft = current.activeDraft?.let { active ->
                    drafts.firstOrNull { cached -> cached.id == active.id } ?: active
                }
                val selectedCustomer = current.selectedCustomer?.let { selected ->
                    (customers + route).firstOrNull { cached -> cached.code == selected.code }
                }
                val salesContext = selectedCustomer?.let { selected ->
                    current.salesContext?.copy(
                        customer = current.salesContext.customer.copy(visitState = selected.visitState),
                    )
                }
                current.copy(
                    customers = customers,
                    route = route,
                    products = products,
                    drafts = drafts,
                    operations = operations,
                    pendingCount = pendingCount,
                    lastSync = lastSync,
                    cursor = cursor,
                    selectedCustomer = selectedCustomer,
                    salesContext = salesContext,
                    activeDraft = activeDraft,
                    quote = if (activeDraft?.state == "access_revoked") null else current.quote,
                    refreshing = false,
                )
            }
            return true
        } catch (error: IOException) {
            mutableState.update { it.copy(refreshing = false, error = error.message) }
            return false
        } catch (error: IllegalStateException) {
            mutableState.update { it.copy(refreshing = false, error = error.message) }
            return false
        }
    }

    private suspend fun loadDraft(id: String) {
        val draft = repository.draft(id)
        mutableState.update { it.copy(activeDraft = draft, drafts = repository.drafts(), quote = null) }
    }
}
