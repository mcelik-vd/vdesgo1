package com.vdgida.vdesgo.sales.data.local

import android.content.Context
import androidx.room.Dao
import androidx.room.Database
import androidx.room.Entity
import androidx.room.ForeignKey
import androidx.room.Index
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.Transaction
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase
import androidx.sqlite.db.SupportSQLiteOpenHelper
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive
import net.zetetic.database.sqlcipher.SQLiteDatabase
import net.zetetic.database.sqlcipher.SupportOpenHelperFactory
import java.security.SecureRandom
import java.util.Base64

@Entity(tableName = "sync_state")
data class SyncStateEntity(
    @PrimaryKey val id: Int = 1,
    val nextPageToken: String? = null,
    val bootstrapStarted: Boolean = false,
    val bootstrapComplete: Boolean = false,
    val cursor: String = "0",
    val priceRevision: String = "0",
    val promotionRevision: String = "0",
    val lastSyncAt: String? = null,
)

@Entity(tableName = "cached_customers", indices = [Index("code")])
data class CachedCustomerEntity(@PrimaryKey val id: String, val code: String, val payload: String)

@Entity(tableName = "cached_products", indices = [Index("code")])
data class CachedProductEntity(@PrimaryKey val id: String, val code: String, val payload: String)

@Entity(tableName = "cached_product_units", indices = [Index("productCode")])
data class CachedProductUnitEntity(
    @PrimaryKey val id: String,
    val productCode: String,
    val payload: String,
)

@Entity(tableName = "cached_price_candidates", indices = [Index("productCode")])
data class CachedPriceCandidateEntity(
    @PrimaryKey val id: String,
    val productCode: String,
    val payload: String,
)

@Entity(tableName = "cached_promotion_candidates")
data class CachedPromotionCandidateEntity(@PrimaryKey val id: String, val payload: String)

@Entity(tableName = "cached_route_stops", indices = [Index("customerCode")])
data class CachedRouteStopEntity(
    @PrimaryKey val id: String,
    val customerCode: String,
    val routeDay: String,
    val payload: String,
)

@Entity(tableName = "order_drafts")
data class OrderDraftEntity(
    @PrimaryKey val id: String,
    val customerCode: String,
    val createdAt: String,
    val state: String = "draft",
    val documentType: String = "order",
)

@Entity(
    tableName = "order_draft_lines",
    foreignKeys = [
        ForeignKey(
            entity = OrderDraftEntity::class,
            parentColumns = ["id"],
            childColumns = ["draftId"],
            onDelete = ForeignKey.CASCADE,
        ),
    ],
    indices = [Index("draftId")],
)
data class OrderDraftLineEntity(
    @PrimaryKey val id: String,
    val draftId: String,
    val productCode: String,
    val unitCode: String,
    val quantity: Double,
    val manualDiscountPercent: Double,
)

@Entity(tableName = "outbox_operations", indices = [Index("state"), Index("clientCreatedAt")])
data class OutboxOperationEntity(
    @PrimaryKey val operationId: String,
    val type: String,
    val payload: String,
    val clientCreatedAt: String,
    val state: String = "pending",
    val retryCount: Int = 0,
    val lastError: String? = null,
    val draftId: String? = null,
    val result: String? = null,
    val documentNumber: String? = null,
    val printedAt: String? = null,
    val printNumber: String? = null,
    val printSynced: Boolean = false,
    val cancellationRequested: Boolean = false,
)

@Entity(tableName = "pending_visits", indices = [Index("customerCode"), Index("state")])
data class PendingVisitEntity(
    @PrimaryKey val visitId: String,
    val customerCode: String,
    val state: String,
    val startOperationId: String,
    val createdAt: String,
    val completionOperationId: String? = null,
)

@Entity(tableName = "daily_work_session")
data class DailyWorkSessionEntity(
    @PrimaryKey val id: Int = 1,
    val businessDate: String,
    val status: String,
    val payload: String,
)

