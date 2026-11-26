package com.vdgida.vdesgo.sales.data.repository

import android.content.Context
import android.util.Log
import com.vdgida.vdesgo.sales.BuildConfig
import com.vdgida.vdesgo.sales.R
import com.vdgida.vdesgo.sales.core.security.SecureStore
import com.vdgida.vdesgo.sales.core.security.UserSession
import com.vdgida.vdesgo.sales.data.ApiErrorEnvelope
import com.vdgida.vdesgo.sales.data.BootstrapResponse
import com.vdgida.vdesgo.sales.data.CollectionPayload
import com.vdgida.vdesgo.sales.data.CollectionSubmitRequest
import com.vdgida.vdesgo.sales.data.CustomerCreateRequest
import com.vdgida.vdesgo.sales.data.CustomerIdentityRules
import com.vdgida.vdesgo.sales.data.CustomerTypeOption
import com.vdgida.vdesgo.sales.data.DeviceLoginRequest
import com.vdgida.vdesgo.sales.data.OperationRequest
import com.vdgida.vdesgo.sales.data.OperationResult
import com.vdgida.vdesgo.sales.data.OperationUiState
import com.vdgida.vdesgo.sales.data.OutsideRouteAssignment
import com.vdgida.vdesgo.sales.data.PriceSnapshot
import com.vdgida.vdesgo.sales.data.PriceSnapshotRequest
import com.vdgida.vdesgo.sales.data.WorkdayCloseRequest
import com.vdgida.vdesgo.sales.data.WorkdayOpenRequest
import com.vdgida.vdesgo.sales.data.WorkdaySession
import com.vdgida.vdesgo.sales.data.RouteOrderRequest
import com.vdgida.vdesgo.sales.data.RoutePointUpload
import com.vdgida.vdesgo.sales.data.RoutePointUploadRequest
import com.vdgida.vdesgo.sales.data.operationUiState
import com.vdgida.vdesgo.sales.data.OrderLinePayload
import com.vdgida.vdesgo.sales.data.OrderPayload
import com.vdgida.vdesgo.sales.data.QuoteResponse
import com.vdgida.vdesgo.sales.data.SessionResponse
import com.vdgida.vdesgo.sales.data.SyncChange
import com.vdgida.vdesgo.sales.data.SyncPushRequest
import com.vdgida.vdesgo.sales.data.HotSaleStockRules
import com.vdgida.vdesgo.sales.data.SYNC_CANCELLED_UNCONFIRMED
import com.vdgida.vdesgo.sales.data.SaleStockOperation
import com.vdgida.vdesgo.sales.data.saleStockLines
import com.vdgida.vdesgo.sales.data.stockConsumingLines
import com.vdgida.vdesgo.sales.data.StockCartLine
import com.vdgida.vdesgo.sales.data.VehicleStockAvailability
import com.vdgida.vdesgo.sales.data.local.CachedVehicleStockEntity
import com.vdgida.vdesgo.sales.data.local.BootstrapRows
import com.vdgida.vdesgo.sales.data.local.CacheChange
import com.vdgida.vdesgo.sales.data.local.CachedCustomerEntity
import com.vdgida.vdesgo.sales.data.local.CachedPriceCandidateEntity
import com.vdgida.vdesgo.sales.data.local.CachedProductEntity
import com.vdgida.vdesgo.sales.data.local.CachedProductUnitEntity
import com.vdgida.vdesgo.sales.data.local.CachedPromotionCandidateEntity
import com.vdgida.vdesgo.sales.data.local.CachedRouteStopEntity
import com.vdgida.vdesgo.sales.data.local.DailyWorkSessionEntity
import com.vdgida.vdesgo.sales.data.local.OfflineDao
import com.vdgida.vdesgo.sales.data.local.OutboxOperationEntity
import com.vdgida.vdesgo.sales.data.local.OrderDraftEntity
import com.vdgida.vdesgo.sales.data.local.OrderDraftLineEntity
import com.vdgida.vdesgo.sales.data.local.PendingVisitEntity
import com.vdgida.vdesgo.sales.data.local.SyncStateEntity
import com.vdgida.vdesgo.sales.data.local.customerEntity
import com.vdgida.vdesgo.sales.data.local.priceEntity
import com.vdgida.vdesgo.sales.data.local.productEntity
import com.vdgida.vdesgo.sales.data.local.promotionEntity
import com.vdgida.vdesgo.sales.data.local.routeEntity
import com.vdgida.vdesgo.sales.data.local.unitEntity
import com.vdgida.vdesgo.sales.data.repository.OutsideRouteData
import com.vdgida.vdesgo.sales.data.remote.ApiConnectivity
import com.vdgida.vdesgo.sales.data.remote.ApiRequestTrace
import com.vdgida.vdesgo.sales.data.remote.MobileApi
import com.vdgida.vdesgo.sales.sync.SyncScheduler
import dagger.hilt.android.qualifiers.ApplicationContext
import java.io.IOException
import java.security.MessageDigest
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.TextStyle
import java.time.Instant
import java.util.UUID
import java.util.Locale
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.withContext
import kotlinx.serialization.SerializationException
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.put

@Serializable
private data class DailyPriceSnapshotMarker(
    val businessDate: String,
    val priceRevision: String,
    val routeDay: String = "",
    val customerCodes: List<String> = emptyList(),
    val priceCount: Int = 0,
)

internal fun operationPayloadForWorkSession(
    operationType: String,
    payload: JsonObject,
    workSessionId: String?,
    printedAt: String? = null,
    printNumber: String? = null,
): JsonObject {
    val transportPayload = payload - com.vdgida.vdesgo.sales.data.STOCK_REWARD_SNAPSHOT_FIELD
    return JsonObject(buildJsonObject {
        transportPayload.forEach { (key, value) -> put(key, value) }
        if (operationType != "customer.create" && workSessionId != null) {
            put("workSessionId", JsonPrimitive(workSessionId))
        }
        if (operationType == "sale.submit" && printedAt != null) {
            put("mobilePrintedAt", JsonPrimitive(printedAt))
            printNumber?.takeIf(String::isNotBlank)?.let {
                put("mobilePrintNumber", JsonPrimitive(it))
            }
        }
    })
}

internal fun customerCreationSyncFailure(
    operationState: String?,
    syncFailure: Throwable?,
): Throwable? = if (operationState == "accepted" || operationState == "retry") null else syncFailure

internal fun mergeTodayRouteCustomerCodes(
    markerCodes: List<String>,
    assignments: List<Pair<String, String>>,
    routeDay: String,
): List<String> = (markerCodes + assignments.filter { it.first == routeDay }.map { it.second }).distinct()

@Serializable
private data class CachedSalesContext(
    val businessDate: String,
    val balance: String? = null,
    val lastOrder: String? = null,
    val discountRates: Map<String, Double> = emptyMap(),
)

