package com.vdgida.vdesgo.sales.data

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.EncodeDefault
import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import androidx.annotation.StringRes
import com.vdgida.vdesgo.sales.R

@Serializable
@OptIn(ExperimentalSerializationApi::class)
data class DeviceLoginRequest(
    val username: String,
    val password: String,
    val deviceId: String,
    val deviceProof: String,
    @EncodeDefault
    val platform: String = "android",
    val appVersion: String,
)

@Serializable
data class SessionResponse(
    val token: String? = null,
    val tokenType: String? = null,
    val expiresAt: String? = null,
    val user: JsonObject? = null,
    val tenant: JsonObject? = null,
    val salesRepresentative: JsonObject? = null,
    val capabilities: JsonObject? = null,
    val device: DeviceResponse? = null,
    val message: String? = null,
)

@Serializable
data class WorkdaySession(
    val id: String,
    val businessDate: String,
    val routeDay: String,
    val status: String,
    val openingSnapshot: JsonObject,
    val closingSummary: JsonObject? = null,
    val openedAt: String? = null,
    val closedAt: String? = null,
    val openingOdometerKm: Double? = null,
    val suggestedOpeningOdometerKm: Double? = null,
    val closingOdometerKm: Double? = null,
    val traveledKm: Double? = null,
    val requiresClosing: Boolean = false,
    val currentDaySessionExists: Boolean = false,
    val currentDaySessionOpen: Boolean = false,
)

@Serializable
data class WorkdayCurrentResponse(
    val businessDate: String,
    val routeDay: String,
    val session: WorkdaySession? = null,
    val requiresClosing: Boolean = false,
    val currentDaySessionExists: Boolean = false,
    val currentDaySessionOpen: Boolean = false,
)

/** lastError for operations whose send was cancelled before the server response was stored. */
const val SYNC_CANCELLED_UNCONFIRMED = "SYNC_CANCELLED_UNCONFIRMED"

@Serializable
data class VehicleStockResponse(
    val warehouseCode: String? = null,
    val stock: List<JsonObject> = emptyList(),
    val serverTime: String? = null,
)

@Serializable
data class WorkdayOpenResponse(
    val session: WorkdaySession,
    val alreadyOpen: Boolean = false,
)

@Serializable
data class TodayRouteResponse(
    val routeDay: String,
    val stops: List<JsonObject> = emptyList(),
)

@Serializable
data class PriceSnapshotRequest(
    val customerCodes: List<String>,
)

@Serializable
data class CustomerTypeOption(
    val code: String,
    val name: String,
)

@Serializable
data class CustomerTypesResponse(
    val types: List<CustomerTypeOption> = emptyList(),
)

object CustomerIdentityRules {
    fun missingFieldsMessage(taxOffice: String, taxNo: String, tckn: String): String? {
        if (taxOffice.trim().isBlank()) return "Vergi dairesi zorunludur."
        if (taxNo.trim().isBlank() && tckn.trim().isBlank()) {
            return "VKN veya T.C. Kimlik Numarası (TCKN) girilmelidir."
        }
        if (taxNo.trim().isNotBlank() && !Regex("^\\d{10}$").matches(taxNo.trim())) {
            return "VKN 10 haneli rakamlardan oluşmalıdır."
        }
        if (tckn.trim().isNotBlank() && !Regex("^\\d{11}$").matches(tckn.trim())) {
            return "TCKN 11 haneli rakamlardan oluşmalıdır."
        }
        return null
    }

    fun isValid(taxOffice: String, taxNo: String, tckn: String): Boolean =
        missingFieldsMessage(taxOffice, taxNo, tckn) == null
}

@Serializable
data class CustomerCreateRequest(
    val customerCode: String = "",
    val ownerName: String = "",
    val businessTitle: String = "",
    val customerTypeCode: String = "",
    val phone: String = "",
    val mobilePhone: String = "",
    val taxNo: String,
    val taxOffice: String,
    val address: String = "",
    val location: String = "",
    val locationLatitude: Double,
    val locationLongitude: Double,
    val locationAccuracyM: Double,
    val locationCapturedAt: String,
    val routeDay: String = "",
    /** Maximum allowed debt balance in TL; null (omitted) means unlimited. */
    val creditLimit: Double? = null,
    val tckn: String = "",
)

@Serializable
data class CustomerTaxNumberCheckResponse(
    val exists: Boolean,
)

@Serializable
data class PriceSnapshotResponse(
    val businessDate: String,
    val priceRevision: String,
    val prices: List<PriceSnapshot> = emptyList(),
)