@Entity(tableName = "cached_vehicle_stock")
data class CachedVehicleStockEntity(
    @PrimaryKey val id: Int = 1,
    val warehouseCode: String?,
    val fetchedAt: String,
    val payload: String,
    val includedOperationIds: String,
)

@Entity(
    tableName = "route_location_points",
    indices = [Index("uploaded"), Index("recordedAt"), Index("workSessionId")],
)
data class RouteLocationPointEntity(
    @PrimaryKey val id: String,
    val workSessionId: String,
    val recordedAt: String,
    val latitude: Double,
    val longitude: Double,
    val accuracyM: Double,
    val speedMps: Double? = null,
    val bearingDegrees: Double? = null,
    val uploaded: Boolean = false,
)

@Dao
interface OfflineDao {
    @Query("SELECT * FROM daily_work_session WHERE id = 1")
    suspend fun workSession(): DailyWorkSessionEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun saveWorkSession(value: DailyWorkSessionEntity)

    @Query("DELETE FROM daily_work_session")
    suspend fun clearWorkSession()

    @Query("SELECT * FROM cached_vehicle_stock WHERE id = 1")
    suspend fun vehicleStock(): CachedVehicleStockEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun saveVehicleStock(value: CachedVehicleStockEntity)

    @Query("DELETE FROM cached_vehicle_stock")
    suspend fun clearVehicleStock()

    @Query("SELECT * FROM outbox_operations WHERE type = 'sale.submit'")
    suspend fun saleOperations(): List<OutboxOperationEntity>

    @Query("UPDATE outbox_operations SET state = 'retry', lastError = :error WHERE state = 'sending' AND operationId IN (:ids)")
    suspend fun markInterruptedOperations(ids: List<String>, error: String): Int

    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insertRoutePoint(value: RouteLocationPointEntity): Long

    @Query("SELECT * FROM route_location_points WHERE uploaded = 0 ORDER BY recordedAt LIMIT :limit")
    suspend fun pendingRoutePoints(limit: Int = 1000): List<RouteLocationPointEntity>

    @Query("SELECT * FROM route_location_points WHERE uploaded = 0 AND workSessionId = :workSessionId ORDER BY recordedAt LIMIT :limit")
    suspend fun pendingRoutePointsForSession(workSessionId: String, limit: Int = 1000): List<RouteLocationPointEntity>

    @Query("UPDATE route_location_points SET uploaded = 1 WHERE id IN (:ids)")
    suspend fun markRoutePointsUploaded(ids: List<String>)

    @Query("DELETE FROM route_location_points")
    suspend fun clearRoutePoints()

    @Query("DELETE FROM route_location_points WHERE workSessionId != :workSessionId")
    suspend fun clearRoutePointsExcept(workSessionId: String)