@Singleton
class MobileRepositoryImpl @Inject constructor(
    private val api: MobileApi,
    private val dao: OfflineDao,
    private val secureStore: SecureStore,
    private val json: Json,
    private val connectivity: ApiConnectivity,
    @ApplicationContext private val context: Context,
) : MobileRepository {
    private val sessionFlow = MutableStateFlow(secureStore.session())
    override val session: StateFlow<UserSession?> = sessionFlow.asStateFlow()
    override val serverReachable: StateFlow<Boolean?> = connectivity.reachability

    override suspend fun restoreSession(): UserSession? {
        val session = secureStore.session()
        sessionFlow.value = session
        return session
    }

    override suspend fun checkServer(): Boolean = withContext(Dispatchers.IO) {
        if (secureStore.session() == null) {
            connectivity.recordReachability(connectivity.newTrace("me"), false)
            return@withContext false
        }
        val trace = connectivity.newTrace("me")
        try {
            val response = api.me(trace)
            if (secureStore.session() == null) sessionFlow.value = null
            response.isSuccessful
        } catch (error: IOException) {
            logRequestFailure(trace, error)
            false
        } catch (error: SerializationException) {
            logResponseFailure(trace, error)
            false
        }
    }

    override suspend fun login(username: String, password: String): LoginOutcome = withContext(Dispatchers.IO) {
        val identity = secureStore.deviceIdentity()
        val trace = connectivity.newTrace("auth.session")
        secureStore.clearSession()
        sessionFlow.value = null
        try {
            val response = api.login(
                DeviceLoginRequest(
                    username = username.trim(),
                    password = password,
                    deviceId = identity.id,
                    deviceProof = identity.proof,
                    appVersion = BuildConfig.VERSION_NAME,
                ),
                trace,
            )
            val body = response.body()
            if (response.code() == 202 && body?.device?.status == "pending") {
                return@withContext LoginOutcome.DevicePending
            }
            if (!response.isSuccessful || body == null) {
                return@withContext LoginOutcome.Failed(responseError(response), responseCode(response))
            }
            val token = body.token ?: return@withContext LoginOutcome.Failed("Oturum bilgisi alınamadı.")
            val tenantCode = body.tenant?.string("code").orEmpty()
            val representativeId = body.salesRepresentative?.string("id").orEmpty()
            if (tenantCode.isBlank() || representativeId.isBlank()) {
                return@withContext LoginOutcome.Failed(context.getString(R.string.error_identity_missing))
            }
            val newScope = "$tenantCode:$representativeId:${body.user?.string("id").orEmpty()}"
            if (secureStore.cacheScope() != null && secureStore.cacheScope() != newScope) {
                dao.clearAllLocalData()
            }
            secureStore.setCacheScope(newScope)
            val session = UserSession(
                token = token,
                username = body.user?.string("username") ?: username.trim(),
                representativeName = body.salesRepresentative?.string("name").orEmpty(),
                tenantCode = tenantCode,
                representativeId = representativeId,
                expiresAt = body.expiresAt,
                role = body.user?.string("role").orEmpty(),
                capabilities = body.capabilities.orEmpty()
                    .filterValues { it.jsonPrimitive.booleanOrNull == true }.keys,
                deviceStatus = body.device?.status.orEmpty(),
            )
            secureStore.storeSession(session)
            sessionFlow.value = session
            if (!session.capabilities.containsAll(setOf("mobile.sync", "mobile.customer.read", "mobile.route.read"))) {
                dao.clearAllLocalData()
            }
            LoginOutcome.Authorized(session)
        } catch (error: IOException) {
            logRequestFailure(trace, error)
            LoginOutcome.Failed(context.getString(R.string.error_connection))
        } catch (error: SerializationException) {
            logResponseFailure(trace, error)
            LoginOutcome.Failed(context.getString(R.string.error_unexpected_response))
        }
    }

    override suspend fun logout() = withContext(Dispatchers.IO) {
        val trace = connectivity.newTrace("auth.logout")
        try {
            if (secureStore.session() != null) api.logout(trace)
        } catch (error: IOException) {
            logRequestFailure(trace, error)
            // Local logout must remain available while offline.
        } finally {
            secureStore.clearSession()
            secureStore.clearCacheScope()
            sessionFlow.value = null
            dao.clearAllLocalData()
        }
    }

    override suspend fun refreshBootstrap(): Result<Unit> = withContext(Dispatchers.IO) {
        if (secureStore.session() == null) return@withContext Result.failure(IOException("Oturum gerekli."))
        var trace: ApiRequestTrace? = null
        var attempt = 0
        try {
            var state = dao.syncState()
            if (state?.bootstrapComplete == true) {
                val customerCacheNeedsRefresh = dao.customers().any { row ->
                    val customer = json.decodeFromString<JsonObject>(row.payload)
                    listOf(
                        "customerDiscount1", "customerDiscount2", "customerDiscount3", "cashDiscount",
                        "deferredDiscount",
                    ).any { it !in customer }
                }
                val productCacheNeedsRefresh = dao.products().any { row ->
                    val product = json.decodeFromString<JsonObject>(row.payload)
                    listOf("ePoint", "weight", "volume", "imageDataUrl").any { it !in product }
                }
                if (!customerCacheNeedsRefresh && !productCacheNeedsRefresh) {
                    return@withContext Result.success(Unit)
                }
                state = state.copy(nextPageToken = null, bootstrapStarted = false, bootstrapComplete = false)
                dao.saveSyncState(state)
            }
            var pageToken = state?.nextPageToken
            var firstPage = state?.bootstrapStarted != true
            do {
                trace = connectivity.newTrace("bootstrap", attempt = ++attempt)
                val response = api.bootstrap(pageToken = pageToken, trace = trace)
                if (!response.isSuccessful) return@withContext Result.failure(apiException(response))
                val page = response.body()
                    ?: return@withContext Result.failure(unreadableResponse(trace, null))
                val currentState = state ?: SyncStateEntity()
                val nextState = currentState.copy(
                    nextPageToken = page.nextPageToken,
                    bootstrapStarted = true,
                    bootstrapComplete = page.nextPageToken == null,
                    cursor = if (firstPage) page.syncCursor else currentState.cursor,
                    priceRevision = page.revisions.priceRevision,
                    promotionRevision = page.revisions.promotionRevision,
                    lastSyncAt = page.serverTime,
                )
                dao.persistBootstrapPage(page.rows(), nextState, firstPage)
                state = nextState
                pageToken = page.nextPageToken
                firstPage = false
            } while (pageToken != null)
            Result.success(Unit)
        } catch (error: IOException) {
            Result.failure(requestFailure(trace, error))
        } catch (error: SerializationException) {
            Result.failure(unreadableResponse(trace, error))
        } catch (error: IllegalStateException) {
            Result.failure(error)
        }
    }

    override suspend fun pullChanges(): Result<Unit> = withContext(Dispatchers.IO) {
        if (secureStore.session() == null) return@withContext Result.failure(IOException("Oturum gerekli."))
        var trace: ApiRequestTrace? = null
        var attempt = 0
        try {
            var state = dao.syncState() ?: SyncStateEntity()
            if (!state.bootstrapComplete) {
                val bootstrap = refreshBootstrap()
                if (bootstrap.isFailure) return@withContext bootstrap
                state = dao.syncState() ?: SyncStateEntity()
            }
            var hasMore: Boolean
            do {
                trace = connectivity.newTrace("sync.pull", attempt = ++attempt)
                val response = api.pull(cursor = state.cursor, trace = trace)
                if (!response.isSuccessful) return@withContext Result.failure(apiException(response))
                val page = response.body()
                    ?: return@withContext Result.failure(unreadableResponse(trace, null))
                val newState = state.copy(
                    cursor = page.nextCursor,
                    lastSyncAt = page.serverTime,
                    priceRevision = page.changes.filter {
                        it.entityType in setOf(
                            "price", "price_list_item", "customer_product_price",
                            "customer_price_list", "distributor_price_list",
                        )
                    }
                        .mapNotNull { it.sequence.toLongOrNull() }.maxOrNull()?.toString() ?: state.priceRevision,
                    promotionRevision = page.changes.filter { it.entityType == "promotion" }
                        .mapNotNull { it.sequence.toLongOrNull() }.maxOrNull()?.toString() ?: state.promotionRevision,
                )
                dao.persistPullPage(page.changes.map { it.cacheChange }, newState)
                state = newState
                hasMore = page.hasMore
            } while (hasMore)
            Result.success(Unit)
        } catch (error: IOException) {
            Result.failure(requestFailure(trace, error))
        } catch (error: SerializationException) {
            Result.failure(unreadableResponse(trace, error))
        } catch (error: IllegalStateException) {
            Result.failure(error)
        }
    }

    override suspend fun syncOutbox(): Result<Unit> = withContext(Dispatchers.IO) {
        if (secureStore.session() == null) return@withContext Result.failure(IOException("Oturum gerekli."))
        var trace: ApiRequestTrace? = null
        var claimedIds: List<String> = emptyList()
        try {
            dao.resetInterruptedOperations()
            var syncFailure: Throwable? = syncPendingPrintReports()
            syncPendingSaleCancellations()?.let { if (syncFailure == null) syncFailure = it }
            val candidates = dao.pendingOperations(50)
            val pending = candidates.filter { dao.claimPendingOperation(it.operationId) > 0 }
            claimedIds = pending.map { it.operationId }
            if (pending.isNotEmpty()) {
                val identity = secureStore.deviceIdentity()
                val openWorkSessionId = cachedWorkSession()
                    ?.takeIf { it.status == "open" }
                    ?.id
                val request = SyncPushRequest(
                    deviceId = identity.id,
                    batchId = UUID.randomUUID().toString(),
                    operations = pending.map { operation ->
                        val payload = json.decodeFromString<JsonObject>(operation.payload)
                        val scopedPayload = operationPayloadForWorkSession(
                            operation.type,
                            payload,
                            openWorkSessionId,
                            operation.printedAt,
                            operation.printNumber,
                        )
                        OperationRequest(
                            operationId = operation.operationId,
                            type = operation.type,
                            clientCreatedAt = operation.clientCreatedAt,
                            payload = scopedPayload,
                        )
                    },
                )
                trace = connectivity.newTrace(
                    requestType = "sync.push",
                    operationId = pending.firstOrNull()?.operationId,
                    attempt = (pending.firstOrNull()?.retryCount ?: 0) + 1,
                )
                val response = api.push(request, trace)
                if (!response.isSuccessful) {
                    pending.forEach { operation ->
                        dao.updateOutboxState(
                            operation.operationId, "retry", operation.retryCount + 1,
                            responseError(response), operation.result, operation.documentNumber,
                        )
                    }
                    return@withContext Result.failure(apiException(response))
                }
                val pushResult = response.body() ?: return@withContext Result.failure(unreadableResponse(trace, null))
                if (pushResult.batchId != request.batchId) {
                    return@withContext Result.failure(unreadableResponse(trace, null))
                }
                val byId = pushResult.results.associateBy { it.operationId }
                // The server has committed these results; persist them even if the user cancels now.
                val transientFailure = withContext(NonCancellable) {
                var transientFailure = false
                pending.forEach { operation ->
                    val result = byId[operation.operationId]
                    val status = result?.status ?: "retry"
                    val uiState = operationUiState(status)
                    val serializedResult = result?.result?.let { json.encodeToString(it) }
                    val lastError = if (status == "retry") result?.code ?: "RETRYABLE_ERROR" else result?.code
                    dao.updateOperationResult(
                        id = operation.operationId,
                        state = uiState.storageState,
                        retryCount = if (uiState == OperationUiState.RETRY) operation.retryCount + 1 else operation.retryCount,
                        error = lastError,
                        result = serializedResult,
                        documentNumber = result?.documentNumber,
                        draftId = operation.draftId,
                    )
                    if (operation.type == "sale.submit"
                        && operation.cancellationRequested
                        && uiState in setOf(
                            OperationUiState.REJECTED,
                            OperationUiState.CONFLICT,
                            OperationUiState.APPROVAL,
                        )) {
                        dao.markSaleCancelled(operation.operationId)
                    }
                    if (operation.type == "customer.create") {
                        val provisionalCode = runCatching {
                            json.decodeFromString<CustomerCreateRequest>(operation.payload).customerCode
                        }.getOrNull()
                        if (uiState == OperationUiState.ACCEPTED) {
                            val resultObject = result?.result as? JsonObject
                            val createdCustomer = resultObject?.get("customer") as? JsonObject
                            val assignment = resultObject?.get("assignment") as? JsonObject
                            if (createdCustomer != null && assignment != null) {
                                if (provisionalCode == null) throw unreadableResponse(trace, null)
                                dao.replaceProvisionalCustomer(
                                    provisionalCode,
                                    createdCustomer.customerEntity(),
                                    assignment.routeEntity(),
                                )
                            } else {
                                throw unreadableResponse(trace, null)
                            }
                        } else if (uiState == OperationUiState.REJECTED && provisionalCode != null) {
                            dao.removeProvisionalCustomer(provisionalCode)
                        }
                    }
                    updateVisitState(operation, status)
                    if (uiState == OperationUiState.RETRY) transientFailure = true
                }
                transientFailure
                }
                claimedIds = emptyList()
                if (pending.any { it.type == "sale.submit" } && byId.values.any { it.status == "accepted" }) {
                    runCatching { currentVehicleStock() }
                }
                if (transientFailure) {
                    return@withContext Result.failure(IOException(context.getString(R.string.error_transient)))
                }
            }
            syncPendingSaleCancellations()?.let { if (syncFailure == null) syncFailure = it }
            val pullResult = pullChanges()
            if (pullResult.isFailure) return@withContext pullResult
            syncFailure?.let { return@withContext Result.failure(it) }
            Result.success(Unit)
        } catch (error: CancellationException) {
            if (claimedIds.isNotEmpty()) {
                // Unconfirmed sends stay queued; the idempotent operationId lets the next sync confirm them.
                withContext(NonCancellable) {
                    dao.markInterruptedOperations(claimedIds, SYNC_CANCELLED_UNCONFIRMED)
                }
            }
            throw error
        } catch (error: IOException) {
            Result.failure(requestFailure(trace, error))
        } catch (error: SerializationException) {
            Result.failure(unreadableResponse(trace, error))
        } catch (error: IllegalStateException) {
            Result.failure(error)
        }
    }

    override suspend fun customers(): List<CustomerSummary> = withContext(Dispatchers.IO) {
        dao.customers().mapNotNull { row ->
            try {
                val value = json.parseToJsonElement(row.payload).jsonObject
                CustomerSummary(
                    code = value.string("code"),
                    name = value.string("name").ifBlank { value.string("title") },
                    address = value.stringOrNull("address"),
                    phone = value.stringOrNull("phone") ?: value.stringOrNull("mobilePhone"),
                    province = value.stringOrNull("province"),
                    district = value.stringOrNull("district"),
                    visitState = dao.latestVisit(row.code)?.state,
                    title = value.stringOrNull("title"),
                    taxOffice = value.stringOrNull("taxOffice"),
                    taxNo = value.stringOrNull("taxNo"),
                    tckn = value.stringOrNull("tckn"),
                    balance = value.stringOrNull("balance"),
                    creditLimit = value.creditLimit(),
                    openOrderAmount = value.openOrderAmount(),
                    locationLatitude = value.doubleOrNull("locationLatitude"),
                    locationLongitude = value.doubleOrNull("locationLongitude"),
                    locationAccuracyM = value.doubleOrNull("locationAccuracyM"),
                    locationCapturedAt = value.stringOrNull("locationCapturedAt"),
                )
            } catch (_: SerializationException) {
                null
            }
        }
    }

    override suspend fun customerTypes(): List<CustomerTypeOption> = withContext(Dispatchers.IO) {
        val trace = connectivity.newTrace("customer-types")
        try {
            val response = api.customerTypes(trace)
            if (!response.isSuccessful) throw apiException(response)
            response.body()?.types ?: throw unreadableResponse(trace, null)
        } catch (error: IOException) {
            throw requestFailure(trace, error)
        } catch (error: SerializationException) {
            throw unreadableResponse(trace, error)
        }
    }

    override suspend fun customerTaxNumberExists(taxNo: String): Result<Boolean> = withContext(Dispatchers.IO) {
        val trace = connectivity.newTrace("customer-tax-number-check")
        try {
            val response = api.customerTaxNumberCheck(taxNo.trim(), trace)
            if (!response.isSuccessful) return@withContext Result.failure(apiException(response))
            val body = response.body() ?: return@withContext Result.failure(unreadableResponse(trace, null))
            Result.success(body.exists)
        } catch (error: IOException) {
            Result.failure(requestFailure(trace, error))
        } catch (error: SerializationException) {
            Result.failure(unreadableResponse(trace, error))
        }
    }

    override suspend fun createCustomer(request: CustomerCreateRequest): Result<Unit> = withContext(Dispatchers.IO) {
        try {
            val routeDay = request.routeDay.ifBlank {
                cachedWorkSession()?.routeDay ?: dayInIstanbul()
            }
            CustomerIdentityRules.missingFieldsMessage(request.taxOffice, request.taxNo, request.tckn)?.let {
                return@withContext Result.failure(IOException(it))
            }
            if (request.customerTypeCode.isBlank()) {
                return@withContext Result.failure(IOException("Müşteri tipi seçilmelidir."))
            }
            if (routeDay.isBlank()) {
                return@withContext Result.failure(IOException("Rut günü seçilmelidir."))
            }
            if (!request.locationAccuracyM.isFinite() || request.locationAccuracyM <= 0.0
                || request.locationAccuracyM > 50.0
                || !request.locationLatitude.isFinite() || !request.locationLongitude.isFinite()) {
                return@withContext Result.failure(IOException("Geçerli bir konum kaydı alınmalıdır."))
            }
            val queuedRequest = request.copy(
                customerCode = request.customerCode.ifBlank { "MOB-${UUID.randomUUID()}" },
                routeDay = routeDay,
            )
            if (connectivity.reachability.value == true) {
                for (number in listOf(queuedRequest.taxNo, queuedRequest.tckn).filter(String::isNotBlank).distinct()) {
                    val duplicateCheck = customerTaxNumberExists(number)
                    if (duplicateCheck.isSuccess && duplicateCheck.getOrThrow()) {
                        return@withContext Result.failure(IOException("Bu VKN veya TCKN ile kayıtlı bir müşteri zaten var."))
                    }
                }
            }
            val operationId = UUID.randomUUID().toString()
            val createdAt = Instant.now().toString()
            val payload = json.encodeToString(CustomerCreateRequest.serializer(), queuedRequest)
            val customerName = queuedRequest.ownerName.ifBlank {
                queuedRequest.businessTitle.ifBlank { "Müşteri ${queuedRequest.taxNo.ifBlank { queuedRequest.tckn }}" }
            }
            val customerRecord = buildJsonObject {
                put("code", queuedRequest.customerCode)
                put("name", customerName)
                put("title", queuedRequest.businessTitle)
                put("phone", queuedRequest.phone)
                put("mobilePhone", queuedRequest.mobilePhone)
                put("taxNo", queuedRequest.taxNo)
                put("tckn", queuedRequest.tckn)
                put("taxOffice", queuedRequest.taxOffice)
                put("address", queuedRequest.address)
                put("location", queuedRequest.location)
                put("locationLatitude", queuedRequest.locationLatitude)
                put("locationLongitude", queuedRequest.locationLongitude)
                put("locationAccuracyM", queuedRequest.locationAccuracyM)
                put("locationCapturedAt", queuedRequest.locationCapturedAt)
                put("balance", "0")
                queuedRequest.creditLimit?.let { put("creditLimit", it) }
            }
            val routeRecord = buildJsonObject {
                put("id", "pending:${queuedRequest.customerCode}")
                put("customerCode", queuedRequest.customerCode)
                put("routeDay", routeDay)
            }
            dao.storeCustomerCreation(
                OutboxOperationEntity(
                    operationId = operationId,
                    type = "customer.create",
                    payload = payload,
                    clientCreatedAt = createdAt,
                ),
                customerRecord.customerEntity(),
                CachedRouteStopEntity(
                    id = "pending:${queuedRequest.customerCode}",
                    customerCode = queuedRequest.customerCode,
                    routeDay = routeDay,
                    payload = json.encodeToString(routeRecord),
                ),
            )
            SyncScheduler.enqueue(context)
            if (connectivity.reachability.value == true) {
                val syncResult = syncOutbox()
                val operation = dao.outboxOperation(operationId)
                if (operation?.state == "rejected") {
                    return@withContext Result.failure(
                        IOException(
                            when (operation.lastError) {
                                "DUPLICATE_TAX_NUMBER" -> "Bu VKN veya TCKN ile kayıtlı bir müşteri zaten var."
                                "INVALID_CUSTOMER_TYPE" -> "Seçilen müşteri türü artık kullanılamıyor."
                                "INVALID_CREDIT_LIMIT" -> "Maksimum borç bakiyesi geçersiz. Boş bırakın veya 0 ya da pozitif bir tutar girin."
                                else -> "Müşteri kaydı sunucu tarafından reddedildi: ${operation.lastError ?: "bilinmeyen hata"}"
                            },
                        ),
                    )
                }
                customerCreationSyncFailure(operation?.state, syncResult.exceptionOrNull())?.let {
                    return@withContext Result.failure(it)
                }
            }
            Result.success(Unit)
        } catch (error: IOException) {
            Result.failure(error)
        } catch (error: SerializationException) {
            Result.failure(error)
        } catch (error: IllegalStateException) {
            Result.failure(error)
        }
    }

    override suspend fun customer(code: String): CustomerSummary? =
        customers().firstOrNull { it.code == code }

    override suspend fun salesContext(code: String): SalesContextSummary? = withContext(Dispatchers.IO) {
        val isTodayRouteCustomer = isTodayRouteCustomer(code)
        if (isTodayRouteCustomer) {
            try {
                cachedSalesContext(code)?.let { return@withContext it }
            } catch (error: SerializationException) {
                throw IllegalStateException("Yerel cari iskonto bilgisi okunamadı.", error)
            } catch (error: IOException) {
                throw IllegalStateException(error.message ?: "Yerel cari iskonto bilgisi okunamadı.", error)
            }
        }
        val trace = connectivity.newTrace("sales-context")
        try {
            val response = api.salesContext(code, trace)
            if (response.isSuccessful) {
                val body = response.body() ?: return@withContext null
                val customer = body["customer"]?.jsonObject ?: return@withContext null
                val discountRates = body["discounts"]?.jsonObject?.mapNotNull { (key, value) ->
                    value.jsonPrimitive.contentOrNull?.toDoubleOrNull()?.let { key to it }
                }?.toMap().orEmpty()
                val lastOrder = body["lastOrder"]?.takeUnless { it.toString() == "null" }?.jsonObject
                val lastOrderLabel = lastOrder?.let {
                    listOfNotNull(
                        it.stringOrNull("orderNo"),
                        it.stringOrNull("orderDate"),
                        it.stringOrNull("totalAmount")?.let { amount -> "${amount} TL" },
                    ).joinToString(" · ")
                }?.takeIf(String::isNotBlank)
                val accountMovements = body["accountMovements"]?.let {
                    runCatching { it.jsonArray }.getOrNull()
                }.orEmpty().mapNotNull { item ->
                    val movement = item.jsonObject
                    val amount = movement.stringOrNull("balanceEffect")?.toDoubleOrNull()
                        ?: return@mapNotNull null
                    AccountMovementSummary(
                        date = movement.stringOrNull("date").orEmpty(),
                        type = movement.stringOrNull("type").orEmpty(),
                        reference = movement.stringOrNull("reference"),
                        description = movement.stringOrNull("description"),
                        balanceEffect = amount,
                    )
                }
                val salesContext = SalesContextSummary(
                    customer = customer.toCustomer(),
                    balance = customer.stringOrNull("balance"),
                    lastOrder = lastOrderLabel,
                    discountRates = discountRates,
                    accountMovements = accountMovements,
                )
                cacheSalesContext(code, customer, salesContext)
                return@withContext salesContext
            }
            if (response.code() == 401 || secureStore.session() == null) sessionFlow.value = null
            if (isTodayRouteCustomer) {
                cachedSalesContext(code) ?: customer(code)?.let { SalesContextSummary(it, null, null) }
            } else {
                throw IOException(responseError(response))
            }
        } catch (error: IOException) {
            if (isTodayRouteCustomer) {
                logRequestFailure(trace, error)
                cachedSalesContext(code) ?: customer(code)?.let { SalesContextSummary(it, null, null) }
            } else {
                throw requestFailure(trace, error)
            }
        } catch (error: SerializationException) {
            if (isTodayRouteCustomer) {
                logResponseFailure(trace, error)
                cachedSalesContext(code) ?: customer(code)?.let { SalesContextSummary(it, null, null) }
            } else {
                throw unreadableResponse(trace, error)
            }
        }
    }

    private suspend fun cachedSalesContext(code: String): SalesContextSummary? {
        val row = dao.customer(code) ?: return null
        val customer = try {
            json.decodeFromString<JsonObject>(row.payload)
        } catch (error: SerializationException) {
            throw IllegalStateException("Yerel cari bilgisi okunamadı.", error)
        }
        val date = dailyBusinessDate()
        val storedContext = customer["salesContextCache"]?.let {
            try {
                json.decodeFromString<CachedSalesContext>(json.encodeToString(it))
            } catch (error: SerializationException) {
                throw IllegalStateException("Yerel cari iskonto bilgisi okunamadı.", error)
            }
        }?.takeIf { it.businessDate == date }
        if (storedContext != null) {
            return SalesContextSummary(
                customer = customer.toCustomer(),
                balance = storedContext.balance,
                lastOrder = storedContext.lastOrder,
                discountRates = storedContext.discountRates,
            )
        }

        val discountFields = listOf(
            "customerDiscount1", "customerDiscount2", "customerDiscount3", "cashDiscount", "deferredDiscount",
        )
        if (discountFields.any { it !in customer }) return null
        val context = CachedSalesContext(
            businessDate = date,
            balance = customer.stringOrNull("balance"),
            discountRates = discountRates(customer),
        )
        saveCachedSalesContext(row, customer, context)
        return SalesContextSummary(
            customer = customer.toCustomer(),
            balance = context.balance,
            lastOrder = context.lastOrder,
            discountRates = context.discountRates,
        )
    }

    private fun discountRates(customer: JsonObject): Map<String, Double> = mapOf(
        "m1" to "customerDiscount1",
        "m2" to "customerDiscount2",
        "m3" to "customerDiscount3",
        "cash" to "cashDiscount",
        "deferred" to "deferredDiscount",
    ).mapNotNull { (key, field) ->
        customer.stringOrNull(field)?.replace(',', '.')?.toDoubleOrNull()?.let { key to it }
            ?: if (field in customer) key to 0.0 else null
    }.toMap()

    private suspend fun cacheSalesContext(
        code: String,
        customer: JsonObject,
        context: SalesContextSummary,
    ) {
        val row = dao.customer(code)
        val existing = row?.let {
            try {
                json.decodeFromString<JsonObject>(it.payload)
            } catch (error: SerializationException) {
                throw IllegalStateException("Yerel cari bilgisi güncellenemedi.", error)
            }
        }.orEmpty()
        val merged = JsonObject(existing + customer)
        saveCachedSalesContext(
            row ?: CachedCustomerEntity(code, code, json.encodeToString(merged)),
            merged,
            CachedSalesContext(
                businessDate = dailyBusinessDate(),
                balance = context.balance,
                lastOrder = context.lastOrder,
                discountRates = context.discountRates,
            ),
        )
    }

    private suspend fun saveCachedSalesContext(
        row: CachedCustomerEntity,
        customer: JsonObject,
        context: CachedSalesContext,
    ) {
        val payload = JsonObject(
            customer + ("salesContextCache" to json.encodeToJsonElement(CachedSalesContext.serializer(), context)),
        )
        dao.putCustomers(listOf(row.copy(payload = json.encodeToString(payload))))
    }

    private suspend fun cacheOpeningRouteCustomers(session: WorkdaySession) {
        val route = session.openingSnapshot["route"] as? JsonArray ?: return
        route.forEach { element ->
            val item = element as? JsonObject ?: throw IOException("Günlük rota müşteri kaydı geçersiz.")
            val customerCode = item.stringOrNull("customerCode")
                ?: throw IOException("Günlük rotada cari kodu eksik.")
            val row = dao.customer(customerCode)
            val existing = row?.let {
                try {
                    json.decodeFromString<JsonObject>(it.payload)
                } catch (error: SerializationException) {
                    throw IllegalStateException("Yerel cari bilgisi güncellenemedi.", error)
                }
            }.orEmpty()
            val fieldMappings = mapOf(
                "code" to "customerCode",
                "name" to "customerName",
                "title" to "customerTitle",
                "province" to "province",
                "district" to "district",
                "phone" to "phone",
                "mobilePhone" to "mobilePhone",
                "address" to "address",
                "taxNo" to "taxNo",
                "tckn" to "tckn",
                "taxOffice" to "taxOffice",
                "balance" to "balance",
                "creditLimit" to "creditLimit",
                "openOrderAmount" to "openOrderAmount",
                "customerDiscount1" to "customerDiscount1",
                "customerDiscount2" to "customerDiscount2",
                "customerDiscount3" to "customerDiscount3",
                "cashDiscount" to "cashDiscount",
                "deferredDiscount" to "deferredDiscount",
            )
            val merged = existing + fieldMappings.mapNotNull { (target, source) ->
                item[source]?.let { target to it }
            }
            val customer = JsonObject(merged)
            val context = CachedSalesContext(
                businessDate = session.businessDate,
                balance = customer.stringOrNull("balance"),
                discountRates = discountRates(customer),
            )
            saveCachedSalesContext(
                row ?: CachedCustomerEntity(customerCode, customerCode, json.encodeToString(customer)),
                customer,
                context,
            )
        }
    }

    override suspend fun unitPrice(
        customerCode: String,
        productCode: String,
        unitCode: String,
        documentType: String,
    ): UnitPriceSummary =
        withContext(Dispatchers.IO) {
            val businessDate = businessDate()
            if (isTodayRouteCustomer(customerCode)) {
                val cached = cachedPrice(
                    customerCode,
                    productCode,
                    unitCode,
                    documentType,
                    businessDate,
                )
                if (cached != null) return@withContext cached.toUnitPriceSummary()
            }
            val trace = connectivity.newTrace("unit-price")
            val response = try {
                api.unitPrice(customerCode, productCode, unitCode, documentType, trace)
            } catch (error: IOException) {
                logRequestFailure(trace, error)
                throw error
            }
            if (!response.isSuccessful) {
                if (response.code() == 401 || secureStore.session() == null) sessionFlow.value = null
                throw IOException(responseError(response))
            }
            val body = response.body() ?: throw IOException(context.getString(R.string.error_generic))
            val price = body["unitPrice"]?.jsonPrimitive?.contentOrNull?.toDoubleOrNull()
                ?: throw IOException(context.getString(R.string.error_generic))
            if (!price.isFinite() || price <= 0.0) {
                throw IOException(context.getString(R.string.error_generic))
            }
            val basePrice = body["baseUnitPrice"]?.jsonPrimitive?.contentOrNull?.toDoubleOrNull() ?: price
            val innerQuantity = body["innerQuantity"]?.jsonPrimitive?.contentOrNull?.toDoubleOrNull() ?: 1.0
            if (!basePrice.isFinite() || basePrice <= 0.0 || !innerQuantity.isFinite() || innerQuantity <= 0.0) {
                throw IOException(context.getString(R.string.error_generic))
            }
            val snapshot = PriceSnapshot(
                customerCode = customerCode,
                productCode = productCode,
                unitCode = unitCode,
                documentType = documentType,
                unitPrice = price,
                baseUnitPrice = basePrice,
                innerQuantity = innerQuantity,
                taxIncluded = body["taxIncluded"]?.jsonPrimitive?.booleanOrNull ?: false,
                source = body["source"]?.jsonPrimitive?.contentOrNull.orEmpty(),
                businessDate = businessDate,
                priceRevision = body["priceRevision"]?.jsonPrimitive?.contentOrNull
                    ?: dao.syncState()?.priceRevision ?: "0",
            )
            dao.putPrices(listOf(snapshot.toCacheEntity()))
            snapshot.toUnitPriceSummary()
        }

    private fun businessDate(): String =
        LocalDate.now(ZoneId.of("Europe/Istanbul")).toString()

    private fun dayInIstanbul(): String =
        LocalDate.now(ZoneId.of("Europe/Istanbul")).dayOfWeek
            .getDisplayName(TextStyle.FULL, Locale("tr", "TR"))
            .replaceFirstChar { it.titlecase(Locale("tr", "TR")) }

    private suspend fun dailyBusinessDate(): String =
        cachedWorkSession()?.businessDate ?: businessDate()

    private fun unitPriceCacheId(
        businessDate: String,
        customerCode: String,
        productCode: String,
        unitCode: String,
        documentType: String,
    ): String {
        val key = listOf(businessDate, customerCode, productCode, unitCode, documentType).joinToString("\u0000")
        val digest = MessageDigest.getInstance("SHA-256").digest(key.toByteArray())
            .joinToString("") { byte -> "%02x".format(byte.toInt() and 0xff) }
        return "unit-price:$digest"
    }

    private fun dailyPriceSnapshotId(businessDate: String): String =
        "unit-price:snapshot:$businessDate"

    private suspend fun dailyPriceSnapshotMarker(session: WorkdaySession): DailyPriceSnapshotMarker? {
        val cached = dao.priceById(dailyPriceSnapshotId(session.businessDate)) ?: return null
        return try {
            json.decodeFromString<DailyPriceSnapshotMarker>(cached.payload)
        } catch (error: SerializationException) {
            throw IOException("Günlük fiyat önbelleği okunamadı.", error)
        }
    }

    private suspend fun todayRouteCustomerCodes(session: WorkdaySession): List<String> {
        val marker = dailyPriceSnapshotMarker(session)
        val routeAssignments = dao.route().map { it.routeDay to it.customerCode }
        if (marker?.businessDate == session.businessDate && marker.routeDay == session.routeDay) {
            return mergeTodayRouteCustomerCodes(marker.customerCodes, routeAssignments, session.routeDay)
        }
        if (marker?.businessDate == session.businessDate && marker.routeDay.isBlank()) {
            val openingCodes = session.openingSnapshot["route"]?.let { route ->
                (route as? JsonArray).orEmpty().mapNotNull { item ->
                    (item as? JsonObject)?.stringOrNull("customerCode")
                }
            }.orEmpty()
            return mergeTodayRouteCustomerCodes(openingCodes, routeAssignments, session.routeDay)
        }
        val cachedCodes = mergeTodayRouteCustomerCodes(emptyList(), routeAssignments, session.routeDay)
        if (cachedCodes.isNotEmpty()) return cachedCodes
        return session.openingSnapshot["route"]?.let { route ->
            (route as? JsonArray).orEmpty().mapNotNull { item ->
                (item as? JsonObject)?.stringOrNull("customerCode")
            }
        }.orEmpty()
    }

    private suspend fun isTodayRouteCustomer(customerCode: String): Boolean {
        val session = cachedWorkSession()?.takeIf { it.businessDate == businessDate() } ?: return false
        return customerCode in todayRouteCustomerCodes(session)
    }

    private suspend fun hasUsableDailyData(session: WorkdaySession): Boolean {
        val marker = dailyPriceSnapshotMarker(session) ?: return false
        if (marker.businessDate != session.businessDate
            || (marker.routeDay.isNotBlank() && marker.routeDay != session.routeDay)) {
            return false
        }
        val customerCodes = if (marker.routeDay.isBlank()) {
            todayRouteCustomerCodes(session)
        } else {
            marker.customerCodes
        }
        val requiredDiscounts = setOf(
            "customerDiscount1", "customerDiscount2", "customerDiscount3", "cashDiscount", "deferredDiscount",
        )
        for (code in customerCodes) {
            val row = dao.customer(code) ?: return false
            val customer = try {
                json.decodeFromString<JsonObject>(row.payload)
            } catch (error: SerializationException) {
                throw IOException("Günlük cari önbelleği okunamadı.", error)
            }
            if (!customer.keys.containsAll(requiredDiscounts)) return false
        }
        return true
    }

    private fun PriceSnapshot.toCacheEntity(): CachedPriceCandidateEntity =
        CachedPriceCandidateEntity(
            id = unitPriceCacheId(businessDate, customerCode, productCode, unitCode, documentType),
            productCode = productCode,
            payload = json.encodeToString(this),
        )

    private fun PriceSnapshot.toUnitPriceSummary(): UnitPriceSummary =
        UnitPriceSummary(unitPrice, baseUnitPrice, innerQuantity, priceRevision)

    private suspend fun cachedPrice(
        customerCode: String,
        productCode: String,
        unitCode: String,
        documentType: String,
        businessDate: String,
    ): PriceSnapshot? {
        val cached = dao.priceById(
            unitPriceCacheId(businessDate, customerCode, productCode, unitCode, documentType),
        ) ?: return null
        val price = try {
            json.decodeFromString<PriceSnapshot>(cached.payload)
        } catch (error: SerializationException) {
            throw IOException("Önbellekteki ürün fiyatı okunamadı.", error)
        }
        if (price.customerCode != customerCode || price.productCode != productCode
            || price.unitCode != unitCode || price.documentType != documentType
            || price.businessDate != businessDate) {
            throw IOException("Önbellekteki ürün fiyatının kapsamı geçersiz.")
        }
        return price
    }

    private suspend fun ensureDailyPriceSnapshot(
        session: WorkdaySession,
        customerCodes: List<String>,
    ) {
        val snapshots = mutableListOf<PriceSnapshot>()
        var priceRevision = dao.syncState()?.priceRevision ?: "0"
        var responseRevision: String? = null
        customerCodes.chunked(50).forEach { codes ->
            val trace = connectivity.newTrace("pricing.snapshot")
            val response = try {
                api.pricingSnapshot(PriceSnapshotRequest(codes), trace)
            } catch (error: IOException) {
                logRequestFailure(trace, error)
                throw requestFailure(trace, error)
            }
            if (!response.isSuccessful) throw apiException(response)
            val body = response.body() ?: throw unreadableResponse(trace, null)
            if (body.businessDate != session.businessDate) {
                throw IOException("Fiyat listesi günlük oturum tarihiyle eşleşmiyor.")
            }
            if (responseRevision != null && body.priceRevision != responseRevision) {
                throw IOException("Günlük bilgiler indirilirken sunucu fiyatları değişti. Yeniden deneyin.")
            }
            responseRevision = body.priceRevision
            priceRevision = body.priceRevision
            body.prices.forEach { price ->
                if (price.businessDate != session.businessDate
                    || price.customerCode !in codes
                    || price.documentType !in setOf("order", "van_sale")
                    || !price.unitPrice.isFinite() || price.unitPrice <= 0.0
                    || !price.baseUnitPrice.isFinite() || price.baseUnitPrice <= 0.0
                    || !price.innerQuantity.isFinite() || price.innerQuantity <= 0.0) {
                    throw IOException("Sunucudan gelen günlük fiyat kaydı geçersiz.")
                }
                snapshots += price.copy(priceRevision = body.priceRevision)
            }
        }
        val marker = DailyPriceSnapshotMarker(
            businessDate = session.businessDate,
            priceRevision = priceRevision,
            routeDay = session.routeDay,
            customerCodes = customerCodes,
            priceCount = snapshots.size,
        )
        dao.replaceDailyPriceSnapshot(
            snapshots.map { it.toCacheEntity() },
            CachedPriceCandidateEntity(
                id = dailyPriceSnapshotId(session.businessDate),
                productCode = "",
                payload = json.encodeToString(marker),
            ),
        )
    }

    override suspend fun todayRoute(): List<CustomerSummary> = withContext(Dispatchers.IO) {
        val session = cachedWorkSession()?.takeIf { it.businessDate == dailyBusinessDate() }
        cachedTodayRoute(session)
    }

    override suspend fun refreshDailyData(): Result<Boolean> = withContext(Dispatchers.IO) {
        val today = businessDate()
        val session = cachedWorkSession()?.takeIf { it.businessDate == today }
            ?: currentWorkday().getOrNull()?.takeIf { it.businessDate == today }
            ?: return@withContext Result.failure(IOException("Bugünün günlük oturumu bulunamadı. Yeniden deneyin."))
        var trace: ApiRequestTrace? = null
        try {
            val syncResult = pullChanges()
            syncResult.exceptionOrNull()?.let {
                throw IOException("Müşteri ve ürün bilgileri eşitlenemedi.", it)
            }
            trace = connectivity.newTrace("route.today")
            val response = api.todayRoute(trace)
            if (!response.isSuccessful) {
                if (response.code() == 401 || secureStore.session() == null) sessionFlow.value = null
                throw apiException(response)
            }
            val body = response.body() ?: throw unreadableResponse(trace, null)
            if (body.routeDay != session.routeDay) {
                throw IOException("Sunucudaki bugünkü rut günü açık günlük oturumla eşleşmiyor.")
            }
            val customerCodes = body.stops.mapNotNull { it.stringOrNull("customerCode") }.distinct()
            if (customerCodes.size != body.stops.size) {
                throw IOException("Bugünkü rut bilgisinde müşteri kodu eksik.")
            }
            ensureDailyPriceSnapshot(session, customerCodes)
            cacheLiveTodayRoute(body.routeDay, body.stops, session.businessDate)
            Result.success(true)
        } catch (error: IOException) {
            if (hasUsableDailyData(session)) {
                trace?.let { logRequestFailure(it, error) }
                Result.success(false)
            } else {
                Result.failure(requestFailure(trace, error))
            }
        } catch (error: SerializationException) {
            if (hasUsableDailyData(session)) {
                trace?.let { logResponseFailure(it, error) }
                Result.success(false)
            } else {
                Result.failure(unreadableResponse(trace, error))
            }
        } catch (error: IllegalStateException) {
            if (hasUsableDailyData(session)) {
                Result.success(false)
            } else {
                Result.failure(error)
            }
        }
    }

    private suspend fun cacheLiveTodayRoute(routeDay: String, stops: List<JsonObject>, businessDate: String) {
        val routeRows = mutableListOf<CachedRouteStopEntity>()
        val customerRows = mutableListOf<CachedCustomerEntity>()
        stops.forEach { stop ->
            val code = stop.stringOrNull("customerCode")
                ?: throw IOException("Bugünkü rut kaydında cari kodu eksik.")
            val customerRow = dao.customer(code)
            val existing = customerRow?.let { row ->
                try {
                    json.decodeFromString<JsonObject>(row.payload)
                } catch (error: SerializationException) {
                    throw IOException("Yerel cari bilgisi okunamadı.", error)
                }
            }.orEmpty()
            val customerFields = mapOf(
                "code" to stop["customerCode"],
                "name" to stop["customerName"],
                "title" to stop["customerTitle"],
                "province" to stop["province"],
                "district" to stop["district"],
                "address" to stop["address"],
                "phone" to stop["phone"],
                "mobilePhone" to stop["mobilePhone"],
                "balance" to stop["balance"],
                "creditLimit" to stop["creditLimit"],
                "openOrderAmount" to stop["openOrderAmount"],
                "customerDiscount1" to stop["customerDiscount1"],
                "customerDiscount2" to stop["customerDiscount2"],
                "customerDiscount3" to stop["customerDiscount3"],
                "cashDiscount" to stop["cashDiscount"],
                "deferredDiscount" to stop["deferredDiscount"],
            ).mapNotNull { (key, value) -> value?.let { key to it } }
            val mergedCustomer = JsonObject(existing + customerFields)
            val cachedContext = CachedSalesContext(
                businessDate = businessDate,
                balance = mergedCustomer.stringOrNull("balance"),
                discountRates = discountRates(mergedCustomer),
            )
            customerRows += CachedCustomerEntity(
                id = code,
                code = code,
                payload = json.encodeToString(
                    JsonObject(
                        mergedCustomer + ("salesContextCache" to json.encodeToJsonElement(
                            CachedSalesContext.serializer(),
                            cachedContext,
                        )),
                    ),
                ),
            )
            routeRows += stop.routeEntity()
        }
        dao.putCustomers(customerRows)
        dao.replaceRouteDay(routeDay, routeRows)
    }

    private suspend fun cachedTodayRoute(session: WorkdaySession?): List<CustomerSummary> {
        val marker = session?.let { dailyPriceSnapshotMarker(it) }
        if (session != null && marker != null
            && marker.businessDate == session.businessDate && marker.routeDay == session.routeDay) {
            val customerCodes = todayRouteCustomerCodes(session)
            val cachedCustomers = dao.customers().associateBy { it.code }
            return customerCodes.mapNotNull { code ->
                val customer = cachedCustomers[code] ?: return@mapNotNull null
                try {
                    json.decodeFromString<JsonObject>(customer.payload).toCustomer()
                        .copy(visitState = dao.latestVisit(code)?.state)
                } catch (error: SerializationException) {
                    throw IOException("Günlük rut cari bilgisi okunamadı.", error)
                }
            }
        }
        val cachedRoute = session?.let { route ->
            dao.route().filter { it.routeDay == route.routeDay }
        }.orEmpty()
        if (cachedRoute.isNotEmpty()) {
            val cachedCustomers = dao.customers().associateBy { it.code }
            return cachedRoute.mapNotNull { route ->
                val customer = cachedCustomers[route.customerCode] ?: return@mapNotNull null
                try {
                    json.decodeFromString<JsonObject>(customer.payload).toCustomer()
                        .copy(visitState = dao.latestVisit(route.customerCode)?.state)
                } catch (error: SerializationException) {
                    throw IOException("Yerel rut cari bilgisi okunamadı.", error)
                }
            }
        }
        val openingRoute = session
            ?.openingSnapshot
            ?.get("route") as? JsonArray
        if (openingRoute != null) {
            return openingRoute.mapNotNull { item ->
                val code = (item as? JsonObject)?.stringOrNull("customerCode") ?: return@mapNotNull null
                val cached = dao.customer(code) ?: return@mapNotNull null
                try {
                    json.decodeFromString<JsonObject>(cached.payload).toCustomer()
                        .copy(visitState = dao.latestVisit(code)?.state)
                } catch (error: SerializationException) {
                    throw IOException("Günlük oturumdaki cari bilgisi okunamadı.", error)
                }
            }
        }
        return dao.route().filter { session == null || it.routeDay == session.routeDay }.mapNotNull { route ->
            val cached = dao.customer(route.customerCode) ?: return@mapNotNull null
            try {
                json.decodeFromString<JsonObject>(cached.payload).toCustomer()
                    .copy(visitState = dao.latestVisit(route.customerCode)?.state)
            } catch (error: SerializationException) {
                throw IOException("Yerel rut cari bilgisi okunamadı.", error)
            }
        }
    }

    override suspend fun currentWorkday(): Result<WorkdaySession?> = withContext(Dispatchers.IO) {
        if (secureStore.session() == null) return@withContext Result.failure(IOException("Oturum gerekli."))
        val trace = connectivity.newTrace("day.current")
        try {
            val response = api.currentWorkday(trace)
            if (!response.isSuccessful) return@withContext Result.failure(apiException(response))
            val currentDay = response.body()
                ?: return@withContext Result.failure(unreadableResponse(trace, null))
            val session = currentDay.session?.copy(
                requiresClosing = currentDay.requiresClosing,
                currentDaySessionExists = currentDay.currentDaySessionExists,
                currentDaySessionOpen = currentDay.currentDaySessionOpen,
            )
            session?.let { saveWorkSession(it) } ?: dao.clearWorkSession()
            Result.success(session)
        } catch (error: IOException) {
            logRequestFailure(trace, error)
            val cached = cachedWorkSession()
            if (cached?.businessDate == java.time.LocalDate.now(java.time.ZoneId.of("Europe/Istanbul")).toString()) {
                Result.success(cached)
            } else {
                Result.failure(requestFailure(trace, error))
            }
        } catch (error: SerializationException) {
            logResponseFailure(trace, error)
            Result.failure(unreadableResponse(trace, error))
        }
    }

    override suspend fun currentVehicleStock(): Result<List<JsonObject>> = withContext(Dispatchers.IO) {
        if (secureStore.session() == null) return@withContext Result.failure(IOException("Oturum gerekli."))
        val trace = connectivity.newTrace("day.stock")
        try {
            val includedSales = dao.saleOperations()
                .filter { it.state == "accepted" }
                .associate { it.operationId to it.payload }
            val response = api.currentVehicleStock(trace)
            if (!response.isSuccessful) {
                if (response.code() == 409) dao.clearVehicleStock()
                return@withContext Result.failure(apiException(response))
            }
            val body = response.body()
                ?: return@withContext Result.failure(unreadableResponse(trace, null))
            dao.saveVehicleStock(
                CachedVehicleStockEntity(
                    warehouseCode = body.warehouseCode,
                    fetchedAt = body.serverTime ?: Instant.now().toString(),
                    payload = json.encodeToString(body.stock),
                    includedOperationIds = json.encodeToString(includedSales),
                ),
            )
            Result.success(body.stock)
        } catch (error: IOException) {
            logRequestFailure(trace, error)
            Result.failure(requestFailure(trace, error))
        } catch (error: SerializationException) {
            logResponseFailure(trace, error)
            Result.failure(unreadableResponse(trace, error))
        }
    }

    override suspend fun hotSaleStock(
        correctedOperationId: String?,
        refresh: Boolean,
    ): Result<VehicleStockAvailability> = withContext(Dispatchers.IO) {
        val remoteError = if (refresh) currentVehicleStock().exceptionOrNull() else null
        val cached = dao.vehicleStock()
            ?: return@withContext Result.failure(
                remoteError ?: IOException("Araç deposu stoğu henüz alınmadı. İnternet bağlantısıyla eşitleme yapın."),
            )
        try {
            val rows = json.decodeFromString<List<JsonObject>>(cached.payload)
            val included = json.decodeFromString<Map<String, String>>(cached.includedOperationIds)
            val (reserved, released) = HotSaleStockRules.saleAdjustments(
                dao.saleOperations().map { SaleStockOperation(it.operationId, it.state, it.payload) },
                included,
                correctedOperationId,
                ::saleLines,
            )
            val (conversions, baseUnits) = productConversions(
                (rows.mapNotNull { it.stringOrNull("productCode") } + reserved.map { it.productCode } +
                    released.map { it.productCode }).toSet(),
            )
            val availability = HotSaleStockRules.parse(
                rows,
                cached.warehouseCode,
                cached.fetchedAt,
                fromCache = remoteError != null || !refresh,
            )
            Result.success(HotSaleStockRules.adjust(availability, reserved, released, conversions, baseUnits))
        } catch (error: SerializationException) {
            Result.failure(IllegalStateException("Yerel araç stoğu okunamadı. Eşitleme yapın.", error))
        } catch (error: IllegalArgumentException) {
            Result.failure(IllegalStateException("Yerel araç stoğu okunamadı. Eşitleme yapın.", error))
        }
    }

    private fun saleLines(payload: String): List<StockCartLine> =
        saleStockLines(json, payload)

    private suspend fun productConversions(
        codes: Set<String>,
    ): Pair<Map<String, Map<String, Double>>, Map<String, String>> {
        val conversions = mutableMapOf<String, Map<String, Double>>()
        val baseUnits = mutableMapOf<String, String>()
        dao.products().filter { it.code in codes }.forEach { product ->
            val baseUnit = runCatching {
                json.parseToJsonElement(product.payload).jsonObject.string("unit")
            }.getOrDefault("")
            val units = dao.units(product.code).mapNotNull { unit ->
                val data = runCatching { json.parseToJsonElement(unit.payload).jsonObject }.getOrNull()
                    ?: return@mapNotNull null
                val name = data.stringOrNull("unit") ?: return@mapNotNull null
                val inner = data.stringOrNull("innerQuantity")?.replace(',', '.')?.toDoubleOrNull()
                    ?.takeIf { it.isFinite() && it > 0.0 } ?: return@mapNotNull null
                name to inner
            }.toMap()
            if (baseUnit.isNotBlank()) baseUnits[product.code] = baseUnit
            conversions[product.code] = if (baseUnit.isBlank()) units else units + (baseUnit to 1.0)
        }
        return conversions to baseUnits
    }

    override suspend fun validateHotSaleStock(lines: List<OrderLinePayload>, correctedOperationId: String?): String? {
        val availability = hotSaleStock(correctedOperationId, refresh = connectivity.reachability.value == true)
            .getOrElse { return it.message ?: HotSaleStockRules.message("", "", com.vdgida.vdesgo.sales.data.HotSaleStockCheck.UnknownStock) }
        val cart = lines.mapIndexed { index, line -> StockCartLine("line-$index", line.productCode, line.unitCode, line.quantity) }
        val (conversions, baseUnits) = productConversions(cart.map { it.productCode }.toSet())
        val violation = HotSaleStockRules.validateCart(availability, cart, conversions, baseUnits) ?: return null
        val name = dao.products().firstOrNull { it.code == violation.first.productCode }?.let {
            runCatching { json.parseToJsonElement(it.payload).jsonObject.stringOrNull("name") }.getOrNull()
        } ?: violation.first.productCode
        return HotSaleStockRules.message(name, violation.first.unitCode, violation.second)
    }

    override suspend fun openWorkday(openingOdometerKm: Double): Result<WorkdaySession> = withContext(Dispatchers.IO) {
        if (secureStore.session() == null) return@withContext Result.failure(IOException("Oturum gerekli."))
        if (!openingOdometerKm.isFinite() || openingOdometerKm < 0) {
            return@withContext Result.failure(IllegalArgumentException("Geçerli bir başlangıç kilometresi girin."))
        }
        val trace = connectivity.newTrace("day.open")
        try {
            val response = api.openWorkday(WorkdayOpenRequest(openingOdometerKm), trace)
            if (!response.isSuccessful) return@withContext Result.failure(apiException(response))
            val session = response.body()?.session
                ?: return@withContext Result.failure(unreadableResponse(trace, null))
            dao.clearRoutePointsExcept(session.id)
            saveWorkSession(session)
            Result.success(session)
        } catch (error: IOException) {
            logRequestFailure(trace, error)
            Result.failure(requestFailure(trace, error))
        } catch (error: SerializationException) {
            logResponseFailure(trace, error)
            Result.failure(unreadableResponse(trace, error))
        }
    }

    override suspend fun closeWorkday(
        closingOdometerKm: Double,
        routeOrder: List<String>,
        submittedOpeningOdometerKm: Double?,
    ): Result<WorkdayCloseResult> = withContext(Dispatchers.IO) {
        if (secureStore.session() == null) return@withContext Result.failure(IOException("Oturum gerekli."))
        val session = cachedWorkSession()
            ?: return@withContext Result.failure(IllegalStateException("Günlük açılış bilgisi bulunamadı."))
        if (session.status != "open") {
            return@withContext Result.failure(IllegalStateException("Günlük oturum zaten kapalı."))
        }
        val synchronized = syncOutbox()
        if (synchronized.isFailure) {
            return@withContext Result.failure(synchronized.exceptionOrNull() ?: IOException("İşlemler eşitlenemedi."))
        }
        val pendingCount = dao.pendingOperationCount()
        if (pendingCount > 0) {
            return@withContext Result.failure(IllegalStateException("Kapanıştan önce $pendingCount işlem eşitlenmeli."))
        }
        val routeUpload = uploadPendingRoutePoints(session.id)
        val openingOdometerKm = session.openingOdometerKm
            ?: submittedOpeningOdometerKm
            ?: session.suggestedOpeningOdometerKm
            ?: return@withContext Result.failure(IllegalStateException("Başlangıç kilometresi girilmelidir."))
        if (!openingOdometerKm.isFinite() || openingOdometerKm < 0) {
            return@withContext Result.failure(IllegalArgumentException("Geçerli bir başlangıç kilometresi girin."))
        }
        if (!closingOdometerKm.isFinite() || closingOdometerKm < openingOdometerKm) {
            return@withContext Result.failure(IllegalArgumentException("Kapanış kilometresi başlangıç kilometresinden küçük olamaz."))
        }
        val expectedRoute = session.openingSnapshot["route"]?.jsonArray.orEmpty().mapNotNull { item ->
            item.jsonObject["customerCode"]?.jsonPrimitive?.contentOrNull
        }
        if (expectedRoute.size != routeOrder.size || expectedRoute.toSet() != routeOrder.toSet()) {
            return@withContext Result.failure(IllegalArgumentException("Rut sırası açılıştaki tüm müşterileri içermelidir."))
        }
        val trace = connectivity.newTrace("day.close")
        try {
            val response = api.closeWorkday(
                WorkdayCloseRequest(
                    pendingOperationCount = pendingCount,
                    closingOdometerKm = closingOdometerKm,
                    openingOdometerKm = openingOdometerKm,
                    routeOrder = routeOrder.mapIndexed { index, code -> RouteOrderRequest(code, index) },
                    workSessionId = session.id,
                ),
                trace,
            )
            if (!response.isSuccessful) return@withContext Result.failure(apiException(response))
            val closed = response.body()
                ?: return@withContext Result.failure(unreadableResponse(trace, null))
            saveWorkSession(
                session.copy(
                    status = closed.status,
                    closingSummary = closed.closingSummary,
                    closedAt = closed.closedAt,
                    openingOdometerKm = openingOdometerKm,
                    closingOdometerKm = closingOdometerKm,
                    traveledKm = closingOdometerKm - openingOdometerKm,
                ),
            )
            if (routeUpload.isSuccess) dao.clearRoutePoints()
            Result.success(WorkdayCloseResult(routeUpload.exceptionOrNull()?.message))
        } catch (error: IOException) {
            logRequestFailure(trace, error)
            Result.failure(requestFailure(trace, error))
        } catch (error: SerializationException) {
            logResponseFailure(trace, error)
            Result.failure(unreadableResponse(trace, error))
        }
    }

    override suspend fun submitCollection(
        operationId: String,
        customerCode: String,
        amount: Double,
        operationDate: String,
        description: String,
    ): Result<Unit> = withContext(Dispatchers.IO) {
        val today = LocalDate.now(ZoneId.of("Europe/Istanbul")).toString()
        if (!operationId.matches(Regex("[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}"))
            || customerCode.isBlank() || !amount.isFinite() || amount <= 0
            || amount > 1_000_000_000 || kotlin.math.abs(amount * 100 - kotlin.math.round(amount * 100)) > 1e-7
            || operationDate != today || description.length > 500) {
            return@withContext Result.failure(IllegalArgumentException("Tahsilat bilgileri geçersiz."))
        }
        val trace = connectivity.newTrace("collection.submit")
        try {
            val response = api.submitCollection(
                CollectionSubmitRequest(
                    operationId = operationId,
                    clientCreatedAt = Instant.now().toString(),
                    payload = CollectionPayload(customerCode, amount, today, description.trim()),
                ),
                trace,
            )
            if (!response.isSuccessful) return@withContext Result.failure(apiException(response))
            val result = response.body() ?: return@withContext Result.failure(unreadableResponse(trace, null))
            if (result.status != "accepted") {
                return@withContext Result.failure(IllegalStateException(result.code ?: "Tahsilat kabul edilmedi."))
            }
            Result.success(Unit)
        } catch (error: IOException) {
            logRequestFailure(trace, error)
            Result.failure(requestFailure(trace, error))
        } catch (error: SerializationException) {
            logResponseFailure(trace, error)
            Result.failure(unreadableResponse(trace, error))
        }
    }

    override suspend fun outsideRoute(day: String?): Result<OutsideRouteData> = withContext(Dispatchers.IO) {
        if (secureStore.session() == null) return@withContext Result.failure(IOException("Oturum gerekli."))
        val trace = connectivity.newTrace("route.outside")
        try {
            val response = api.outsideRoute(day, trace)
            if (!response.isSuccessful) return@withContext Result.failure(apiException(response))
            val body = response.body()
                ?: return@withContext Result.failure(unreadableResponse(trace, null))
            Result.success(OutsideRouteData(body.days, body.assignments))
        } catch (error: IOException) {
            logRequestFailure(trace, error)
            Result.failure(requestFailure(trace, error))
        } catch (error: SerializationException) {
            logResponseFailure(trace, error)
            Result.failure(unreadableResponse(trace, error))
        }
    }

    private suspend fun saveWorkSession(session: WorkdaySession) {
        dao.saveWorkSession(
            DailyWorkSessionEntity(
                businessDate = session.businessDate,
                status = session.status,
                payload = json.encodeToString(session),
            ),
        )
        cacheOpeningRouteCustomers(session)
    }

    private suspend fun cachedWorkSession(): WorkdaySession? {
        val cached = dao.workSession() ?: return null
        return try {
            json.decodeFromString<WorkdaySession>(cached.payload)
        } catch (error: SerializationException) {
            throw IllegalStateException("Kaydedilmiş günlük oturum okunamadı.", error)
        }
    }

    private suspend fun uploadPendingRoutePoints(workSessionId: String): Result<Unit> {
        while (true) {
            val points = dao.pendingRoutePointsForSession(workSessionId)
            if (points.isEmpty()) return Result.success(Unit)
            val trace = connectivity.newTrace("location.points.close")
            try {
                val response = api.uploadRoutePoints(
                    RoutePointUploadRequest(
                        points = points.map { point ->
                            RoutePointUpload(
                                id = point.id,
                                workSessionId = point.workSessionId,
                                recordedAt = point.recordedAt,
                                latitude = point.latitude,
                                longitude = point.longitude,
                                accuracyM = point.accuracyM,
                                speedMps = point.speedMps,
                                bearingDegrees = point.bearingDegrees,
                            )
                        },
                    ),
                    trace,
                )
                if (!response.isSuccessful) return Result.failure(apiException(response))
                val acceptedIds = response.body()?.acceptedIds.orEmpty()
                if (acceptedIds.isEmpty()) {
                    return Result.failure(IOException("Günlük GPS kayıtları sunucu tarafından onaylanmadı."))
                }
                dao.markRoutePointsUploaded(acceptedIds)
            } catch (error: IOException) {
                logRequestFailure(trace, error)
                return Result.failure(requestFailure(trace, error))
            } catch (error: SerializationException) {
                logResponseFailure(trace, error)
                return Result.failure(unreadableResponse(trace, error))
            }
        }
    }

    private suspend fun requireOpenWorkday(): Boolean {
        val session = cachedWorkSession() ?: return false
        return session.status == "open"
            && session.businessDate == java.time.LocalDate.now(java.time.ZoneId.of("Europe/Istanbul")).toString()
    }

    override suspend fun products(): List<ProductSummary> = withContext(Dispatchers.IO) {
        dao.products().mapNotNull { product ->
            try {
                val value = json.parseToJsonElement(product.payload).jsonObject
                val candidates = dao.prices(product.code)
                    .filterNot { it.id.startsWith("unit-price:") }
                    .mapNotNull { price ->
                    val parsed = json.parseToJsonElement(price.payload).jsonObject
                    val taxIncluded = parsed["taxIncluded"]?.jsonPrimitive?.booleanOrNull
                    if (taxIncluded == false) parsed else null
                }
                val latestPrice = candidates.maxWithOrNull(
                    compareBy<JsonObject> { it.stringOrNull("startDate").orEmpty() }
                        .thenBy { it.stringOrNull("id")?.toLongOrNull() ?: 0L },
                )
                val netPrice = latestPrice?.stringOrNull("salesPrice")
                    ?.replace(',', '.')
                    ?.toDoubleOrNull()
                val unitRows = dao.units(product.code).mapNotNull { unit ->
                    val unitData = json.parseToJsonElement(unit.payload).jsonObject
                    val unitName = unitData.stringOrNull("unit") ?: return@mapNotNull null
                    val innerQuantity = unitData.stringOrNull("innerQuantity")
                        ?.replace(',', '.')
                        ?.toDoubleOrNull()
                        ?.takeIf { it.isFinite() && it > 0.0 }
                    unitName to innerQuantity
                }
                val unitNames = unitRows.map { it.first }.distinct()
                val baseUnit = value.string("unit")
                val unitInnerQuantities = buildMap {
                    put(baseUnit, 1.0)
                    unitRows.forEach { (unitName, innerQuantity) ->
                        if (unitName != baseUnit && innerQuantity != null) put(unitName, innerQuantity)
                    }
                }
                ProductSummary(
                    code = value.string("code"),
                    name = value.string("name"),
                    unit = value.string("unit"),
                    netPrice = netPrice,
                    orderable = netPrice != null,
                    units = (listOf(value.string("unit")) + unitNames).filter(String::isNotBlank).distinct(),
                    unitInnerQuantities = unitInnerQuantities,
                    ePoint = value.stringOrNull("ePoint"),
                    weight = value.stringOrNull("weight"),
                    volume = value.stringOrNull("volume"),
                    imageDataUrl = value.stringOrNull("imageDataUrl"),
                )
            } catch (_: SerializationException) {
                null
            }
        }
    }

    override suspend fun drafts(): List<DraftSummary> = withContext(Dispatchers.IO) {
        dao.drafts().mapNotNull { draft ->
            try {
                draftSummary(draft)
            } catch (_: SerializationException) {
                null
            }
        }
    }

    override suspend fun draft(id: String): DraftSummary? = withContext(Dispatchers.IO) {
        dao.draft(id)?.let { draftSummary(it) }
    }

    override suspend fun reviewConflict(draftId: String): String? = withContext(Dispatchers.IO) {
        val newId = UUID.randomUUID().toString()
        if (dao.cloneDraft(draftId, newId, Instant.now().toString())) newId else null
    }

    override suspend fun operations(): List<OperationSummary> = withContext(Dispatchers.IO) {
        (dao.documentOperations() + dao.customerCreationOperations())
            .sortedByDescending { it.clientCreatedAt }
            .map {
                OperationSummary(
                    id = it.operationId,
                    status = operationUiState(it.state),
                    documentNumber = it.documentNumber,
                    error = it.lastError,
                    result = it.result,
                    draftId = it.draftId,
                    type = it.type,
                    createdAt = it.clientCreatedAt,
                    payload = it.payload,
                    printedAt = it.printedAt,
                    printNumber = it.printNumber,
                    cancellationRequested = it.cancellationRequested,
                )
            }
    }

    override suspend fun pendingOperationCount(): Int = dao.pendingOperationCount()

    override suspend fun markDocumentPrinted(operationId: String, printNumber: String?): Result<Unit> =
        withContext(Dispatchers.IO) {
            try {
                val operation = dao.outboxOperation(operationId)
                    ?: return@withContext Result.failure(IOException("Satış bulunamadı."))
                if (operation.type != "sale.submit") {
                    return@withContext Result.failure(IOException("Yalnızca yazdırılmamış satış faturası yazdırılabilir."))
                }
                if (operation.printedAt != null) return@withContext Result.success(Unit)
                val timestamp = Instant.now().toString()
                if (dao.markDocumentPrinted(operationId, timestamp, printNumber?.trim()?.takeIf(String::isNotBlank)) == 0) {
                    return@withContext Result.failure(IOException("Satışın durumu değişti; yazdırma kaydedilemedi."))
                }
                val syncResult = syncOutbox()
                if (syncResult.isFailure) {
                    SyncScheduler.enqueue(context)
                    return@withContext syncResult
                }
                Result.success(Unit)
            } catch (error: IOException) {
                Result.failure(error)
            }
        }

    override suspend fun cancelDocument(operationId: String): Result<Unit> = withContext(Dispatchers.IO) {
        try {
            val operation = dao.outboxOperation(operationId)
                ?: return@withContext Result.failure(IOException("Satış bulunamadı."))
            if (operation.type != "sale.submit" || operation.printedAt == null) {
                return@withContext Result.failure(IOException("Yalnızca yazdırılmış satışlar iptal edilebilir."))
            }
            if (operation.state == "cancelled") return@withContext Result.success(Unit)
            if (dao.requestSaleCancellation(operationId) == 0) {
                return@withContext Result.failure(IOException("Satışın durumu değişti; iptal isteği kaydedilemedi."))
            }
            val result = if (operation.state in setOf("rejected", "conflict", "requires_approval")) {
                if (dao.markSaleCancelled(operationId) == 0) {
                    Result.failure(IOException("İptal durumu kaydedilemedi; satış kaydı korundu."))
                } else {
                    Result.success(Unit)
                }
            } else if (operation.state == "accepted") {
                val failure = syncPendingSaleCancellations()
                if (failure == null) Result.success(Unit) else Result.failure(failure)
            } else {
                syncOutbox()
            }
            if (result.isFailure) SyncScheduler.enqueue(context)
            result
        } catch (error: IOException) {
            Result.failure(error)
        }
    }

    override suspend fun deleteCustomerCreation(operationId: String): Result<Unit> = withContext(Dispatchers.IO) {
        try {
            val operation = dao.outboxOperation(operationId)
                ?: return@withContext Result.failure(IOException("Yeni müşteri kaydı bulunamadı."))
            if (operation.type != "customer.create"
                || operation.state !in setOf("pending", "rejected", "conflict")) {
                return@withContext Result.failure(IOException("Gönderilmiş veya sunucuyla belirsiz müşteri kaydı silinemez."))
            }
            val payload = runCatching {
                json.decodeFromString<CustomerCreateRequest>(operation.payload)
            }.getOrNull() ?: return@withContext Result.failure(IOException("Müşteri kaydı verisi okunamadı."))
            if (!dao.deleteUnsentCustomerCreation(operationId, payload.customerCode)) {
                return@withContext Result.failure(IOException("Müşteri kaydı silinemedi."))
            }
            Result.success(Unit)
        } catch (error: IOException) {
            Result.failure(error)
        }
    }

    override suspend fun editCustomerCreation(
        operationId: String,
        request: CustomerCreateRequest,
    ): Result<Unit> = withContext(Dispatchers.IO) {
        val deleteResult = deleteCustomerCreation(operationId)
        if (deleteResult.isFailure) return@withContext deleteResult
        createCustomer(request)
    }

    override suspend fun deleteDocument(operationId: String): Result<Unit> = withContext(Dispatchers.IO) {
        try {
            var operation = dao.outboxOperation(operationId)
                ?: return@withContext Result.failure(IOException("Sipariş veya satış bulunamadı."))
            if (operation.type !in setOf("order.submit", "sale.submit")) {
                return@withContext Result.failure(IOException("Yalnızca sipariş ve satış belgeleri silinebilir."))
            }
            if (operation.type == "sale.submit" && operation.printedAt != null) {
                return@withContext Result.failure(IOException("Yazdırılmış satış silinemez; iptal edilmelidir."))
            }
            if (operation.state == "sending") {
                return@withContext Result.failure(IOException("Belge gönderiliyor. Eşitleme tamamlandıktan sonra tekrar deneyin."))
            }
            if (operation.state == "retry") {
                val syncResult = syncOutbox()
                if (syncResult.isFailure) return@withContext syncResult
                operation = dao.outboxOperation(operationId)
                    ?: return@withContext Result.success(Unit)
            }

            when (operation.state) {
                "accepted" -> {
                    val trace = connectivity.newTrace(
                        requestType = "document.delete",
                        operationId = operationId,
                    )
                    val response = api.deleteDocument(operationId, trace)
                    if (!response.isSuccessful) return@withContext Result.failure(apiException(response))
                    if (!dao.deleteAcceptedDocument(operationId)) return@withContext Result.failure(
                        IOException("Belge ERP'de silindi veya iptal edildi ancak cihazdaki kayıt korundu."),
                    )
                }
                "pending", "retry", "conflict", "requires_approval", "rejected" -> {
                    if (!dao.deleteLocalDocument(operationId)) {
                        return@withContext Result.failure(
                            IOException("Belge eşitleniyor veya durumu değişti. Yenileyip tekrar deneyin."),
                        )
                    }
                }
                else -> return@withContext Result.failure(
                    IOException("Belge durumu doğrulanamadı; silme işlemi yapılmadı."),
                )
            }
            Result.success(Unit)
        } catch (error: IOException) {
            Result.failure(error)
        } catch (error: SerializationException) {
            Result.failure(IOException(context.getString(R.string.error_unexpected_response), error))
        }
    }

    private suspend fun syncPendingPrintReports(): Throwable? {
        for (operation in dao.pendingPrintReports()) {
            val body = buildJsonObject {
                operation.printNumber?.takeIf(String::isNotBlank)?.let { put("printNumber", JsonPrimitive(it)) }
            }
            val trace = connectivity.newTrace("document.print", operationId = operation.operationId)
            try {
                val response = api.reportDocumentPrinted(operation.operationId, body, trace)
                if (!response.isSuccessful) return apiException(response)
                dao.markPrintSynced(operation.operationId)
            } catch (error: IOException) {
                return requestFailure(trace, error)
            } catch (error: SerializationException) {
                return unreadableResponse(trace, error)
            }
        }
        return null
    }

    private suspend fun syncPendingSaleCancellations(): Throwable? {
        for (operation in dao.pendingSaleCancellations()) {
            if (!operation.printSynced) {
                val body = buildJsonObject {
                    operation.printNumber?.takeIf(String::isNotBlank)?.let { put("printNumber", JsonPrimitive(it)) }
                }
                val printTrace = connectivity.newTrace("document.print", operationId = operation.operationId)
                try {
                    val printed = api.reportDocumentPrinted(operation.operationId, body, printTrace)
                    if (!printed.isSuccessful) return apiException(printed)
                    dao.markPrintSynced(operation.operationId)
                } catch (error: IOException) {
                    return requestFailure(printTrace, error)
                } catch (error: SerializationException) {
                    return unreadableResponse(printTrace, error)
                }
            }
            val trace = connectivity.newTrace("document.cancel", operationId = operation.operationId)
            try {
                val response = api.deleteDocument(operation.operationId, trace)
                if (!response.isSuccessful) {
                    val error = apiException(response)
                    dao.markSaleCancellationPending(operation.operationId, error.message ?: "İptal tekrar denenecek.")
                    return error
                }
                dao.markSaleCancelled(operation.operationId)
            } catch (error: IOException) {
                dao.markSaleCancellationPending(operation.operationId, error.message ?: "İptal bağlantısı kurulamadı.")
                return requestFailure(trace, error)
            } catch (error: SerializationException) {
                dao.markSaleCancellationPending(operation.operationId, error.message ?: "İptal yanıtı okunamadı.")
                return unreadableResponse(trace, error)
            }
        }
        return null
    }

    override suspend fun createSaleCorrection(operationId: String): SaleCorrectionDraft? = withContext(Dispatchers.IO) {
        val operation = dao.outboxOperation(operationId)
            ?.takeIf { it.type == "sale.submit" && it.state == "accepted" }
            ?: return@withContext null
        val sourceDraftId = operation.draftId ?: return@withContext null
        val correction = try {
            json.decodeFromString<OrderPayload>(operation.payload)
        } catch (_: SerializationException) {
            return@withContext null
        }
        val draftId = UUID.randomUUID().toString()
        if (!dao.cloneDraft(sourceDraftId, draftId, Instant.now().toString())) return@withContext null
        SaleCorrectionDraft(
            draftId = draftId,
            discountSelection = correction.discountSelection.filterValues { it }.keys,
            selectedPromotionId = correction.selectedPromotionId,
        )
    }

    override suspend fun replaceSalesInvoice(
        operationId: String,
        draftId: String,
        discountSelection: Map<String, Boolean>,
        selectedPromotionId: String?,
        rewardSnapshot: List<OrderLinePayload>,
    ): Result<Unit> = withContext(Dispatchers.IO) {
        try {
            val operation = dao.outboxOperation(operationId)
                ?.takeIf { it.type == "sale.submit" && it.state == "accepted" }
                ?: return@withContext Result.failure(IOException("Düzeltilecek sıcak satış bulunamadı."))
            val draft = dao.draft(draftId)
                ?.takeIf { it.documentType == "van_sale" && it.state == "draft" }
                ?: return@withContext Result.failure(IOException("Düzeltme taslağı bulunamadı."))
            val originalDraft = operation.draftId?.let { dao.draft(it) }
                ?: return@withContext Result.failure(IOException("Önceki sıcak satış taslağı bulunamadı."))
            if (draft.customerCode != originalDraft.customerCode) {
                return@withContext Result.failure(IOException("Fatura müşterisi değiştirilemez."))
            }
            val payload = orderPayload(draftId, draft.customerCode, discountSelection, selectedPromotionId)
                ?.copy(stockRewardSnapshot = rewardSnapshot)
                ?: return@withContext Result.failure(IOException("Satışa en az bir ürün ekleyin."))
            validateHotSaleStock(payload.stockConsumingLines(), operationId)?.let {
                return@withContext Result.failure(IOException(it))
            }
            val trace = connectivity.newTrace("sale.correct", operationId)
            val response = api.replaceSalesInvoice(
                operationId,
                com.vdgida.vdesgo.sales.data.SaleCorrectionRequest(payload.copy(stockRewardSnapshot = emptyList())),
                trace,
            )
            if (!response.isSuccessful) return@withContext Result.failure(apiException(response))
            val body = response.body()
                ?: return@withContext Result.failure(unreadableResponse(trace, null))
            if (body.status != "accepted" || body.result == null) {
                return@withContext Result.failure(
                    IOException(body.code ?: "Düzeltilmiş sıcak satış sunucu tarafından kabul edilmedi."),
                )
            }
            val result = json.encodeToString(body.result)
            val payloadJson = json.encodeToString(OrderPayload.serializer(), payload)
            if (!dao.finalizeAcceptedSaleCorrection(
                    operationId,
                    draftId,
                    payloadJson,
                    result,
                    body.documentNumber,
                )) {
                return@withContext Result.failure(
                    IOException("Fatura ERP'de düzeltildi ancak cihazdaki satış kaydı güncellenemedi. Eşitleyin."),
                )
            }
            runCatching { currentVehicleStock() }
            Result.success(Unit)
        } catch (error: IOException) {
            Result.failure(error)
        } catch (error: SerializationException) {
            Result.failure(error)
        }
    }

    override suspend fun createDraft(customerCode: String, documentType: String): String = withContext(Dispatchers.IO) {
        check(requireOpenWorkday()) { "Sipariş için önce bugünün açılışını yapın." }
        if (dao.customer(customerCode) == null) {
            val sync = pullChanges()
            if (sync.isFailure) {
                throw IllegalStateException(
                    sync.exceptionOrNull()?.message ?: context.getString(R.string.error_sync_empty),
                )
            }
        }
        check(dao.customer(customerCode) != null) { context.getString(R.string.error_customer_access_revoked) }
        require(documentType in setOf("order", "van_sale")) { "Belge türü geçersiz." }
        val existing = dao.drafts().firstOrNull {
            it.customerCode == customerCode && it.documentType == documentType && it.state == "draft"
        }
        if (existing != null) return@withContext existing.id
        val draft = OrderDraftEntity(
            id = UUID.randomUUID().toString(),
            customerCode = customerCode,
            createdAt = Instant.now().toString(),
            documentType = documentType,
        )
        dao.saveDraft(draft)
        draft.id
    }

    override suspend fun changeDraftQuantity(
        draftId: String,
        productCode: String,
        unitCode: String,
        delta: Double,
    ): Unit = withContext(Dispatchers.IO) {
        check(dao.draft(draftId)?.state == "draft") { "Bu sipariş taslağı artık düzenlenemez." }
        val current = dao.draftLines(draftId).firstOrNull {
            it.productCode == productCode && it.unitCode == unitCode
        }
        val quantity = (current?.quantity ?: 0.0) + delta
        if (quantity <= 0.0) {
            current?.let { dao.deleteDraftLine(it.id) }
        } else {
            dao.saveDraftLine(
                OrderDraftLineEntity(
                    id = current?.id ?: UUID.randomUUID().toString(),
                    draftId = draftId,
                    productCode = productCode,
                    unitCode = unitCode,
                    quantity = quantity,
                    manualDiscountPercent = current?.manualDiscountPercent ?: 0.0,
                ),
            )
        }
        Unit
    }

    override suspend fun changeDraftDiscount(
        draftId: String,
        productCode: String,
        unitCode: String,
        percent: Double,
    ): Unit = withContext(Dispatchers.IO) {
        check(dao.draft(draftId)?.state == "draft") { "Bu sipariş taslağı artık düzenlenemez." }
        require(percent.isFinite() && percent in 0.0..100.0) { "İskonto oranı 0 ile 100 arasında olmalıdır." }
        val line = dao.draftLines(draftId).firstOrNull {
            it.productCode == productCode && it.unitCode == unitCode
        } ?: error("Sipariş kalemi bulunamadı.")
        dao.saveDraftLine(line.copy(manualDiscountPercent = percent))
    }

    override suspend fun queueVisitStart(
        customerCode: String,
        location: com.vdgida.vdesgo.sales.data.LocationReading?,
        allowUnverifiedLocation: Boolean,
        unverifiedReason: String?,
    ): Result<String> = withContext(Dispatchers.IO) {
        if (!requireOpenWorkday()) {
            return@withContext Result.failure(IllegalStateException("Ziyaret kaydı için günlük oturum açık olmalıdır."))
        }
        if (dao.customer(customerCode) == null) {
            return@withContext Result.failure(IllegalStateException(context.getString(R.string.error_customer_access_revoked)))
        }
        val open = dao.latestVisit(customerCode)?.takeIf {
            it.state in setOf("pending", "open", "completion_pending")
        }
        if (open != null) return@withContext Result.success(open.visitId)
        val visitId = UUID.randomUUID().toString()
        val operationId = UUID.randomUUID().toString()
        val payload = json.encodeToString(
            kotlinx.serialization.json.JsonObject.serializer(),
            json.encodeToJsonElement(
                com.vdgida.vdesgo.sales.data.VisitStartPayload.serializer(),
                com.vdgida.vdesgo.sales.data.VisitStartPayload(
                    customerCode = customerCode,
                    visitId = visitId,
                    latitude = location?.latitude,
                    longitude = location?.longitude,
                    accuracyM = location?.accuracyM,
                    capturedAt = location?.capturedAt,
                    allowUnverifiedLocation = allowUnverifiedLocation,
                    unverifiedReason = unverifiedReason,
                ),
            ).jsonObject,
        )
        val createdAt = Instant.now().toString()
        dao.storeOperation(
            OutboxOperationEntity(operationId, "visit.start", payload, createdAt, draftId = null),
            PendingVisitEntity(visitId, customerCode, "pending", operationId, createdAt),
        )
        SyncScheduler.enqueue(context)
        val syncResult = syncOutbox()
        if (syncResult.isFailure) return@withContext Result.failure(syncResult.exceptionOrNull()!!)
        val operation = dao.outboxOperation(operationId)
        if (operation?.state != "accepted") {
            val message = when (operation?.lastError) {
                "CUSTOMER_LOCATION_MISSING" -> "Müşterinin kayıtlı konumu bulunmuyor."
                "OUTSIDE_CUSTOMER_RADIUS" -> "Müşteri konumuna 30 metreden daha uzaktasınız."
                "VALIDATION_ERROR" -> "Konum doğruluğu yetersiz veya ölçümün süresi dolmuş."
                else -> operation?.lastError ?: "Konum doğrulanamadı."
            }
            return@withContext Result.failure(IllegalStateException(message))
        }
        Result.success(visitId)
    }

    override suspend fun completeLatestVisit(
        customerCode: String,
        visitResult: String,
        note: String,
    ): Result<Unit> = withContext(Dispatchers.IO) {
        if (!requireOpenWorkday()) {
            return@withContext Result.failure(IllegalStateException("Ziyaret kaydı için günlük oturum açık olmalıdır."))
        }
        if (dao.customer(customerCode) == null) {
            return@withContext Result.failure(IllegalStateException(context.getString(R.string.error_customer_access_revoked)))
        }
        val visit = dao.latestVisit(customerCode)?.takeIf {
            it.state in setOf("pending", "open", "completion_pending")
        } ?: return@withContext Result.failure(
            IllegalStateException(context.getString(R.string.error_no_open_visit)),
        )
        val alreadyQueued = dao.outboxOperation(visit.completionOperationId ?: "")
        if (alreadyQueued != null) return@withContext Result.success(Unit)
        val operationId = UUID.randomUUID().toString()
        val payload = json.encodeToString(
            kotlinx.serialization.json.JsonObject.serializer(),
            json.encodeToJsonElement(
                com.vdgida.vdesgo.sales.data.VisitCompletePayload.serializer(),
                com.vdgida.vdesgo.sales.data.VisitCompletePayload(visit.visitId, visitResult, note),
            ).jsonObject,
        )
        val operation = OutboxOperationEntity(
            operationId, "visit.complete", payload, Instant.now().toString(),
        )
        dao.storeOperation(operation, visit.copy(state = "completion_pending", completionOperationId = operationId))
        SyncScheduler.enqueue(context)
        Result.success(Unit)
    }

    override suspend fun quoteDraft(
        draftId: String,
        discountSelection: Map<String, Boolean>,
        selectedPromotionId: String?,
    ): QuoteOutcome = withContext(Dispatchers.IO) {
        val draft = dao.draft(draftId)
            ?: return@withContext QuoteOutcome.Failed(context.getString(R.string.error_draft_missing))
        if (dao.customer(draft.customerCode) == null || draft.state == "access_revoked") {
            return@withContext QuoteOutcome.Failed(context.getString(R.string.error_customer_access_revoked))
        }
        val payload = orderPayload(draftId, draft.customerCode, discountSelection, selectedPromotionId)
            ?: return@withContext QuoteOutcome.Failed(context.getString(R.string.error_empty_order))
        val trace = connectivity.newTrace("pricing.quote")
        try {
            val response = if (draft.documentType == "van_sale") {
                api.quoteSales(payload, trace)
            } else {
                api.quote(payload, trace)
            }
            if (!response.isSuccessful) return@withContext QuoteOutcome.Failed(responseError(response))
            val body = response.body()
                ?: return@withContext QuoteOutcome.Failed(unreadableResponse(trace, null).message.orEmpty())
            QuoteOutcome.Available(body)
        } catch (error: IOException) {
            QuoteOutcome.Failed(requestFailure(trace, error).message.orEmpty())
        } catch (error: SerializationException) {
            QuoteOutcome.Failed(unreadableResponse(trace, error).message.orEmpty())
        }
    }

    override suspend fun submitDraft(
        draftId: String,
        discountSelection: Map<String, Boolean>,
        selectedPromotionId: String?,
        rewardSnapshot: List<OrderLinePayload>,
    ): Result<String> = withContext(Dispatchers.IO) {
        try {
            if (!requireOpenWorkday()) {
                return@withContext Result.failure(IllegalStateException("Siparişi göndermek için günlük oturum açık olmalıdır."))
            }
            val draft = dao.draft(draftId) ?: return@withContext Result.failure(IllegalStateException("Taslak bulunamadı."))
            if (draft.state == "access_revoked" || dao.customer(draft.customerCode) == null) {
                return@withContext Result.failure(IllegalStateException(context.getString(R.string.error_customer_access_revoked)))
            }
            if (draft.state != "draft") return@withContext Result.failure(IllegalStateException("Bu taslak daha önce gönderildi."))
            val payload = orderPayload(draftId, draft.customerCode, discountSelection, selectedPromotionId)
                ?.let { if (draft.documentType == "van_sale") it.copy(stockRewardSnapshot = rewardSnapshot) else it }
                ?: return@withContext Result.failure(IllegalStateException("Siparişe en az bir ürün ekleyin."))
            if (draft.documentType == "van_sale") {
                validateHotSaleStock(payload.stockConsumingLines(), null)?.let {
                    return@withContext Result.failure(IllegalStateException(it))
                }
            }
            val operationId = UUID.randomUUID().toString()
            val operation = OutboxOperationEntity(
                operationId = operationId,
                type = if (draft.documentType == "van_sale") "sale.submit" else "order.submit",
                payload = json.encodeToString(OrderPayload.serializer(), payload),
                clientCreatedAt = Instant.now().toString(),
                draftId = draftId,
            )
            dao.storeOperation(operation)
            SyncScheduler.enqueue(context)
            Result.success(operationId)
        } catch (error: IOException) {
            Result.failure(error)
        } catch (error: SerializationException) {
            Result.failure(error)
        }
    }

    override suspend fun currentSyncTime(): String? = dao.syncState()?.lastSyncAt
    override suspend fun syncCursor(): String = dao.syncState()?.cursor ?: "0"
    override fun maskedDeviceId(): String = secureStore.maskedDeviceId()
    override fun apiBaseUrl(): String = BuildConfig.MOBILE_API_BASE_URL
    override fun mockModeEnabled(): Boolean = BuildConfig.DEBUG_MOCK_MODE

    private fun requestFailure(trace: ApiRequestTrace?, error: IOException): Throwable {
        logRequestFailure(trace, error)
        return if (trace?.responseCode != null) {
            IllegalStateException(context.getString(R.string.error_unexpected_response), error)
        } else {
            IOException(context.getString(R.string.error_connection), error)
        }
    }

    private fun unreadableResponse(trace: ApiRequestTrace?, error: Throwable?): IllegalStateException {
        logResponseFailure(trace, error)
        return IllegalStateException(context.getString(R.string.error_unexpected_response), error)
    }

    private fun logRequestFailure(trace: ApiRequestTrace?, error: IOException) {
        if (BuildConfig.DEBUG) {
            Log.w(
                "MobileApi",
                "FAIL event=${connectivity.nextEventSequence()} requestId=${trace?.requestId ?: "none"} " +
                    "type=${trace?.requestType ?: "unclassified"} operation=${trace?.operationFingerprint ?: "none"} " +
                    "attempt=${trace?.attempt ?: 0} requestSeq=${trace?.sequence ?: 0} " +
                    "http=${trace?.responseCode ?: "none"} exception=${error.javaClass.simpleName}",
            )
        }
    }

    private fun logResponseFailure(trace: ApiRequestTrace?, error: Throwable?) {
        if (BuildConfig.DEBUG) {
            Log.e(
                "MobileApi",
                "PARSE_FAIL event=${connectivity.nextEventSequence()} requestId=${trace?.requestId ?: "none"} " +
                    "type=${trace?.requestType ?: "unclassified"} operation=${trace?.operationFingerprint ?: "none"} " +
                    "attempt=${trace?.attempt ?: 0} requestSeq=${trace?.sequence ?: 0} " +
                    "http=${trace?.responseCode ?: "none"} exception=${error?.javaClass?.simpleName ?: "EmptyBody"}",
            )
        }
    }

    private suspend fun updateVisitState(operation: OutboxOperationEntity, status: String) {
        if (operation.type == "visit.start") {
            json.decodeFromString<JsonObject>(operation.payload).string("visitId")
            dao.updateVisitByStartOperation(
                operation.operationId,
                if (status == "accepted") "open" else if (status == "rejected") "rejected" else "pending",
            )
        } else if (operation.type == "visit.complete") {
            dao.updateVisitByCompletionOperation(
                operation.operationId,
                if (status == "accepted") "complete" else if (status == "rejected") "open" else "completion_pending",
            )
        }
    }

    private suspend fun draftSummary(draft: OrderDraftEntity): DraftSummary {
        val customer = customer(draft.customerCode)
        val productsByCode = products().associateBy { it.code }
        val lines = dao.draftLines(draft.id).map { line ->
            DraftLineSummary(
                id = line.id,
                productCode = line.productCode,
                productName = productsByCode[line.productCode]?.name ?: line.productCode,
                unitCode = line.unitCode,
                quantity = line.quantity,
                unitNetPrice = productsByCode[line.productCode]?.netPrice,
                manualDiscountPercent = line.manualDiscountPercent,
            )
        }
        return DraftSummary(
            id = draft.id,
            customerCode = draft.customerCode,
            customerName = customer?.name ?: draft.customerCode,
            state = draft.state,
            createdAt = draft.createdAt,
            lines = lines,
            netEstimate = lines.sumOf { (it.unitNetPrice ?: 0.0) * it.quantity },
            documentType = draft.documentType,
        )
    }

    private suspend fun orderPayload(
        draftId: String,
        customerCode: String,
        discountSelection: Map<String, Boolean>,
        selectedPromotionId: String?,
    ): OrderPayload? {
        val lines = dao.draftLines(draftId)
        if (lines.isEmpty()) return null
        val state = dao.syncState() ?: SyncStateEntity()
        val documentType = dao.draft(draftId)?.documentType ?: "order"
        val date = dailyBusinessDate()
        val displayedPriceRevisions = lines.mapNotNull { line ->
            cachedPrice(
                customerCode,
                line.productCode,
                line.unitCode,
                if (documentType == "order") "van_sale" else documentType,
                date,
            )?.priceRevision?.toLongOrNull()
        }
        val priceRevision = displayedPriceRevisions.minOrNull()?.toString() ?: state.priceRevision
        val promotionDeclined = selectedPromotionId == "SKIP"
        val promotionParts = selectedPromotionId
            ?.takeUnless { promotionDeclined }
            ?.split(":", limit = 2)
        return OrderPayload(
            customerCode = customerCode,
            priceRevision = priceRevision,
            promotionRevision = state.promotionRevision,
            lines = lines.map {
                OrderLinePayload(it.productCode, it.unitCode, it.quantity, it.manualDiscountPercent)
            },
            discountSelection = discountSelection,
            selectedPromotionId = promotionParts?.getOrNull(0),
            selectedRewardProductCode = promotionParts?.getOrNull(1),
            skipPromotions = promotionDeclined,
            requirePromotionSelection = true,
        )
    }

    private fun BootstrapResponse.rows(): BootstrapRows = BootstrapRows(
        customers = data.customers.map { it.customerEntity() },
        products = data.products.map { it.productEntity() },
        units = data.units.map { it.unitEntity() },
        prices = data.prices.map { it.priceEntity() },
        promotions = data.promotions.map { it.promotionEntity() },
        route = data.route.map { it.routeEntity() },
    )

    private val SyncChange.cacheChange: CacheChange
        get() = CacheChange(entityType, entityKey, changeType, record)

    private fun JsonObject.toCustomer(): CustomerSummary = CustomerSummary(
        code = string("code"),
        name = string("name").ifBlank { string("title") },
        address = stringOrNull("address"),
        phone = stringOrNull("phone") ?: stringOrNull("mobilePhone"),
        province = stringOrNull("province"),
        district = stringOrNull("district"),
        visitState = null,
        title = stringOrNull("title"),
        taxOffice = stringOrNull("taxOffice"),
        taxNo = stringOrNull("taxNo"),
        tckn = stringOrNull("tckn"),
        balance = stringOrNull("balance"),
        creditLimit = creditLimit(),
        openOrderAmount = openOrderAmount(),
        locationLatitude = doubleOrNull("locationLatitude"),
        locationLongitude = doubleOrNull("locationLongitude"),
        locationAccuracyM = doubleOrNull("locationAccuracyM"),
        locationCapturedAt = stringOrNull("locationCapturedAt"),
    )

    private fun JsonObject.string(key: String): String =
        this[key]?.jsonPrimitive?.contentOrNull.orEmpty()

    private fun JsonObject.stringOrNull(key: String): String? =
        this[key]?.jsonPrimitive?.contentOrNull?.takeIf(String::isNotBlank)

    private fun JsonObject.doubleOrNull(key: String): Double? =
        this[key]?.jsonPrimitive?.doubleOrNull

    private fun JsonObject.creditLimit(): Double? =
        (doubleOrNull("creditLimit") ?: doubleOrNull("credit_limit"))?.takeIf { it.isFinite() && it >= 0.0 }

    private fun JsonObject.openOrderAmount(): Double? =
        (doubleOrNull("openOrderAmount") ?: doubleOrNull("open_order_amount"))?.takeIf { it.isFinite() }

    private fun responseCode(response: retrofit2.Response<*>): String? =
        response.errorBody()?.use { body ->
            try {
                json.decodeFromString<ApiErrorEnvelope>(body.string()).error?.code
            } catch (_: SerializationException) {
                null
            }
        }

    private fun responseError(response: retrofit2.Response<*>): String {
        val error = response.errorBody()?.use { body ->
            try {
                json.decodeFromString<ApiErrorEnvelope>(body.string()).error
            } catch (_: SerializationException) {
                null
            }
        }
        return error?.message ?: when (response.code()) {
            401 -> context.getString(R.string.error_session_expired)
            403 -> context.getString(R.string.error_forbidden)
            in 500..599 -> context.getString(R.string.error_server)
            else -> context.getString(R.string.error_generic)
        }
    }

    private fun apiException(response: retrofit2.Response<*>): IOException =
        IOException("${responseCode(response) ?: response.code()}: ${responseError(response)}")

    private val OperationUiState.storageState: String
        get() = when (this) {
            OperationUiState.PENDING -> "pending"
            OperationUiState.SENDING -> "sending"
            OperationUiState.ACCEPTED -> "accepted"
            OperationUiState.CONFLICT -> "conflict"
            OperationUiState.APPROVAL -> "requires_approval"
            OperationUiState.REJECTED -> "rejected"
            OperationUiState.RETRY -> "retry"
            OperationUiState.CANCEL_PENDING -> "cancel_pending"
            OperationUiState.CANCELLED -> "cancelled"
        }
}
