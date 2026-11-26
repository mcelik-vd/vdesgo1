package com.vdgida.vdesgo.sales.printer

import android.content.Context

class BluetoothPrinterSettingsStore(context: Context) {
    private val preferences = context.getSharedPreferences("vdesgo_bluetooth_printer", Context.MODE_PRIVATE)

    fun printerAddress(): String = preferences.getString(KEY_ADDRESS, "").orEmpty()
    fun printerName(): String = preferences.getString(KEY_NAME, "").orEmpty()

    fun savePrinter(address: String, name: String) {
        preferences.edit().putString(KEY_ADDRESS, address).putString(KEY_NAME, name).apply()
    }

    fun companyTitle(): String = preferences.getString(KEY_COMPANY_TITLE, "").orEmpty()
    fun companyAddress(): String = preferences.getString(KEY_COMPANY_ADDRESS, "").orEmpty()
    fun companyPhone(): String = preferences.getString(KEY_COMPANY_PHONE, "").orEmpty()
    fun companyTaxOffice(): String = preferences.getString(KEY_COMPANY_TAX_OFFICE, "").orEmpty()
    fun companyTaxNo(): String = preferences.getString(KEY_COMPANY_TAX_NO, "").orEmpty()
    fun companyTckn(): String = preferences.getString(KEY_COMPANY_TCKN, "").orEmpty()

    fun saveCompany(
        title: String,
        address: String,
        phone: String,
        taxOffice: String,
        taxNo: String,
        tckn: String,
    ) {
        preferences.edit()
            .putString(KEY_COMPANY_TITLE, title.trim())
            .putString(KEY_COMPANY_ADDRESS, address.trim())
            .putString(KEY_COMPANY_PHONE, phone.trim())
            .putString(KEY_COMPANY_TAX_OFFICE, taxOffice.trim())
            .putString(KEY_COMPANY_TAX_NO, taxNo.trim())
            .putString(KEY_COMPANY_TCKN, tckn.trim())
            .apply()
    }

    companion object {
        private const val KEY_ADDRESS = "printer_address"
        private const val KEY_NAME = "printer_name"
        private const val KEY_COMPANY_TITLE = "company_title"
        private const val KEY_COMPANY_ADDRESS = "company_address"
        private const val KEY_COMPANY_PHONE = "company_phone"
        private const val KEY_COMPANY_TAX_OFFICE = "company_tax_office"
        private const val KEY_COMPANY_TAX_NO = "company_tax_no"
        private const val KEY_COMPANY_TCKN = "company_tckn"
    }
}