    @Query("SELECT * FROM sync_state WHERE id = 1")
    suspend fun syncState(): SyncStateEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun saveSyncState(value: SyncStateEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun putCustomers(values: List<CachedCustomerEntity>)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun putProducts(values: List<CachedProductEntity>)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun putUnits(values: List<CachedProductUnitEntity>)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun putPrices(values: List<CachedPriceCandidateEntity>)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun putPromotions(values: List<CachedPromotionCandidateEntity>)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun putRoute(values: List<CachedRouteStopEntity>)

    @Query("DELETE FROM cached_route_stops WHERE routeDay = :routeDay")
    suspend fun clearRouteDay(routeDay: String)

    @Query("SELECT * FROM cached_customers ORDER BY code")
    suspend fun customers(): List<CachedCustomerEntity>

    @Query("SELECT * FROM cached_customers WHERE code = :code LIMIT 1")
    suspend fun customer(code: String): CachedCustomerEntity?

    @Query("SELECT * FROM cached_products ORDER BY code")
    suspend fun products(): List<CachedProductEntity>

    @Query("SELECT * FROM cached_product_units WHERE productCode = :productCode")
    suspend fun units(productCode: String): List<CachedProductUnitEntity>

    @Query("SELECT * FROM cached_price_candidates WHERE productCode = :productCode")
    suspend fun prices(productCode: String): List<CachedPriceCandidateEntity>

    @Query("SELECT * FROM cached_price_candidates WHERE id = :id LIMIT 1")
    suspend fun priceById(id: String): CachedPriceCandidateEntity?

    @Query("SELECT * FROM cached_route_stops ORDER BY id")
    suspend fun route(): List<CachedRouteStopEntity>

    @Query("SELECT * FROM cached_promotion_candidates")
    suspend fun promotions(): List<CachedPromotionCandidateEntity>

    @Query("DELETE FROM cached_customers")
    suspend fun clearCustomers()

    @Query("DELETE FROM cached_products")
    suspend fun clearProducts()

    @Query("DELETE FROM cached_product_units")
    suspend fun clearUnits()

    @Query("DELETE FROM cached_price_candidates")
    suspend fun clearPrices()

    @Query("DELETE FROM cached_price_candidates WHERE id LIKE 'unit-price:%'")
    suspend fun clearResolvedUnitPrices()

    @Transaction
    suspend fun replaceDailyPriceSnapshot(
        values: List<CachedPriceCandidateEntity>,
        marker: CachedPriceCandidateEntity,
    ) {
        clearResolvedUnitPrices()
        putPrices(values + marker)
    }

    @Transaction
    suspend fun replaceRouteDay(routeDay: String, values: List<CachedRouteStopEntity>) {
        clearRouteDay(routeDay)
        putRoute(values)
    }

    @Transaction
    suspend fun cacheCreatedCustomer(customer: CachedCustomerEntity, route: CachedRouteStopEntity) {
        putCustomers(listOf(customer))
        putRoute(listOf(route))
    }

    @Transaction
    suspend fun storeCustomerCreation(
        operation: OutboxOperationEntity,
        customer: CachedCustomerEntity,
        route: CachedRouteStopEntity,
    ) {
        insertOutbox(operation)
        putCustomers(listOf(customer))
        putRoute(listOf(route))
    }

    @Transaction
    suspend fun removeProvisionalCustomer(customerCode: String) {
        deleteRouteForCustomer(customerCode)
        deleteCustomer(customerCode)
    }

    @Transaction
    suspend fun replaceProvisionalCustomer(
        customerCode: String,
        customer: CachedCustomerEntity,
        route: CachedRouteStopEntity,
    ) {
        removeProvisionalCustomer(customerCode)
        cacheCreatedCustomer(customer, route)
    }

    @Query("DELETE FROM cached_promotion_candidates")
    suspend fun clearPromotions()

    @Query("DELETE FROM cached_route_stops")
    suspend fun clearRoute()

    @Query("DELETE FROM cached_customers WHERE code = :code")
    suspend fun deleteCustomer(code: String)

    @Query("DELETE FROM cached_products WHERE code = :code")
    suspend fun deleteProduct(code: String)

    @Query("DELETE FROM cached_product_units WHERE id = :id")
    suspend fun deleteUnit(id: String)

    @Query("DELETE FROM cached_price_candidates WHERE id = :id")
    suspend fun deletePrice(id: String)

    @Query("DELETE FROM cached_promotion_candidates WHERE id = :id")
    suspend fun deletePromotion(id: String)

    @Query("DELETE FROM cached_route_stops WHERE customerCode = :customerCode")
    suspend fun deleteRouteForCustomer(customerCode: String)

    @Query("DELETE FROM cached_route_stops WHERE customerCode = :customerCode AND routeDay = :routeDay")
    suspend fun deleteRouteAssignment(customerCode: String, routeDay: String)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun saveDraft(value: OrderDraftEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun saveDraftLine(value: OrderDraftLineEntity)

    @Query("SELECT * FROM order_drafts ORDER BY createdAt DESC")
    suspend fun drafts(): List<OrderDraftEntity>

    @Query("SELECT * FROM order_drafts WHERE id = :id LIMIT 1")
    suspend fun draft(id: String): OrderDraftEntity?

    @Query("SELECT * FROM order_draft_lines WHERE draftId = :draftId ORDER BY id")
    suspend fun draftLines(draftId: String): List<OrderDraftLineEntity>

    @Query("DELETE FROM order_draft_lines WHERE id = :id")
    suspend fun deleteDraftLine(id: String)

    @Query("DELETE FROM order_drafts WHERE id = :id")
    suspend fun deleteDraft(id: String)

    @Query("UPDATE order_drafts SET state = :state WHERE id = :id")
    suspend fun updateDraftState(id: String, state: String)

    @Query("UPDATE order_drafts SET state = :state WHERE id = :id AND state != 'access_revoked'")
    suspend fun updateDraftStateUnlessAccessRevoked(id: String, state: String)

    @Query("UPDATE order_drafts SET state = 'access_revoked' WHERE customerCode = :customerCode AND state IN ('draft', 'pending', 'retry')")
    suspend fun revokeDraftsForCustomer(customerCode: String)

    @Query("UPDATE pending_visits SET state = 'access_revoked' WHERE customerCode = :customerCode AND state IN ('pending', 'open', 'completion_pending')")
    suspend fun revokeVisitsForCustomer(customerCode: String)

    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insertOutbox(value: OutboxOperationEntity): Long

    @Query("SELECT * FROM outbox_operations WHERE operationId = :id LIMIT 1")
    suspend fun outboxOperation(id: String): OutboxOperationEntity?

    @Query("SELECT * FROM outbox_operations WHERE state IN ('pending', 'retry') AND (type != 'sale.submit' OR printedAt IS NOT NULL) ORDER BY clientCreatedAt LIMIT :limit")
    suspend fun pendingOperations(limit: Int): List<OutboxOperationEntity>

    @Query("SELECT * FROM outbox_operations WHERE type = 'sale.submit' AND printedAt IS NOT NULL AND state = 'accepted' AND printSynced = 0 ORDER BY clientCreatedAt")
    suspend fun pendingPrintReports(): List<OutboxOperationEntity>

    @Query("SELECT * FROM outbox_operations WHERE type = 'sale.submit' AND cancellationRequested = 1 AND state = 'cancel_pending' ORDER BY clientCreatedAt")
    suspend fun pendingSaleCancellations(): List<OutboxOperationEntity>

    @Query("UPDATE outbox_operations SET printedAt = COALESCE(printedAt, :printedAt), printNumber = COALESCE(NULLIF(:printNumber, ''), printNumber), printSynced = CASE WHEN state = 'accepted' THEN 0 ELSE printSynced END, state = CASE WHEN state = 'rejected' AND lastError = 'SALE_PRINT_REQUIRED' THEN 'pending' ELSE state END, lastError = CASE WHEN state = 'rejected' AND lastError = 'SALE_PRINT_REQUIRED' THEN NULL ELSE lastError END WHERE operationId = :id AND type = 'sale.submit' AND printedAt IS NULL AND state NOT IN ('cancelled', 'cancel_pending')")
    suspend fun markDocumentPrinted(id: String, printedAt: String, printNumber: String?): Int

    @Query("UPDATE outbox_operations SET printSynced = 1 WHERE operationId = :id AND type = 'sale.submit' AND printedAt IS NOT NULL")
    suspend fun markPrintSynced(id: String): Int

    @Query("UPDATE outbox_operations SET cancellationRequested = 1, state = CASE WHEN state = 'accepted' THEN 'cancel_pending' ELSE state END WHERE operationId = :id AND type = 'sale.submit' AND printedAt IS NOT NULL AND state NOT IN ('cancelled', 'deleted')")
    suspend fun requestSaleCancellation(id: String): Int

    @Query("UPDATE outbox_operations SET state = 'cancelled', cancellationRequested = 1, lastError = NULL WHERE operationId = :id AND type = 'sale.submit' AND printedAt IS NOT NULL")
    suspend fun markSaleCancelled(id: String): Int

    @Query("UPDATE outbox_operations SET state = 'cancel_pending', cancellationRequested = 1, lastError = :error WHERE operationId = :id AND type = 'sale.submit' AND printedAt IS NOT NULL")
    suspend fun markSaleCancellationPending(id: String, error: String): Int

    @Query("UPDATE outbox_operations SET state = 'cancelled', printedAt = COALESCE(printedAt, :printedAt), printNumber = COALESCE(NULLIF(:printNumber, ''), printNumber), printSynced = 1 WHERE operationId = :id AND type = 'sale.submit'")
    suspend fun markSaleCancelledFromErp(id: String, printedAt: String?, printNumber: String?): Int

    @Query("UPDATE outbox_operations SET state = 'sending' WHERE operationId = :id AND state IN ('pending', 'retry')")
    suspend fun claimPendingOperation(id: String): Int

    @Query("SELECT * FROM outbox_operations ORDER BY clientCreatedAt DESC LIMIT :limit")
    suspend fun recentOperations(limit: Int): List<OutboxOperationEntity>

    @Query("SELECT * FROM outbox_operations WHERE type IN ('order.submit', 'sale.submit', 'collection.submit') ORDER BY clientCreatedAt DESC")
    suspend fun documentOperations(): List<OutboxOperationEntity>

    @Query("SELECT * FROM outbox_operations WHERE type = 'customer.create' ORDER BY clientCreatedAt DESC LIMIT 50")
    suspend fun customerCreationOperations(): List<OutboxOperationEntity>

    @Query("DELETE FROM outbox_operations WHERE operationId = :id")
    suspend fun deleteOutboxOperation(id: String): Int

    @Transaction
    suspend fun deleteUnsentCustomerCreation(id: String, customerCode: String): Boolean {
        val operation = outboxOperation(id) ?: return false
        if (operation.type != "customer.create"
            || operation.state !in setOf("pending", "rejected", "conflict")) {
            return false
        }
        if (deleteOutboxOperation(id) == 0) return false
        removeProvisionalCustomer(customerCode)
        return true
    }

    @Query("SELECT COUNT(*) FROM outbox_operations WHERE state IN ('pending', 'retry', 'sending', 'cancel_pending')")
    suspend fun pendingOperationCount(): Int

    @Query("UPDATE outbox_operations SET state = CASE WHEN :state = 'accepted' AND cancellationRequested = 1 THEN 'cancel_pending' ELSE :state END, retryCount = :retryCount, lastError = :error, result = :result, documentNumber = :documentNumber, printSynced = CASE WHEN type = 'sale.submit' AND :state = 'accepted' AND printedAt IS NOT NULL THEN 1 ELSE printSynced END WHERE operationId = :id")
    suspend fun updateOutboxState(
        id: String,
        state: String,
        retryCount: Int,
        error: String?,
        result: String?,
        documentNumber: String?,
    )

    @Query("UPDATE outbox_operations SET payload = :payload, draftId = :draftId, result = :result, documentNumber = :documentNumber, lastError = NULL WHERE operationId = :id AND type = 'sale.submit' AND state = 'accepted'")
    suspend fun updateAcceptedSaleCorrection(
        id: String,
        draftId: String,
        payload: String,
        result: String,
        documentNumber: String?,
    ): Int

    @Query("UPDATE outbox_operations SET state = CASE WHEN :state = 'cancelled' THEN 'cancelled' WHEN cancellationRequested = 1 THEN 'cancel_pending' ELSE :state END, printedAt = COALESCE(:printedAt, printedAt), printNumber = COALESCE(NULLIF(:printNumber, ''), printNumber), printSynced = CASE WHEN :printedAt IS NOT NULL THEN 1 ELSE printSynced END, cancellationRequested = CASE WHEN :state = 'cancelled' THEN 1 ELSE cancellationRequested END WHERE operationId = :operationId AND type = 'sale.submit'")
    suspend fun applySalesInvoiceSyncStatus(
        operationId: String,
        state: String,
        printedAt: String?,
        printNumber: String?,
    ): Int

    @Query("UPDATE outbox_operations SET state = 'retry', retryCount = retryCount + 1 WHERE state = 'sending'")
    suspend fun resetInterruptedOperations()

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun saveVisit(value: PendingVisitEntity)

    @Query("SELECT * FROM pending_visits WHERE customerCode = :customerCode ORDER BY createdAt DESC LIMIT 1")
    suspend fun latestVisit(customerCode: String): PendingVisitEntity?

    @Query("SELECT * FROM pending_visits WHERE state != 'complete' ORDER BY createdAt")
    suspend fun openVisits(): List<PendingVisitEntity>

    @Query("DELETE FROM pending_visits WHERE visitId = :visitId")
    suspend fun deleteVisit(visitId: String)

    @Query("UPDATE pending_visits SET state = :state WHERE startOperationId = :operationId")
    suspend fun updateVisitByStartOperation(operationId: String, state: String)

    @Query("UPDATE pending_visits SET state = :state WHERE completionOperationId = :operationId")
    suspend fun updateVisitByCompletionOperation(operationId: String, state: String)

    @Transaction
    suspend fun cloneDraft(sourceId: String, newId: String, createdAt: String): Boolean {
        val source = draft(sourceId) ?: return false
        saveDraft(OrderDraftEntity(newId, source.customerCode, createdAt, documentType = source.documentType))
        draftLines(sourceId).forEach { line ->
            saveDraftLine(line.copy(id = java.util.UUID.randomUUID().toString(), draftId = newId))
        }
        return true
    }

    @Transaction
    suspend fun storeOperation(operation: OutboxOperationEntity, visit: PendingVisitEntity? = null): Long {
        val inserted = insertOutbox(operation)
        if (visit != null) saveVisit(visit)
        operation.draftId?.let { updateDraftState(it, "pending") }
        return inserted
    }

    @Transaction
    suspend fun updateOperationResult(
        id: String,
        state: String,
        retryCount: Int,
        error: String?,
        result: String?,
        documentNumber: String?,
        draftId: String?,
    ) {
        updateOutboxState(id, state, retryCount, error, result, documentNumber)
        if (draftId != null) {
            when {
                state == "accepted" -> updateDraftState(draftId, state)
                error == "CUSTOMER_NOT_ASSIGNED" -> updateDraftState(draftId, "access_revoked")
                else -> updateDraftStateUnlessAccessRevoked(draftId, state)
            }
        }
    }

    @Transaction
    suspend fun deleteLocalDocument(id: String): Boolean {
        val operation = outboxOperation(id) ?: return false
        if (operation.type !in setOf("order.submit", "sale.submit")
            || operation.state !in setOf("pending", "retry", "conflict", "requires_approval", "rejected")
            || (operation.type == "sale.submit" && (operation.printedAt != null || operation.cancellationRequested))) {
            return false
        }
        if (deleteOutboxOperation(id) == 0) return false
        operation.draftId?.let { deleteDraft(it) }
        return true
    }

    @Transaction
    suspend fun deleteAcceptedDocument(id: String): Boolean {
        val operation = outboxOperation(id) ?: return false
        if (operation.type !in setOf("order.submit", "sale.submit") || operation.state != "accepted"
            || (operation.type == "sale.submit" && operation.printedAt != null)) {
            return false
        }
        if (deleteOutboxOperation(id) == 0) return false
        operation.draftId?.let { deleteDraft(it) }
        return true
    }

    @Transaction
    suspend fun finalizeAcceptedSaleCorrection(
        operationId: String,
        draftId: String,
        payload: String,
        result: String,
        documentNumber: String?,
    ): Boolean {
        val operation = outboxOperation(operationId) ?: return false
        if (operation.type != "sale.submit" || operation.state != "accepted") return false
        val updated = updateAcceptedSaleCorrection(operationId, draftId, payload, result, documentNumber)
        if (updated == 0) return false
        updateDraftState(draftId, "accepted")
        operation.draftId?.takeIf { it != draftId }?.let { deleteDraft(it) }
        return true
    }

    @Transaction
    suspend fun resetCacheForNewIdentity() {
        clearCustomers()
        clearProducts()
        clearUnits()
        clearPrices()
        clearPromotions()
        clearRoute()
        clearWorkSession()
        clearRoutePoints()
        clearVehicleStock()
        saveSyncState(SyncStateEntity())
    }

    @Transaction
    suspend fun persistBootstrapPage(
        data: BootstrapRows,
        state: SyncStateEntity,
        firstPage: Boolean,
    ) {
        if (firstPage) {
            clearCustomers()
            clearProducts()
            clearUnits()
            clearPrices()
            clearPromotions()
            clearRoute()
        }
        putCustomers(data.customers)
        putProducts(data.products)
        putUnits(data.units)
        putPrices(data.prices)
        putPromotions(data.promotions)
        putRoute(data.route)
        saveSyncState(state)
    }

    @Transaction
    suspend fun persistPullPage(changes: List<CacheChange>, nextState: SyncStateEntity) {
        changes.forEach { change ->
            when {
                change.changeType == "delete" || change.record == null -> when (change.entityType) {
                    "customer", "customer_access" -> {
                        deleteCustomer(change.entityKey)
                        deleteRouteForCustomer(change.entityKey)
                        revokeDraftsForCustomer(change.entityKey)
                        revokeVisitsForCustomer(change.entityKey)
                    }
                    "product" -> {
                        deleteProduct(change.entityKey)
                        clearUnitsForProduct(change.entityKey)
                        clearPricesForProduct(change.entityKey)
                    }
                    "product_unit" -> deleteUnit(change.entityKey)
                    "price" -> deletePrice(change.entityKey)
                    "promotion" -> deletePromotion(change.entityKey)
                    "route_assignment" -> deleteRouteAssignment(
                        change.entityKey.substringBefore(':'),
                        change.entityKey.substringAfter(':', ""),
                    )
                }
                else -> when (change.entityType) {
                    "customer", "customer_access" -> putCustomers(listOf(change.record.customerEntity()))
                    "product" -> putProducts(listOf(change.record.productEntity()))
                    "product_unit" -> putUnits(listOf(change.record.unitEntity()))
                    "price" -> putPrices(listOf(change.record.priceEntity()))
                    "promotion" -> putPromotions(listOf(change.record.promotionEntity()))
                    "route_assignment" -> putRoute(listOf(change.record.routeEntity()))
                    "sales_invoice" -> {
                        val operationId = change.record["operationId"]?.jsonPrimitive?.contentOrNull
                        val state = change.record["status"]?.jsonPrimitive?.contentOrNull
                            ?.lowercase()
                        if (operationId != null && state != null && state in setOf("accepted", "cancelled")) {
                            applySalesInvoiceSyncStatus(
                                operationId = operationId,
                                state = state,
                                printedAt = change.record["printedAt"]?.jsonPrimitive?.contentOrNull,
                                printNumber = change.record["mobilePrintNumber"]?.jsonPrimitive?.contentOrNull,
                            )
                        }
                    }
                }
            }
        }
        saveSyncState(nextState)
    }

    @Query("DELETE FROM cached_product_units WHERE productCode = :productCode")
    suspend fun clearUnitsForProduct(productCode: String)

    @Query("DELETE FROM cached_price_candidates WHERE productCode = :productCode")
    suspend fun clearPricesForProduct(productCode: String)

    @Transaction
    suspend fun clearAllLocalData() {
        resetCacheForNewIdentity()
        clearDraftsAndOutbox()
        clearVisits()
        clearWorkSession()
    }

    @Query("DELETE FROM order_draft_lines")
    suspend fun clearDraftLines()

    @Query("DELETE FROM order_drafts")
    suspend fun clearDraftHeaders()

    @Query("DELETE FROM outbox_operations")
    suspend fun clearOutbox()

    @Query("DELETE FROM pending_visits")
    suspend fun clearVisits()

    @Transaction
    suspend fun clearDraftsAndOutbox() {
        clearDraftLines()
        clearDraftHeaders()
        clearOutbox()
    }
}

data class BootstrapRows(
    val customers: List<CachedCustomerEntity>,
    val products: List<CachedProductEntity>,
    val units: List<CachedProductUnitEntity>,
    val prices: List<CachedPriceCandidateEntity>,
    val promotions: List<CachedPromotionCandidateEntity>,
    val route: List<CachedRouteStopEntity>,
)

data class CacheChange(
    val entityType: String,
    val entityKey: String,
    val changeType: String,
    val record: kotlinx.serialization.json.JsonObject?,
)

@Database(
    entities = [
        SyncStateEntity::class,
        CachedCustomerEntity::class,
        CachedProductEntity::class,
        CachedProductUnitEntity::class,
        CachedPriceCandidateEntity::class,
        CachedPromotionCandidateEntity::class,
        CachedRouteStopEntity::class,
        OrderDraftEntity::class,
        OrderDraftLineEntity::class,
        OutboxOperationEntity::class,
        PendingVisitEntity::class,
        DailyWorkSessionEntity::class,
        RouteLocationPointEntity::class,
        CachedVehicleStockEntity::class,
    ],
    version = 6,
    exportSchema = false,
)
abstract class OfflineDatabase : RoomDatabase() {
    abstract fun offlineDao(): OfflineDao

    companion object {
        fun open(context: Context, passphrase: ByteArray): OfflineDatabase {
            System.loadLibrary("sqlcipher")
            val factory: SupportSQLiteOpenHelper.Factory = SupportOpenHelperFactory(passphrase, null, true)
            return Room.databaseBuilder(context, OfflineDatabase::class.java, "vdesgo-offline.db")
                .openHelperFactory(factory)
                .addMigrations(MIGRATION_1_2, MIGRATION_2_3, MIGRATION_3_4, MIGRATION_4_5, MIGRATION_5_6)
                .build()
        }

        fun newPassphrase(): ByteArray = ByteArray(32).also(SecureRandom()::nextBytes)

        private val MIGRATION_1_2 = object : Migration(1, 2) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE order_drafts ADD COLUMN documentType TEXT NOT NULL DEFAULT 'order'")
            }
        }

        private val MIGRATION_2_3 = object : Migration(2, 3) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL(
                    "CREATE TABLE IF NOT EXISTS daily_work_session (id INTEGER NOT NULL PRIMARY KEY, businessDate TEXT NOT NULL, status TEXT NOT NULL, payload TEXT NOT NULL)",
                )
            }
        }

        private val MIGRATION_3_4 = object : Migration(3, 4) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL(
                    "CREATE TABLE IF NOT EXISTS route_location_points (id TEXT NOT NULL PRIMARY KEY, workSessionId TEXT NOT NULL, recordedAt TEXT NOT NULL, latitude REAL NOT NULL, longitude REAL NOT NULL, accuracyM REAL NOT NULL, speedMps REAL, bearingDegrees REAL, uploaded INTEGER NOT NULL DEFAULT 0)",
                )
                db.execSQL("CREATE INDEX IF NOT EXISTS index_route_location_points_uploaded ON route_location_points (uploaded)")
                db.execSQL("CREATE INDEX IF NOT EXISTS index_route_location_points_recordedAt ON route_location_points (recordedAt)")
                db.execSQL("CREATE INDEX IF NOT EXISTS index_route_location_points_workSessionId ON route_location_points (workSessionId)")
            }
        }

        private val MIGRATION_4_5 = object : Migration(4, 5) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL(
                    "CREATE TABLE IF NOT EXISTS cached_vehicle_stock (id INTEGER NOT NULL PRIMARY KEY, warehouseCode TEXT, fetchedAt TEXT NOT NULL, payload TEXT NOT NULL, includedOperationIds TEXT NOT NULL)",
                )
            }
        }

        private val MIGRATION_5_6 = object : Migration(5, 6) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE outbox_operations ADD COLUMN printedAt TEXT")
                db.execSQL("ALTER TABLE outbox_operations ADD COLUMN printNumber TEXT")
                db.execSQL("ALTER TABLE outbox_operations ADD COLUMN printSynced INTEGER NOT NULL DEFAULT 0")
                db.execSQL("ALTER TABLE outbox_operations ADD COLUMN cancellationRequested INTEGER NOT NULL DEFAULT 0")
            }
        }
    }
}
