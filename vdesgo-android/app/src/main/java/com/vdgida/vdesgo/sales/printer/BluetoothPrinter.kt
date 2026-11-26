package com.vdgida.vdesgo.sales.printer

import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothSocket
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.content.ContextCompat
import java.io.OutputStream
import java.util.UUID

class BluetoothPrinter(private val context: Context) {
    companion object {
        private val SPP_UUID: UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB")
    }

    fun isConfigured(): Boolean = BluetoothPrinterSettingsStore(context).printerAddress().isNotBlank()

    fun pairedDevices(): List<Pair<String, String>> {
        if (!hasConnectPermission()) return emptyList()
        val bluetooth = context.getSystemService(BluetoothManager::class.java)?.adapter ?: return emptyList()
        if (!bluetooth.isEnabled) return emptyList()
        return bluetooth.bondedDevices.map { it.address to it.name.orEmpty() }.sortedBy { it.second }
    }

    fun printReceipt(receipt: ThermalReceipt): Result<Unit> {
        if (!hasConnectPermission()) {
            return Result.failure(IllegalStateException("Bluetooth bağlantı izni verilmemiş."))
        }
        val settings = BluetoothPrinterSettingsStore(context)
        val address = settings.printerAddress()
        if (address.isBlank()) {
            return Result.failure(IllegalStateException("Bluetooth yazıcı seçilmemiş."))
        }
        val bluetooth = context.getSystemService(BluetoothManager::class.java)?.adapter
            ?: return Result.failure(IllegalStateException("Bluetooth bulunamadı."))
        if (!bluetooth.isEnabled) {
            return Result.failure(IllegalStateException("Bluetooth açık değil."))
        }
        val device = bluetooth.bondedDevices.firstOrNull { it.address.equals(address, ignoreCase = true) }
            ?: return Result.failure(IllegalStateException("Yazıcı eşleşmiş cihazlarda bulunamadı."))

        var socket: BluetoothSocket? = null
        var output: OutputStream? = null
        return try {
            socket = device.createRfcommSocketToServiceRecord(SPP_UUID)
            socket.connect()
            output = socket.outputStream
            val data = buildEscPosReceipt(receipt, settings)
            output.write(data)
            output.flush()
            Result.success(Unit)
        } catch (error: Exception) {
            Result.failure(error)
        } finally {
            try {
                output?.close()
            } catch (_: Exception) {}
            try {
                socket?.close()
            } catch (_: Exception) {}
        }
    }

    private fun hasConnectPermission(): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return true
        return ContextCompat.checkSelfPermission(context, android.Manifest.permission.BLUETOOTH_CONNECT) ==
            PackageManager.PERMISSION_GRANTED
    }

    private fun buildEscPosReceipt(receipt: ThermalReceipt, settings: BluetoothPrinterSettingsStore): ByteArray {
        val bytes = ArrayList<Byte>()
        fun add(vararg values: Int) {
            values.forEach { bytes.add(it.toByte()) }
        }
        fun text(value: String) {
            value.map(Char::code).forEach { code ->
                val mapped = when (code) {
                    0x00E7 -> 0x63
                    0x011E -> 0x47
                    0x011F -> 0x67
                    0x0130 -> 0x49
                    0x0131 -> 0x69
                    0x00D6 -> 0x4F
                    0x00F6 -> 0x6F
                    0x015E -> 0x53
                    0x015F -> 0x73
                    0x00DC -> 0x55
                    0x00FC -> 0x75
                    else -> if (code <= 0x7F) code else 63
                }
                bytes.add(mapped.toByte())
            }
        }
        fun line(value: String = "") {
            text(asciiPrintable(value))
            add(0x0A)
        }

        add(0x1B, 0x40)
        add(0x1B, 0x61, 0x01)
        add(0x1B, 0x21, 0x30)
        line(settings.companyTitle().ifBlank { "VD GIDA" })
        add(0x1B, 0x21, 0x00)
        add(0x1B, 0x61, 0x00)
        line(settings.companyAddress())
        line(settings.companyPhone().takeIf(String::isNotBlank)?.let { "Tel: $it" }.orEmpty())
        line(settings.companyTaxOffice().takeIf(String::isNotBlank)?.let { "VD: $it" }.orEmpty())
        line(settings.companyTaxNo().takeIf(String::isNotBlank)?.let { "VKN: $it" }.orEmpty())
        line(settings.companyTckn().takeIf(String::isNotBlank)?.let { "TCKN: $it" }.orEmpty())
        line("--------------------------------")
        add(0x1B, 0x61, 0x01)
        line("SATIS FATURASI")
        add(0x1B, 0x61, 0x00)
        line("Fatura No: ${receipt.invoiceNumber}")
        line("Tarih: ${receipt.date}")
        line("Musteri: ${receipt.customerName}")
        line("Cari Kodu: ${receipt.customerCode}")
        line("Temsilci: ${receipt.representativeName}")
        line("--------------------------------")
        receipt.lines.forEach { lineItem ->
            line("${lineItem.productName.take(28)}")
            val left = "${formatQuantity(lineItem.quantity)} ${lineItem.unitCode}"
            val right = lineItem.lineTotal
            line(padLeftRight(left, right, 48))
        }
        line("--------------------------------")
        line(padLeftRight("GENEL TOPLAM", receipt.total, 48))
        line("")
        add(0x1B, 0x61, 0x01)
        line("Teslim Eden")
        line("")
        line("")
        add(0x1B, 0x61, 0x00)
        line("Teslim Alan")
        add(0x1D, 0x56, 0x42, 0x03)
        val data = ByteArray(bytes.size)
        for (index in bytes.indices) data[index] = bytes[index]
        return data
    }

    private fun asciiPrintable(value: String): String {
        val result = StringBuilder()
        value.forEach { char ->
            result.append(
                when (char) {
                    'Ç' -> 'C'
                    'ç' -> 'c'
                    'Ğ' -> 'G'
                    'ğ' -> 'g'
                    'İ' -> 'I'
                    'ı' -> 'i'
                    'Ö' -> 'O'
                    'ö' -> 'o'
                    'Ş' -> 'S'
                    'ş' -> 's'
                    'Ü' -> 'U'
                    'ü' -> 'u'
                    else -> if (char.code in 32..126) char else '?'
                },
            )
        }
        return result.toString()
    }

    private fun padLeftRight(left: String, right: String, width: Int): String {
        val leftText = asciiPrintable(left).take(width)
        val rightText = asciiPrintable(right)
        val spaces = (width - leftText.length - rightText.length).coerceAtLeast(1)
        return leftText + " ".repeat(spaces) + rightText
    }

    private fun formatQuantity(value: Double): String =
        if (value % 1.0 == 0.0) value.toInt().toString() else String.format(java.util.Locale.US, "%.3f", value).trimEnd('0').trimEnd('.')
}