@Serializable
data class PriceSnapshot(
    val customerCode: String,
    val productCode: String,
    val unitCode: String,
    val documentType: String,
    val unitPrice: Double,
    val baseUnitPrice: Double,
    val innerQuantity: Double,
    val taxIncluded: Boolean,
    val source: String,
    val businessDate: String,
    val priceRevision: String = "0",
)

@Serializable
data class StockCountRequest(
    val productCode: String,
    val countedQuantity: Double,
)

@Serializable
data class WorkdayOpenRequest(
    val openingOdometerKm: Double,
)

@Serializable
data class WorkdayCloseRequest(
    val pendingOperationCount: Int,
    val closingOdometerKm: Double,
    val routeOrder: List<RouteOrderRequest>,
    val workSessionId: String? = null,
    val openingOdometerKm: Double? = null,
)

@Serializable
data class RouteOrderRequest(
    val customerCode: String,
    val position: Int,
)

@Serializable
data class CollectionSubmitRequest(
    val operationId: String,
    val clientCreatedAt: String,
    val payload: CollectionPayload,
)

@Serializable
data class CollectionPayload(
    val customerCode: String,
    val amount: Double,
    val operationDate: String,
    val description: String,
)

@Serializable
data class WorkdayCloseResponse(
    val id: String,
    val status: String,
    val closedAt: String? = null,
    val closingSummary: JsonObject? = null,
    val alreadyClosed: Boolean = false,
)

@Serializable
data class OutsideRouteResponse(
    val today: String,
    val days: List<String> = emptyList(),
    val assignments: List<OutsideRouteAssignment> = emptyList(),
)

@Serializable
data class OutsideRouteAssignment(
    val id: Int,
    val routeDay: String,
    val customerCode: String,
    val customerName: String,
    val customerTitle: String? = null,
    val province: String? = null,
    val district: String? = null,
    val balance: Double = 0.0,
    val salesRepresentativeName: String,
)

@Serializable
data class DeviceResponse(
    val id: String? = null,
    val status: String? = null,
)

@Serializable
data class BootstrapData(
    val customers: List<JsonObject> = emptyList(),
    val products: List<JsonObject> = emptyList(),
    val units: List<JsonObject> = emptyList(),
    val prices: List<JsonObject> = emptyList(),
    val promotions: List<JsonObject> = emptyList(),
    val route: List<JsonObject> = emptyList(),
)

@Serializable
data class BootstrapResponse(
    val data: BootstrapData = BootstrapData(),
    val nextPageToken: String? = null,
    val syncCursor: String = "0",
    val revisions: RevisionResponse = RevisionResponse(),
    val serverTime: String? = null,
    val priceTaxSemantics: String? = null,
    val pricingIsAuthoritative: Boolean = false,
    val stockIncluded: Boolean = false,
)

@Serializable
data class RevisionResponse(
    val priceRevision: String = "0",
    val promotionRevision: String = "0",
)

@Serializable
data class PullResponse(
    val changes: List<SyncChange> = emptyList(),
    val nextCursor: String,
    val hasMore: Boolean = false,
    val serverTime: String? = null,
)

@Serializable
data class SyncChange(
    val sequence: String,
    val entityType: String,
    val entityKey: String,
    val changeType: String,
    val record: JsonObject? = null,
)

@Serializable
data class SyncPushRequest(
    val deviceId: String,
    val batchId: String,
    val operations: List<OperationRequest>,
)

@Serializable
data class OperationRequest(
    val operationId: String,
    val type: String,
    val clientCreatedAt: String,
    val payload: JsonObject,
)

@Serializable
data class SyncPushResponse(
    val batchId: String,
    val results: List<OperationResult> = emptyList(),
    val serverTime: String? = null,
)

@Serializable
data class OperationResult(
    val operationId: String? = null,
    val status: String,
    val code: String? = null,
    val result: JsonElement? = null,
    val erpObjectType: String? = null,
    val erpObjectId: String? = null,
    val documentNumber: String? = null,
    val serverReceivedAt: String? = null,
    val processedAt: String? = null,
)

@Serializable
data class QuoteResponse(
    val quoteStatus: String,
    val orderCreated: Boolean = false,
    val code: String? = null,
    val result: JsonObject? = null,
    val serverTime: String? = null,
)

@Serializable
data class ApiErrorEnvelope(
    val error: ApiError? = null,
)

@Serializable
data class ApiError(
    val code: String? = null,
    val message: String? = null,
)

