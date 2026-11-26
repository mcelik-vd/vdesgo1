package com.vdgida.vdesgo.sales.data.remote

import com.vdgida.vdesgo.sales.data.BootstrapResponse
import com.vdgida.vdesgo.sales.data.DeviceLoginRequest
import com.vdgida.vdesgo.sales.data.OutsideRouteResponse
import com.vdgida.vdesgo.sales.data.OperationResult
import com.vdgida.vdesgo.sales.data.PriceSnapshotRequest
import com.vdgida.vdesgo.sales.data.PriceSnapshotResponse
import com.vdgida.vdesgo.sales.data.PullResponse
import com.vdgida.vdesgo.sales.data.QuoteResponse
import com.vdgida.vdesgo.sales.data.SessionResponse
import com.vdgida.vdesgo.sales.data.SyncPushRequest
import com.vdgida.vdesgo.sales.data.SyncPushResponse
import com.vdgida.vdesgo.sales.data.OrderPayload
import com.vdgida.vdesgo.sales.data.WorkdayCloseRequest
import com.vdgida.vdesgo.sales.data.WorkdayCloseResponse
import com.vdgida.vdesgo.sales.data.CollectionSubmitRequest
import com.vdgida.vdesgo.sales.data.SaleCorrectionRequest
import com.vdgida.vdesgo.sales.data.CustomerCreateRequest
import com.vdgida.vdesgo.sales.data.CustomerTaxNumberCheckResponse
import com.vdgida.vdesgo.sales.data.CustomerTypesResponse
import com.vdgida.vdesgo.sales.data.CustomerGroupsResponse
import com.vdgida.vdesgo.sales.data.WorkdayCurrentResponse
import com.vdgida.vdesgo.sales.data.VehicleStockResponse
import com.vdgida.vdesgo.sales.data.WorkdayOpenResponse
import com.vdgida.vdesgo.sales.data.WorkdayOpenRequest
import com.vdgida.vdesgo.sales.data.TodayRouteResponse
import com.vdgida.vdesgo.sales.data.PendingLocationRequestResponse
import com.vdgida.vdesgo.sales.data.RoutePointUploadRequest
import com.vdgida.vdesgo.sales.data.RoutePointUploadResponse
import kotlinx.serialization.json.JsonObject
import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.PUT
import retrofit2.http.Path
import retrofit2.http.Query
import retrofit2.http.Tag

interface MobileApi {
    @POST("auth/session")
    suspend fun login(
        @Body request: DeviceLoginRequest,
        @Tag trace: ApiRequestTrace? = null,
    ): Response<SessionResponse>

    @GET("me")
    suspend fun me(@Tag trace: ApiRequestTrace? = null): Response<SessionResponse>

    @POST("auth/logout")
    suspend fun logout(@Tag trace: ApiRequestTrace? = null): Response<Unit>

    @GET("bootstrap")
    suspend fun bootstrap(
        @Query("limit") limit: Int = 50,
        @Query("pageToken") pageToken: String? = null,
        @Tag trace: ApiRequestTrace? = null,
    ): Response<BootstrapResponse>

    @GET("sync/pull")
    suspend fun pull(
        @Query("cursor") cursor: String,
        @Query("limit") limit: Int = 100,
        @Tag trace: ApiRequestTrace? = null,
    ): Response<PullResponse>

    @POST("sync/push")
    suspend fun push(
        @Body request: SyncPushRequest,
        @Tag trace: ApiRequestTrace? = null,
    ): Response<SyncPushResponse>

    @GET("sync/operations/{operationId}")
    suspend fun operation(
        @Path("operationId") operationId: String,
        @Tag trace: ApiRequestTrace? = null,
    ): Response<OperationResult>

    @DELETE("documents/{operationId}")
    suspend fun deleteDocument(
        @Path("operationId") operationId: String,
        @Tag trace: ApiRequestTrace? = null,
    ): Response<Unit>

