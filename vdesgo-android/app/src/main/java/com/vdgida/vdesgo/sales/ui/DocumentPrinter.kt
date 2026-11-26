package com.vdgida.vdesgo.sales.ui

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.print.PrintAttributes
import android.print.PrintJob
import android.print.PrintManager
import android.util.Log
import android.webkit.WebView
import android.webkit.WebViewClient
import com.vdgida.vdesgo.sales.data.repository.DraftSummary
import com.vdgida.vdesgo.sales.data.repository.OperationSummary
import java.util.Locale
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonPrimitive
import com.vdgida.vdesgo.sales.printer.BluetoothPrinter
import com.vdgida.vdesgo.sales.printer.ThermalReceipt
import com.vdgida.vdesgo.sales.printer.ThermalReceiptLine
import com.vdgida.vdesgo.sales.data.repository.CustomerSummary
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

object DocumentPrinter {
    fun printDocument(
        context: Context,
        operation: OperationSummary,
        draft: DraftSummary?,
        representativeName: String,
        customer: CustomerSummary?,
        number: String,
        onQueued: () -> Unit,
        onError: (String) -> Unit,
    ) {
        val result = operation.result?.let {
            runCatching { Json.parseToJsonElement(it).jsonObject }.getOrNull()
        }
        val isSale = operation.type == "sale.submit"
        val total = result?.get("grandTotal")?.jsonPrimitive?.doubleOrNull ?: draft?.netEstimate ?: 0.0
        val subtotal = result?.get("subtotal")?.jsonPrimitive?.doubleOrNull
            ?: result?.get("subtotalAmount")?.jsonPrimitive?.doubleOrNull
            ?: draft?.lines.orEmpty().sumOf { line ->
                (line.unitNetPrice ?: 0.0) * line.quantity
            }.takeIf { it > 0.0 }
        val discountTotal = result?.get("discountAmount")?.jsonPrimitive?.doubleOrNull
            ?: result?.get("discountTotal")?.jsonPrimitive?.doubleOrNull
            ?: result?.get("totalDiscount")?.jsonPrimitive?.doubleOrNull
            ?: listOfNotNull(
                result?.get("productDiscountTotal")?.jsonPrimitive?.doubleOrNull,
                result?.get("customerDiscountTotal")?.jsonPrimitive?.doubleOrNull,
                result?.get("paymentDiscountTotal")?.jsonPrimitive?.doubleOrNull,
                result?.get("promotionTotal")?.jsonPrimitive?.doubleOrNull,
                result?.get("promotionDiscountTotal")?.jsonPrimitive?.doubleOrNull,
            ).takeIf { it.isNotEmpty() }?.sum()
        val vatTotal = result?.get("taxAmount")?.jsonPrimitive?.doubleOrNull
            ?: result?.get("taxTotal")?.jsonPrimitive?.doubleOrNull
            ?: result?.get("vatAmount")?.jsonPrimitive?.doubleOrNull
        val rows = draft?.lines.orEmpty().joinToString("") { line ->
            "<tr${if (isPieceUnit(line.unitCode)) " class=\"piece-unit\"" else ""}><td>${escape(line.productName)}</td><td>${format(line.quantity)} ${escape(line.unitCode)}</td>" +
                "<td>${line.unitNetPrice?.let(::money).orEmpty()}</td>" +
                "<td>${money(line.quantity * (line.unitNetPrice ?: 0.0))}</td></tr>"
        }
        val html = page(
            title = if (isSale) "SATIŞ FATURASI" else "SİPARİŞ",
            subtitle = escape(number.ifBlank { if (isSale) "FATURA NUMARASIZ · ERP'DEN VERİLEBİLİR" else "SİPARİŞ NUMARASI" }),
            body = """
                <div class="meta"><b>Müşteri:</b> ${escape(draft?.customerName.orEmpty())}</div>
                <div class="meta"><b>Müşteri Kodu:</b> ${escape(draft?.customerCode.orEmpty())}</div>
                <div class="meta"><b>Satış Temsilcisi:</b> ${escape(representativeName)}</div>
                <div class="meta"><b>Tarih:</b> ${escape(operation.createdAt)}</div>
                <table><thead><tr><th>Ürün</th><th>Miktar</th><th>Birim Fiyat</th><th>Tutar</th></tr></thead>
                <tbody>$rows</tbody></table>
                <div class="total">GENEL TOPLAM: ${money(total)}</div>
            """.trimIndent(),
        )
        val jobName = "${if (isSale) "Fatura" else "Sipariş"}-${number.ifBlank { operation.id.take(8) }}"
        val bluetoothPrinter = BluetoothPrinter(context)
        if (isSale && bluetoothPrinter.isConfigured()) {
            val receipt = ThermalReceipt(
                invoiceNumber = number.ifBlank { "Numarasiz" },
                date = operation.createdAt,
                customerName = draft?.customerName.orEmpty(),
                customerCode = draft?.customerCode.orEmpty(),
                customerTitle = customer?.title.orEmpty(),
                customerAddress = customer?.address.orEmpty(),
                customerPhone = customer?.phone.orEmpty(),
                customerTaxOffice = customer?.taxOffice.orEmpty(),
                customerTaxNo = customer?.taxNo.orEmpty(),
                customerTckn = customer?.tckn.orEmpty(),
                representativeName = representativeName,
                lines = run {
                    val serverLines = result?.get("lines")?.jsonArray.orEmpty()
                    val draftLines = draft?.lines.orEmpty()
                    if (serverLines.isNotEmpty()) {
                        serverLines.mapIndexed { index, element ->
                            val line = element.jsonObject
                            val fallback = draftLines.getOrNull(index)
                            ThermalReceiptLine(
                                productName = line["productName"]?.jsonPrimitive?.contentOrNull
                                    ?: fallback?.productName
                                    ?: "",
                                quantity = line["quantity"]?.jsonPrimitive?.doubleOrNull
                                    ?: fallback?.quantity
                                    ?: 0.0,
                                unitCode = line["unitCode"]?.jsonPrimitive?.contentOrNull
                                    ?: fallback?.unitCode
                                    ?: "",
                                unitPrice = line["effectiveUnitPrice"]?.jsonPrimitive?.doubleOrNull
                                    ?.let(::money)
                                    ?: line["baseUnitPrice"]?.jsonPrimitive?.doubleOrNull
                                        ?.let(::money)
                                    ?: fallback?.unitNetPrice?.let(::money)
                                    ?: "",
                                lineTotal = line["grossAmount"]?.jsonPrimitive?.doubleOrNull
                                    ?.let(::money)
                                    ?: line["lineTotal"]?.jsonPrimitive?.doubleOrNull
                                        ?.let(::money)
                                    ?: fallback?.let {
                                        money(it.quantity * (it.unitNetPrice ?: 0.0))
                                    }.orEmpty(),
                            )
                        }
                    } else {
                        draftLines.map { line ->
                            ThermalReceiptLine(
                                productName = line.productName,
                                quantity = line.quantity,
                                unitCode = line.unitCode,
                                unitPrice = line.unitNetPrice?.let(::money).orEmpty(),
                                lineTotal = money(line.quantity * (line.unitNetPrice ?: 0.0)),
                            )
                        }
                    }
                },
                subtotal = subtotal?.let(::money).orEmpty(),
                discountTotal = discountTotal?.let(::money).orEmpty(),
                vatTotal = vatTotal?.let(::money).orEmpty(),
                total = money(total),
            )
            kotlinx.coroutines.CoroutineScope(Dispatchers.IO).launch {
                val result = bluetoothPrinter.printReceipt(receipt)
                withContext(Dispatchers.Main) {
                    result.fold(
                        onSuccess = { onQueued() },
                        onFailure = { error -> onError(error.message ?: "Bluetooth yazdırma başarısız.") },
                    )
                }
            }
        } else {
            printHtml(context, jobName, html, onQueued, onError)
        }
    }

    fun printDailyList(
        context: Context,
        title: String,
        operations: List<OperationSummary>,
        drafts: List<DraftSummary>,
        customers: List<com.vdgida.vdesgo.sales.data.repository.CustomerSummary>,
    ) {
        val rows = operations.joinToString("") { operation ->
            val result = operation.result?.let {
                runCatching { Json.parseToJsonElement(it).jsonObject }.getOrNull()
            }
            val payload = runCatching { Json.parseToJsonElement(operation.payload).jsonObject }.getOrNull()
            val draft = operation.draftId?.let { id -> drafts.firstOrNull { it.id == id } }
            val customerCode = draft?.customerCode
                ?: result?.get("customerCode")?.jsonPrimitive?.contentOrNull
                ?: payload?.get("customerCode")?.jsonPrimitive?.contentOrNull
                ?: ""
            val customerName = draft?.customerName
                ?: customers.firstOrNull { it.code == customerCode }?.name
                ?: customerCode
            val amount = result?.get("grandTotal")?.jsonPrimitive?.doubleOrNull
                ?: result?.get("amount")?.jsonPrimitive?.doubleOrNull
                ?: draft?.netEstimate
            val number = operation.documentNumber
                ?: result?.get("invoiceNo")?.jsonPrimitive?.contentOrNull
                ?: result?.get("orderNo")?.jsonPrimitive?.contentOrNull
                ?: operation.id.take(8)
            "<tr><td>${escape(number)}</td><td>${escape(customerName)}</td><td>${amount?.let(::money).orEmpty()}</td></tr>"
        }
        val html = page(
            title = escape(title.uppercase(Locale("tr", "TR"))),
            subtitle = "Günlük kontrol listesi",
            body = """
                <table><thead><tr><th>Belge</th><th>Müşteri</th><th>Tutar</th></tr></thead>
                <tbody>$rows</tbody></table>
                <div class="total">Kayıt Sayısı: ${operations.size}</div>
            """.trimIndent(),
        )
        printHtml(context, title, html)
    }

    private fun printHtml(
        context: Context,
        jobName: String,
        html: String,
        onQueued: (() -> Unit)? = null,
        onError: (String) -> Unit = { message ->
            android.widget.Toast.makeText(context, message, android.widget.Toast.LENGTH_LONG).show()
        },
    ) {
        val webView = WebView(context)
        webView.settings.defaultTextEncodingName = "utf-8"
        webView.webViewClient = object : WebViewClient() {
            private var printStarted = false

            override fun onPageFinished(view: WebView, url: String?) {
                if (printStarted) return
                printStarted = true
                val manager = context.getSystemService(PrintManager::class.java)
                if (manager == null) {
                    onError(context.getString(com.vdgida.vdesgo.sales.R.string.print_error))
                    return
                }
                try {
                    val job = manager.print(
                        jobName,
                        view.createPrintDocumentAdapter(jobName),
                        PrintAttributes.Builder().setMediaSize(PrintAttributes.MediaSize.ISO_A4).build(),
                    )
                    if (onQueued != null) observePrintJob(job, onQueued, onError)
                } catch (error: IllegalStateException) {
                    Log.e("DocumentPrinter", "Print service could not start the document", error)
                    onError(context.getString(com.vdgida.vdesgo.sales.R.string.print_error))
                }
            }
        }
        webView.loadDataWithBaseURL(null, html, "text/html", "UTF-8", null)
    }

    private fun observePrintJob(job: PrintJob, onQueued: () -> Unit, onError: (String) -> Unit) {
        val handler = Handler(Looper.getMainLooper())
        handler.post(object : Runnable {
            private var attempts = 0

            override fun run() {
                when {
                    job.isQueued || job.isStarted || job.isBlocked || job.isCompleted -> onQueued()
                    job.isCancelled -> Unit
                    job.isFailed -> onError("Yazdırma başarısız oldu; belge numarası ilerletilmedi.")
                    ++attempts >= 1800 -> onError("Yazdırma onayı alınamadı; belge numarası ilerletilmedi.")
                    else -> handler.postDelayed(this, 1000)
                }
            }
        })
    }

    private fun page(title: String, subtitle: String, body: String) = """
        <!doctype html><html><head><meta charset="utf-8"><style>
        @page { margin: 14mm; } body { font-family: sans-serif; color: #17352c; font-size: 12px; }
        header { border-bottom: 3px solid #08765a; margin-bottom: 18px; padding-bottom: 10px; }
        h1 { color: #08765a; margin: 0; font-size: 23px; } h2 { margin: 5px 0 0; font-size: 14px; }
        .meta { margin: 5px 0; } table { border-collapse: collapse; width: 100%; margin-top: 18px; }
        th { background: #08765a; color: white; text-align: left; } th, td { border: 1px solid #cadbd4; padding: 8px; }
        tr:nth-child(even) { background: #f1f6f3; } .total { text-align: right; font-weight: bold; font-size: 15px; margin-top: 16px; }
        tr.piece-unit { color: #c62828; }
        </style></head><body><header><h1>$title</h1><h2>$subtitle</h2></header>$body</body></html>
    """.trimIndent()

    private fun escape(value: String): String = value
        .replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
        .replace("\"", "&quot;").replace("'", "&#39;")

    private fun money(value: Double) = String.format(Locale("tr", "TR"), "%,.2f TL", value)
    private fun format(value: Double) = String.format(Locale("tr", "TR"), "%,.2f", value)
}