@Serializable
data class OrderPayload(
    val customerCode: String,
    val priceRevision: String,
    val promotionRevision: String,
    val lines: List<OrderLinePayload>,
    val discountSelection: Map<String, Boolean> = emptyMap(),
    val selectedPromotionId: String? = null,
    val selectedRewardProductCode: String? = null,
    val skipPromotions: Boolean = false,
    val requirePromotionSelection: Boolean = false,
    /**
     * Device-only snapshot of free promotional goods from the latest quote, used to reserve vehicle stock
     * locally. Never sent to the server (stripped before transport); the server re-evaluates promotions.
     */
    val stockRewardSnapshot: List<OrderLinePayload> = emptyList(),
)

const val STOCK_REWARD_SNAPSHOT_FIELD = "stockRewardSnapshot"

/** Paid lines plus the local free-goods snapshot: everything the sale takes out of the vehicle. */
fun OrderPayload.stockConsumingLines(): List<OrderLinePayload> = lines + stockRewardSnapshot

@Serializable
data class OrderLinePayload(
    val productCode: String,
    val unitCode: String,
    val quantity: Double,
    val manualDiscountPercent: Double = 0.0,
)

@Serializable
data class VisitStartPayload(
    val customerCode: String,
    val visitId: String,
    val latitude: Double? = null,
    val longitude: Double? = null,
    val accuracyM: Double? = null,
    val capturedAt: String? = null,
    val allowUnverifiedLocation: Boolean = false,
    val unverifiedReason: String? = null,
)

@Serializable
data class LocationReading(
    val latitude: Double,
    val longitude: Double,
    val accuracyM: Double,
    val capturedAt: String,
)

@Serializable
data class PendingLocationRequest(
    val id: String,
    val requestedAt: String,
    val expiresAt: String,
)

@Serializable
data class PendingLocationRequestResponse(
    val request: PendingLocationRequest? = null,
)

@Serializable
data class RoutePointUpload(
    val id: String,
    val workSessionId: String,
    val recordedAt: String,
    val latitude: Double,
    val longitude: Double,
    val accuracyM: Double,
    val speedMps: Double? = null,
    val bearingDegrees: Double? = null,
)

@Serializable
data class RoutePointUploadRequest(
    val requestId: String? = null,
    val points: List<RoutePointUpload>,
)

@Serializable
data class RoutePointUploadResponse(
    val acceptedIds: List<String> = emptyList(),
    val requestFulfilled: Boolean = false,
)

@Serializable
data class VisitCompletePayload(
    val visitId: String,
    val visitResult: String,
    val note: String = "",
    val latitude: Double? = null,
    val longitude: Double? = null,
)

@Serializable
data class QuoteRequest(val payload: OrderPayload)

@Serializable
data class SaleCorrectionRequest(val payload: OrderPayload)

@Serializable
data class AcceptedOrderSummary(
    @SerialName("orderId") val orderId: String? = null,
    val orderNo: String? = null,
    val serverAcceptedAt: String? = null,
    val subtotal: Double? = null,
    val promotionTotal: Double? = null,
    val discountTotal: Double? = null,
    val netTotal: Double? = null,
    val taxTotal: Double? = null,
    val grandTotal: Double? = null,
)

enum class OperationUiState(@StringRes val labelResource: Int) {
    PENDING(R.string.status_pending),
    SENDING(R.string.status_sending),
    ACCEPTED(R.string.status_accepted),
    CONFLICT(R.string.status_conflict),
    APPROVAL(R.string.status_approval),
    REJECTED(R.string.status_rejected),
    RETRY(R.string.status_retry),
    CANCEL_PENDING(R.string.status_cancel_pending),
    CANCELLED(R.string.status_cancelled);
    val storageState: String
        get() = when (this) {
            PENDING -> "pending"
            SENDING -> "sending"
            ACCEPTED -> "accepted"
            CONFLICT -> "conflict"
            APPROVAL -> "requires_approval"
            REJECTED -> "rejected"
            RETRY -> "retry"
            CANCEL_PENDING -> "cancel_pending"
            CANCELLED -> "cancelled"
        }
}

fun operationUiState(status: String): OperationUiState = when (status.lowercase()) {
    "sending" -> OperationUiState.SENDING
    "accepted" -> OperationUiState.ACCEPTED
    "conflict" -> OperationUiState.CONFLICT
    "requires_approval" -> OperationUiState.APPROVAL
    "rejected" -> OperationUiState.REJECTED
    "retry" -> OperationUiState.RETRY
    "cancel_pending" -> OperationUiState.CANCEL_PENDING
    "cancelled" -> OperationUiState.CANCELLED
    else -> OperationUiState.PENDING
}