    @POST("documents/{operationId}/printed")
    suspend fun reportDocumentPrinted(
        @Path("operationId") operationId: String,
        @Body request: JsonObject,
        @Tag trace: ApiRequestTrace? = null,
    ): Response<Unit>

    @PUT("documents/{operationId}")
    suspend fun replaceSalesInvoice(
        @Path("operationId") operationId: String,
        @Body request: SaleCorrectionRequest,
        @Tag trace: ApiRequestTrace? = null,
    ): Response<OperationResult>

    @GET("customers/{customerCode}/sales-context")
    suspend fun salesContext(
        @Path("customerCode") customerCode: String,
        @Tag trace: ApiRequestTrace? = null,
    ): Response<JsonObject>

    @GET("customer-types")
    suspend fun customerTypes(@Tag trace: ApiRequestTrace? = null): Response<CustomerTypesResponse>

    @GET("customer-groups")
    suspend fun customerGroups(@Tag trace: ApiRequestTrace? = null): Response<CustomerGroupsResponse>

    @GET("customers/tax-number-check")
    suspend fun customerTaxNumberCheck(
        @Query("taxNo") taxNo: String,
        @Tag trace: ApiRequestTrace? = null,
    ): Response<CustomerTaxNumberCheckResponse>

    @POST("customers")
    suspend fun createCustomer(
        @Body request: CustomerCreateRequest,
        @Tag trace: ApiRequestTrace? = null,
    ): Response<JsonObject>

    @GET("customers/{customerCode}/products/{productCode}/unit-price")
    suspend fun unitPrice(
        @Path("customerCode") customerCode: String,
        @Path("productCode") productCode: String,
        @Query("unitCode") unitCode: String,
        @Query("documentType") documentType: String,
        @Tag trace: ApiRequestTrace? = null,
    ): Response<JsonObject>

    @POST("pricing/snapshot")
    suspend fun pricingSnapshot(
        @Body request: PriceSnapshotRequest,
        @Tag trace: ApiRequestTrace? = null,
    ): Response<PriceSnapshotResponse>

    @POST("pricing/quote")
    suspend fun quote(
        @Body payload: OrderPayload,
        @Tag trace: ApiRequestTrace? = null,
    ): Response<QuoteResponse>

    @POST("sales/quote")
    suspend fun quoteSales(
        @Body payload: OrderPayload,
        @Tag trace: ApiRequestTrace? = null,
    ): Response<QuoteResponse>

    @GET("day/current")
    suspend fun currentWorkday(@Tag trace: ApiRequestTrace? = null): Response<WorkdayCurrentResponse>

    @GET("day/stock")
    suspend fun currentVehicleStock(@Tag trace: ApiRequestTrace? = null): Response<VehicleStockResponse>

    @POST("day/open")
    suspend fun openWorkday(
        @Body request: WorkdayOpenRequest,
        @Tag trace: ApiRequestTrace? = null,
    ): Response<WorkdayOpenResponse>

    @POST("day/close")
    suspend fun closeWorkday(
        @Body request: WorkdayCloseRequest,
        @Tag trace: ApiRequestTrace? = null,
    ): Response<WorkdayCloseResponse>

    @POST("collections")
    suspend fun submitCollection(
        @Body request: CollectionSubmitRequest,
        @Tag trace: ApiRequestTrace? = null,
    ): Response<OperationResult>

    @GET("route/outside")
    suspend fun outsideRoute(
        @Query("day") day: String? = null,
        @Tag trace: ApiRequestTrace? = null,
    ): Response<OutsideRouteResponse>

    @GET("route/today")
    suspend fun todayRoute(@Tag trace: ApiRequestTrace? = null): Response<TodayRouteResponse>

    @GET("location/requests/pending")
    suspend fun pendingLocationRequest(
        @Tag trace: ApiRequestTrace? = null,
    ): Response<PendingLocationRequestResponse>

    @POST("location/points")
    suspend fun uploadRoutePoints(
        @Body request: RoutePointUploadRequest,
        @Tag trace: ApiRequestTrace? = null,
    ): Response<RoutePointUploadResponse>
}
