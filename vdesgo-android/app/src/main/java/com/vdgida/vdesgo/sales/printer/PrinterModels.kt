package com.vdgida.vdesgo.sales.printer

data class ThermalReceipt(
    val invoiceNumber: String,
    val date: String,
    val customerName: String,
    val customerCode: String,
    val representativeName: String,
    val lines: List<ThermalReceiptLine>,
    val total: String,
)

data class ThermalReceiptLine(
    val productName: String,
    val quantity: Double,
    val unitCode: String,
    val lineTotal: String,
)
