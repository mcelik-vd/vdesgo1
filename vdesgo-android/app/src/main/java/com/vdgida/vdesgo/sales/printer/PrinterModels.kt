package com.vdgida.vdesgo.sales.printer

data class ThermalReceipt(
    val invoiceNumber: String,
    val date: String,
    val customerName: String,
    val customerCode: String,
    val customerTitle: String = "",
    val customerAddress: String = "",
    val customerPhone: String = "",
    val customerTaxOffice: String = "",
    val customerTaxNo: String = "",
    val customerTckn: String = "",
    val representativeName: String,
    val lines: List<ThermalReceiptLine>,
    val subtotal: String = "",
    val discountTotal: String = "",
    val vatTotal: String = "",
    val total: String,
)

data class ThermalReceiptLine(
    val productName: String,
    val quantity: Double,
    val unitCode: String,
    val unitPrice: String = "",
    val lineTotal: String,
)
