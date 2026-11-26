package com.vdgida.vdesgo.sales.ui

import android.Manifest
import android.os.Build
import android.content.Intent
import android.provider.Settings
import android.content.pm.PackageManager
import android.graphics.BitmapFactory
import android.util.Base64
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGesturesAfterLongPress
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.ArrowDropDown
import androidx.compose.material.icons.filled.CalendarToday
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.CloudOff
import androidx.compose.material.icons.filled.Inventory2
import androidx.compose.material.icons.filled.LocationOn
import androidx.compose.material.icons.filled.MoreHoriz
import androidx.compose.material.icons.filled.People
import androidx.compose.material.icons.filled.PointOfSale
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.ShoppingCart
import androidx.compose.material.icons.filled.Sync
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material.icons.filled.CloudDownload
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Checkbox
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.SwipeToDismissBox
import androidx.compose.material3.SwipeToDismissBoxValue
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.rememberSwipeToDismissBoxState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.compose.ui.platform.testTag
import com.vdgida.vdesgo.sales.BuildConfig
import com.vdgida.vdesgo.sales.R
import com.vdgida.vdesgo.sales.data.OperationUiState
import com.vdgida.vdesgo.sales.data.CreditLimitRules
import com.vdgida.vdesgo.sales.data.CustomerIdentityRules
import com.vdgida.vdesgo.sales.data.CustomerModificationRules
import com.vdgida.vdesgo.sales.data.HotSaleStockCheck
import com.vdgida.vdesgo.sales.data.HotSaleStockRules
import com.vdgida.vdesgo.sales.data.CustomerCreateRequest
import com.vdgida.vdesgo.sales.data.LocationReading
import com.vdgida.vdesgo.sales.data.repository.CustomerSummary
import com.vdgida.vdesgo.sales.data.repository.DraftLineSummary
import com.vdgida.vdesgo.sales.data.repository.DraftSummary
import com.vdgida.vdesgo.sales.data.repository.MobileRepository
import com.vdgida.vdesgo.sales.data.repository.OperationSummary
import com.vdgida.vdesgo.sales.data.repository.ProductSummary
import com.vdgida.vdesgo.sales.data.repository.UnitPriceSummary
import com.vdgida.vdesgo.sales.printer.BluetoothPrinter
import com.vdgida.vdesgo.sales.printer.BluetoothPrinterSettingsStore
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlinx.coroutines.delay
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull

private val mobileOrderBlue = Color(0xFF1769AA)
private val pieceWarningRed = Color(0xFFC62828)

@Composable
private fun PieceUnitWarning() {
    val transition = rememberInfiniteTransition(label = "piece-unit-warning")
    val alpha by transition.animateFloat(
        initialValue = 1f,
        targetValue = 0.25f,
        animationSpec = infiniteRepeatable(tween(700), RepeatMode.Reverse),
        label = "piece-unit-warning-alpha",
    )
    Icon(
        Icons.Default.Warning,
        contentDescription = stringResource(R.string.piece_unit_warning),
        tint = pieceWarningRed.copy(alpha = alpha),
    )
}

private data class UnverifiedVisitPrompt(
    val location: LocationReading?,
    val reason: String,
    val detail: String,
)

@Composable
private fun MobileOrderTheme(content: @Composable () -> Unit) {
    val colors = MaterialTheme.colorScheme
    MaterialTheme(
        colorScheme = colors.copy(
            primary = mobileOrderBlue,
            onPrimary = Color.White,
            primaryContainer = Color(0xFFD8EAFE),
            onPrimaryContainer = Color(0xFF123B5D),
            background = Color(0xFFF3F8FC),
            secondary = Color(0xFF347DB7),
            onSecondary = Color.White,
            secondaryContainer = Color(0xFFE4F1FC),
            onSecondaryContainer = Color(0xFF163B59),
            tertiary = Color(0xFF3E76A2),
            onTertiary = Color.White,
            tertiaryContainer = Color(0xFFDCEBFA),
            onTertiaryContainer = Color(0xFF183B59),
            surfaceVariant = Color(0xFFEDF5FC),
            onSurfaceVariant = Color(0xFF526B80),
            surfaceDim = Color(0xFFDDE8F0),
            surfaceBright = Color.White,
            surfaceContainerLowest = Color.White,
            surfaceContainerLow = Color(0xFFF7FAFD),
            surfaceContainer = Color(0xFFF2F7FB),
            surfaceContainerHigh = Color(0xFFEAF2F8),
            surfaceContainerHighest = Color(0xFFE2EDF5),
            outline = Color(0xFF8EA9BE),
            outlineVariant = Color(0xFFD3E1ED),
        ),
        content = content,
    )
}

@Composable
@OptIn(ExperimentalMaterial3Api::class)
fun DailyDataScreen(
    state: MobileUiState,
    onLoad: (Double) -> Unit,
    onClose: (Double, Double?) -> Unit,
    onLogout: () -> Unit,
) {
    var odometerDialogVisible by rememberSaveable { mutableStateOf(false) }
    var openingOdometer by rememberSaveable { mutableStateOf("") }
    var closingDialogVisible by rememberSaveable { mutableStateOf(false) }
    var previousDayOpeningOdometer by rememberSaveable(state.workday?.id) {
        mutableStateOf(state.workday?.openingOdometerKm?.toString().orEmpty())
    }
    var previousDayOpeningConfirmed by rememberSaveable(state.workday?.id) {
        mutableStateOf(state.workday?.openingOdometerKm != null)
    }
    var closingOdometer by rememberSaveable { mutableStateOf("") }
    val openingOrLoading = state.loading || state.dailyLoading
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Günlük bilgileri") },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.background,
                    titleContentColor = MaterialTheme.colorScheme.onBackground,
                ),
            )
        },
    ) { padding ->
        Box(
            Modifier.fillMaxSize().padding(padding).padding(24.dp),
            contentAlignment = Alignment.Center,
        ) {
            Card(
                shape = RoundedCornerShape(24.dp),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                elevation = CardDefaults.cardElevation(defaultElevation = 4.dp),
            ) {
                Column(
                    Modifier.fillMaxWidth().padding(24.dp),
                    verticalArrangement = Arrangement.spacedBy(16.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Icon(
                        Icons.Default.CloudDownload,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.primary,
                        modifier = Modifier.size(44.dp),
                    )
                    Text(
                        when {
                            state.workdayNeedsClosing && state.workday?.currentDaySessionOpen == true ->
                                "Önceki günün kapanışını tamamlayın"
                            state.workdayNeedsClosing -> "Bugünün açılışını yapın"
                            state.workday?.status == "closed" -> "Gün içinde yeniden açılış yapın"
                            else -> "Bugünün bilgilerini indirin"
                        },
                        style = MaterialTheme.typography.titleLarge,
                        fontWeight = FontWeight.Bold,
                    )
                    Text(
                        if (state.workdayNeedsClosing) {
                            if (state.workday?.currentDaySessionOpen == true) {
                                "${state.workday?.businessDate.orEmpty()} tarihli günün kapanışı bekliyor. Bugünkü işlemlerinizi tamamladınız; şimdi önceki günün kapanışını yapabilirsiniz."
                            } else {
                                "${state.workday?.businessDate.orEmpty()} tarihli günün kapanışı bekliyor. Bugünün açılışını yapıp rutunuza devam edebilirsiniz; önceki günün kapanışını bugünkü işlemlerinizden sonra yapabilirsiniz."
                            }
                        } else if (state.workday?.status == "closed") {
                            "Bugünkü oturum kapatılmış. Sonradan satış yapabilmek veya yanlış kapanışı telafi etmek için yeni kilometre ve günlük bilgilerle tekrar açılış yapabilirsiniz."
                        } else {
                            "Bugünkü rut müşterileri, müşteri iskontoları ve ürün fiyatları günlük olarak cihaza alınır. Rut müşterilerinin satışlarında bu bilgiler çevrimdışı önbellekten kullanılır."
                        },
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    state.error?.let { InlineError(it) }
                    state.dailyInfoMessage?.let {
                        Text(it, color = MaterialTheme.colorScheme.primary)
                    }
                    Button(
                        onClick = {
                            if (state.workdayNeedsClosing &&
                                state.workday?.currentDaySessionOpen != true
                            ) {
                                odometerDialogVisible = true
                            } else if (state.workdayNeedsClosing) {
                                previousDayOpeningOdometer =
                                    state.workday?.openingOdometerKm?.toString()
                                        ?: state.workday?.suggestedOpeningOdometerKm?.toString().orEmpty()
                                previousDayOpeningConfirmed =
                                    state.workday?.openingOdometerKm != null ||
                                        state.workday?.suggestedOpeningOdometerKm != null
                                closingOdometer = ""
                                closingDialogVisible = true
                            } else {
                                odometerDialogVisible = true
                            }
                        },
                        enabled = !openingOrLoading,
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        if (openingOrLoading) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(18.dp),
                                strokeWidth = 2.dp,
                            )
                            Spacer(Modifier.width(10.dp))
                            Text(if (state.dailyLoading) "Günlük bilgiler alınıyor…" else "Gün açılıyor…")
                        } else {
                            Text(
                                when {
                                    state.workdayNeedsClosing &&
                                        state.workday?.currentDaySessionOpen == true ->
                                        "Önceki günün kapanışını yap"
                                    state.workdayNeedsClosing -> "Bugünün açılışını yap ve rutuma devam et"
                                    state.workday?.status == "closed" -> "Yeni kilometreyi gir ve gün içinde tekrar aç"
                                    else -> "Kilometreyi gir ve günlük bilgileri al"
                                },
                            )
                        }
                    }
                    TextButton(onClick = onLogout) { Text(stringResource(R.string.logout)) }
                }
            }
            if (odometerDialogVisible) {
                AlertDialog(
                    onDismissRequest = { if (!openingOrLoading) odometerDialogVisible = false },
                    title = { Text("Güne başlama kilometresi") },
                    text = {
                        OutlinedTextField(
                            value = openingOdometer,
                            onValueChange = { openingOdometer = it.filter { char -> char.isDigit() || char == ',' || char == '.' } },
                            label = { Text("Araç kilometresi") },
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                            singleLine = true,
                        )
                    },
                    confirmButton = {
                        Button(
                            onClick = {
                                odometerDialogVisible = false
                                onLoad(openingOdometer.replace(',', '.').toDouble())
                            },
                            enabled = !openingOrLoading &&
                                openingOdometer.replace(',', '.').toDoubleOrNull()?.let { it >= 0 } == true,
                        ) { Text("Günü aç ve bilgileri al") }
                    },
                    dismissButton = {
                        TextButton(
                            onClick = { odometerDialogVisible = false },
                            enabled = !openingOrLoading,
                        ) { Text("Vazgeç") }
                    },
                )
            }
            if (closingDialogVisible) {
                val recordedOpeningOdometer = state.workday?.openingOdometerKm
                val openingKm = recordedOpeningOdometer
                    ?: previousDayOpeningOdometer.replace(',', '.').toDoubleOrNull()
                val needsOpeningOdometer = recordedOpeningOdometer == null &&
                    !previousDayOpeningConfirmed
                val closingKm = closingOdometer.replace(',', '.').toDoubleOrNull()
                AlertDialog(
                    onDismissRequest = { if (!openingOrLoading) closingDialogVisible = false },
                    title = {
                        Text(
                            if (needsOpeningOdometer) {
                                "Önceki gün başlangıç kilometresi"
                            } else {
                                "Önceki gün kapanış kilometresi"
                            },
                        )
                    },
                    text = {
                        if (needsOpeningOdometer) {
                            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                Text("Bu güne ait başlangıç kilometresi kayıtlı değil. Önce günün başlangıç kilometresini girin.")
                                OutlinedTextField(
                                    value = previousDayOpeningOdometer,
                                    onValueChange = {
                                        previousDayOpeningOdometer = it.filter { char ->
                                            char.isDigit() || char == ',' || char == '.'
                                        }
                                    },
                                    label = { Text("Önceki gün başlangıç kilometresi") },
                                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                                    singleLine = true,
                                )
                            }
                        } else {
                            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                Text("Başlangıç kilometresi: $openingKm km")
                                OutlinedTextField(
                                    value = closingOdometer,
                                    onValueChange = {
                                        closingOdometer = it.filter { char ->
                                            char.isDigit() || char == ',' || char == '.'
                                        }
                                    },
                                    label = { Text("Araç kapanış kilometresi") },
                                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                                    singleLine = true,
                                )
                            }
                        }
                    },
                    confirmButton = {
                        if (needsOpeningOdometer) {
                            Button(
                                onClick = { previousDayOpeningConfirmed = true },
                                enabled = !openingOrLoading && openingKm != null && openingKm >= 0,
                            ) { Text("Devam Et") }
                        } else {
                            Button(
                                onClick = {
                                    closingDialogVisible = false
                                    onClose(closingKm!!, openingKm)
                                },
                                enabled = !openingOrLoading &&
                                    openingKm != null &&
                                    closingKm != null &&
                                    closingKm >= openingKm,
                            ) { Text("Günü kapat") }
                        }
                    },
                    dismissButton = {
                        TextButton(
                            onClick = { closingDialogVisible = false },
                            enabled = !openingOrLoading,
                        ) { Text("Vazgeç") }
                    },
                )
            }
        }
    }
}

@Composable
fun LoginScreen(state: MobileUiState, onLogin: (String, String) -> Unit) {
    var username by rememberSaveable { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    Box(
        Modifier.fillMaxSize()
            .background(
                Brush.linearGradient(
                    listOf(
                        MaterialTheme.colorScheme.primary,
                        MaterialTheme.colorScheme.primaryContainer,
                        MaterialTheme.colorScheme.background,
                    ),
                ),
            )
            .padding(24.dp),
        contentAlignment = Alignment.Center,
    ) {
        Card(
            shape = RoundedCornerShape(28.dp),
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
            elevation = CardDefaults.cardElevation(defaultElevation = 8.dp),
        ) {
            Column(
                Modifier.fillMaxWidth().padding(24.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                Surface(
                    modifier = Modifier.size(64.dp),
                ) {
                    Image(
                        painter = painterResource(R.drawable.vdgida_logo),
                        contentDescription = "VD GIDA",
                        contentScale = ContentScale.Fit,
                        modifier = Modifier.fillMaxSize(),
                    )
                }
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(stringResource(R.string.app_name), style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
                    Text(stringResource(R.string.login_title), color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                OutlinedTextField(
                    value = username,
                    onValueChange = { username = it },
                    label = { Text(stringResource(R.string.username)) },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = password,
                    onValueChange = { password = it.filter(Char::isDigit) },
                    label = { Text(stringResource(R.string.password)) },
                    visualTransformation = PasswordVisualTransformation(),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                state.error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
                Button(
                    onClick = { onLogin(username, password); password = "" },
                    enabled = !state.loading && username.isNotBlank() && password.isNotBlank(),
                    modifier = Modifier.fillMaxWidth().height(52.dp),
                ) {
                    if (state.loading) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
                    else Text(stringResource(R.string.sign_in))
                }
                if (BuildConfig.DEBUG && BuildConfig.DEBUG_MOCK_MODE) {
                    OutlinedButton(
                        onClick = { onLogin("debug-demo", "debug-only") },
                        enabled = !state.loading,
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Text(stringResource(R.string.demo_screens))
                    }
                }
            }
        }
    }
}

@Composable
fun PendingDeviceScreen(onRetry: () -> Unit, onLogout: () -> Unit) {
    Box(
        Modifier.fillMaxSize().padding(24.dp),
        contentAlignment = Alignment.Center,
    ) {
        Card(
            shape = RoundedCornerShape(24.dp),
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
            elevation = CardDefaults.cardElevation(defaultElevation = 4.dp),
        ) {
            Column(
                Modifier.padding(24.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Icon(Icons.Default.Warning, contentDescription = null, tint = MaterialTheme.colorScheme.secondary, modifier = Modifier.size(42.dp))
                Text(stringResource(R.string.device_pending), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                Text(stringResource(R.string.device_pending_detail))
                Text(stringResource(R.string.device_pending_retry), color = MaterialTheme.colorScheme.onSurfaceVariant)
                Button(onClick = onRetry, modifier = Modifier.fillMaxWidth()) {
                    Text(stringResource(R.string.retry))
                }
                TextButton(onClick = onLogout) { Text(stringResource(R.string.logout)) }
            }
        }
    }
}

private enum class MainTab(val titleResource: Int) {
    TODAY(R.string.today),
    CUSTOMERS(R.string.customers),
    SALES(R.string.sales),
    MAP(R.string.map),
    MORE(R.string.more),
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeScreen(
    state: MobileUiState,
    viewModel: AppViewModel,
    showSalesInitially: Boolean = false,
    onWorkday: () -> Unit,
    onCustomer: (CustomerSummary) -> Unit,
    onOrder: (CustomerSummary) -> Unit,
    onOpenDraft: (String) -> Unit,
    onEditSale: (String, String) -> Unit,
    onHotSale: (CustomerSummary) -> Unit,
    onCollection: (CustomerSummary) -> Unit,
) {
    var tab by rememberSaveable(showSalesInitially) {
        mutableStateOf(if (showSalesInitially) MainTab.SALES else MainTab.TODAY)
    }
    val title = stringResource(tab.titleResource)
    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Image(
                            painter = painterResource(R.drawable.vdgida_logo),
                            contentDescription = "VD GIDA",
                            contentScale = ContentScale.Fit,
                            modifier = Modifier.size(38.dp),
                        )
                        Column {
                            Text(title, fontWeight = FontWeight.Bold)
                            Text(
                                text = when (state.serverReachable) {
                                    true -> stringResource(R.string.online)
                                    false -> stringResource(R.string.server_unavailable)
                                    null -> stringResource(R.string.connection_checking)
                                },
                                style = MaterialTheme.typography.labelSmall,
                                color = if (state.serverReachable == true) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                },
                actions = {
                    IconButton(onClick = viewModel::refresh) {
                        Icon(Icons.Default.Refresh, contentDescription = stringResource(R.string.refresh))
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.background,
                    titleContentColor = MaterialTheme.colorScheme.onBackground,
                    navigationIconContentColor = MaterialTheme.colorScheme.primary,
                    actionIconContentColor = MaterialTheme.colorScheme.primary,
                ),
            )
        },
        bottomBar = {
            NavigationBar(
                modifier = Modifier.windowInsetsPadding(WindowInsets.navigationBars),
                containerColor = MaterialTheme.colorScheme.surface,
                tonalElevation = 5.dp,
            ) {
                MainTab.entries.forEach { item ->
                    NavigationBarItem(
                        selected = tab == item,
                        onClick = { tab = item },
                        icon = {
                            Icon(
                                when (item) {
                                    MainTab.TODAY -> Icons.Default.CalendarToday
                                    MainTab.CUSTOMERS -> Icons.Default.People
                                    MainTab.SALES -> Icons.Default.PointOfSale
                                    MainTab.MAP -> Icons.Default.LocationOn
                                    MainTab.MORE -> Icons.Default.MoreHoriz
                                },
                                contentDescription = null,
                            )
                        },
                        label = { Text(stringResource(item.titleResource)) },
                    )
                }
            }
        },
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding)) {
            state.error?.let { InlineError(it) }
            when (tab) {
                MainTab.TODAY -> TodayContent(
                    state,
                    viewModel,
                    onCustomer,
                )
                MainTab.CUSTOMERS -> CustomerListContent(
                    state,
                    viewModel,
                    onCustomer,
                    canCreateCustomer = "mobile.order.create" in state.session?.capabilities.orEmpty(),
                )
                MainTab.SALES -> SalesContent(state, viewModel, onOpenDraft, onEditSale)
                MainTab.MAP -> MapContent(state)
                MainTab.MORE -> MoreContent(state, viewModel, onWorkday)
            }
        }
    }
}

@Composable
private fun TodayContent(
    state: MobileUiState,
    viewModel: AppViewModel,
    onCustomer: (CustomerSummary) -> Unit,
) {
    var search by rememberSaveable { mutableStateOf("") }
    var sortMode by rememberSaveable { mutableStateOf("visit") }
    var sortMenuExpanded by remember { mutableStateOf(false) }
    var stockVisible by rememberSaveable { mutableStateOf(false) }
    var selectedStockUnits by rememberSaveable { mutableStateOf(emptyMap<String, String>()) }
    val complete = state.route.count { it.visitState == "complete" }
    val remaining = (state.route.size - complete).coerceAtLeast(0)
    val routeCodes = state.route.map { it.code }
    val visitOrder = state.routeOrder.takeIf { it.size == routeCodes.size && it.toSet() == routeCodes.toSet() } ?: routeCodes
    val orderedRoute = remember(state.route, state.routeOrder) {
        state.route.sortedBy { visitOrder.indexOf(it.code).let { index -> if (index < 0) Int.MAX_VALUE else index } }
    }
    val visibleRoute = orderedRoute.filter { customer ->
        listOf(customer.name, customer.code, customer.district.orEmpty(), customer.province.orEmpty())
            .any { it.contains(search.trim(), ignoreCase = true) }
    }.let { filtered ->
        when (sortMode) {
            "az" -> filtered.sortedBy { it.name.lowercase() }
            "za" -> filtered.sortedByDescending { it.name.lowercase() }
            else -> filtered
        }
    }
    val stock = state.vehicleStock
    val dragThresholdPx = with(androidx.compose.ui.platform.LocalDensity.current) { 72.dp.toPx() }
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            Card(
                shape = RoundedCornerShape(24.dp),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primary),
            ) {
                Row(
                    Modifier.fillMaxWidth().padding(20.dp),
                    horizontalArrangement = Arrangement.spacedBy(14.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Surface(
                        shape = RoundedCornerShape(18.dp),
                        color = Color.White.copy(alpha = 0.16f),
                        modifier = Modifier.size(52.dp),
                    ) {
                        Box(contentAlignment = Alignment.Center) {
                            Icon(Icons.Default.People, contentDescription = null, tint = Color.White, modifier = Modifier.size(26.dp))
                        }
                    }
                    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text("SAHA SATIŞ", style = MaterialTheme.typography.labelMedium, color = Color.White.copy(alpha = 0.8f), fontWeight = FontWeight.Bold)
                        Text(state.session?.representativeName.orEmpty(), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, color = Color.White)
                        Text(todayDate(), style = MaterialTheme.typography.bodyMedium, color = Color.White.copy(alpha = 0.86f))
                    }
                }
            }
        }
        item {
            OutlinedButton(
                onClick = {
                    stockVisible = !stockVisible
                    if (stockVisible) viewModel.loadVehicleStock()
                },
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text(if (stockVisible) "Bugünün müşterileri" else "Araç stokunu göster")
            }
        }
        if (stockVisible) {
            if (state.vehicleStockLoading) item {
                Row(
                    Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.Center,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
                    Spacer(Modifier.width(8.dp))
                    Text("Güncel araç stoğu alınıyor…")
                }
            }
            state.vehicleStockError?.let { error ->
                item { InlineError(error) }
            }
            if (!state.vehicleStockLoading && state.vehicleStockError == null && stock.isEmpty()) {
                item { EmptyMessage("Güncel araç stok bilgisi bulunamadı.") }
            }
            items(stock, key = { it["productCode"]?.jsonPrimitive?.contentOrNull.orEmpty() }) { product ->
                val code = product["productCode"]?.jsonPrimitive?.contentOrNull.orEmpty()
                val baseUnit = product["unit"]?.jsonPrimitive?.contentOrNull.orEmpty()
                val baseQuantity = product["quantity"]?.jsonPrimitive?.doubleOrNull
                val unitOptions = product["units"]?.jsonArray.orEmpty()
                    .mapNotNull { unitElement ->
                        val unitObject = unitElement.jsonObject
                        val unit = unitObject["unit"]?.jsonPrimitive?.contentOrNull.orEmpty()
                        val innerQuantity = unitObject["innerQuantity"]?.jsonPrimitive?.contentOrNull
                            ?.replace(',', '.')?.toDoubleOrNull()
                        if (unit.isBlank()) null
                        else (unit to (innerQuantity?.takeIf { it.isFinite() && it > 0.0 } ?: 1.0))
                    }
                    .ifEmpty { listOf(baseUnit to 1.0) }
                val defaultUnit = if (baseQuantity == null) baseUnit else {
                    unitOptions.maxByOrNull { baseQuantity / it.second }?.first ?: baseUnit
                }
                var unitMenuExpanded by remember(code) { mutableStateOf(false) }
                val selectedUnit = selectedStockUnits[code]
                val activeUnit = unitOptions.firstOrNull { it.first == selectedUnit }
                    ?: unitOptions.firstOrNull { it.first == defaultUnit }
                    ?: unitOptions.first()
                val displayedQuantity = baseQuantity?.div(activeUnit.second)
                val displayedQuantityText = displayedQuantity?.let(::quantityLabel) ?: "—"
                Card {
                    Column(Modifier.fillMaxWidth().padding(14.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                        Text(product["productName"]?.jsonPrimitive?.contentOrNull.orEmpty(), fontWeight = FontWeight.Bold)
                        Text(code, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Row(
                            Modifier.fillMaxWidth(),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            Text(
                                "Stok: $displayedQuantityText",
                                fontWeight = FontWeight.SemiBold,
                            )
                            Box {
                                OutlinedButton(onClick = { unitMenuExpanded = true }) {
                                    Text(activeUnit.first)
                                    Icon(Icons.Default.ArrowDropDown, contentDescription = "Birim seç")
                                }
                                DropdownMenu(
                                    expanded = unitMenuExpanded,
                                    onDismissRequest = { unitMenuExpanded = false },
                                ) {
                                    unitOptions.forEach { (unit, _) ->
                                        DropdownMenuItem(
                                            text = { Text(unit) },
                                            onClick = {
                                                selectedStockUnits = selectedStockUnits + (code to unit)
                                                unitMenuExpanded = false
                                            },
                                        )
                                    }
                                }
                            }
                        }
                    }
                }
            }
        } else {
        item {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                MetricCard(stringResource(R.string.today_customers), state.route.size.toString(), Modifier.weight(1f))
                MetricCard(stringResource(R.string.completed_visits), complete.toString(), Modifier.weight(1f))
                MetricCard(stringResource(R.string.remaining_visits), remaining.toString(), Modifier.weight(1f))
            }
        }
        item { MetricCard(stringResource(R.string.waiting_operations), state.pendingCount.toString(), Modifier.fillMaxWidth()) }
        item {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(stringResource(R.string.today_customers), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
                Box {
                    OutlinedButton(onClick = { sortMenuExpanded = true }) {
                        Text(when (sortMode) { "az" -> "A–Z"; "za" -> "Z–A"; else -> "Ziyaret sırası" })
                    }
                    DropdownMenu(expanded = sortMenuExpanded, onDismissRequest = { sortMenuExpanded = false }) {
                        listOf("visit" to "Ziyaret sırası", "az" to "A–Z", "za" to "Z–A").forEach { (mode, label) ->
                            DropdownMenuItem(text = { Text(label) }, onClick = {
                                sortMode = mode
                                sortMenuExpanded = false
                            })
                        }
                    }
                }
            }
        }
        item {
            OutlinedTextField(
                value = search,
                onValueChange = { search = it },
                label = { Text("Müşteri ara") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
        }
        if (state.route.isEmpty()) {
            item { EmptyMessage(stringResource(R.string.no_route)) }
        } else if (visibleRoute.isEmpty()) {
            item { EmptyMessage("Arama için müşteri bulunamadı.") }
        } else {
            items(visibleRoute, key = { it.code }) { customer ->
                CustomerCard(
                    customer = customer,
                    onClick = { onCustomer(customer) },
                    onStart = null,
                    onFinish = null,
                    showCustomerDetails = true,
                    modifier = Modifier.pointerInput(customer.code, visitOrder, visibleRoute, sortMode, search) {
                        var accumulated = 0f
                        detectDragGesturesAfterLongPress(
                            onDragStart = { accumulated = 0f },
                            onDragEnd = { accumulated = 0f },
                        ) { change, dragAmount ->
                            accumulated += dragAmount.y
                            val dragOrder = if (sortMode == "visit") visitOrder else visibleRoute.map { it.code }
                            if (search.isBlank() && accumulated > dragThresholdPx) {
                                val index = dragOrder.indexOf(customer.code)
                                if (index in 0 until dragOrder.lastIndex) {
                                    viewModel.updateRouteOrder(dragOrder.toMutableList().apply { add(index + 1, removeAt(index)) })
                                    sortMode = "visit"
                                    accumulated -= dragThresholdPx
                                }
                            } else if (search.isBlank() && accumulated < -dragThresholdPx) {
                                val index = dragOrder.indexOf(customer.code)
                                if (index > 0) {
                                    viewModel.updateRouteOrder(dragOrder.toMutableList().apply { add(index - 1, removeAt(index)) })
                                    sortMode = "visit"
                                    accumulated += dragThresholdPx
                                }
                            }
                            change.consume()
                        }
                    },
                )
            }
        }
        if (state.refreshing) item { LoadingRow() }
        }
    }
}

@Composable
private fun CustomerListContent(
    state: MobileUiState,
    viewModel: AppViewModel,
    onCustomer: (CustomerSummary) -> Unit,
    canCreateCustomer: Boolean,
) {
    val filtered = remember(state.customers, state.search) {
        state.customers.filter {
            it.name.contains(state.search, ignoreCase = true) ||
                it.title?.contains(state.search, ignoreCase = true) == true ||
                it.code.contains(state.search, ignoreCase = true)
        }
    }
    var showCreateForm by rememberSaveable { mutableStateOf(false) }
    var editCustomerOperation by remember { mutableStateOf<OperationSummary?>(null) }
    var deleteCustomerOperationId by remember { mutableStateOf<String?>(null) }
    val customerSyncIssues = state.operations.filter {
        it.type == "customer.create" && it.status != OperationUiState.ACCEPTED
    }
    Column(Modifier.fillMaxSize()) {
        if (canCreateCustomer) {
            Button(
                onClick = {
                    showCreateForm = true
                    viewModel.loadCustomerTypes()
                },
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp),
            ) {
                Text("Yeni Müşteri")
            }
        }
        OutlinedTextField(
            value = state.search,
            onValueChange = viewModel::updateSearch,
            label = { Text(stringResource(R.string.search_customer)) },
            leadingIcon = { Icon(Icons.Default.Search, contentDescription = null) },
            singleLine = true,
            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
        )
        customerSyncIssues.forEach { operation ->
            val canModify = CustomerModificationRules.canModify(operation.status)
            SwipeToDeleteDocument(
                canDelete = canModify,
                canEdit = canModify,
                onDelete = { deleteCustomerOperationId = operation.id },
                onEdit = { editCustomerOperation = operation },
                content = {
                    Card(
                        modifier = Modifier.fillMaxWidth()
                            .background(
                                Color(0xFFFFE5E5),
                                RoundedCornerShape(16.dp),
                            ),
                        colors = CardDefaults.cardColors(
                            containerColor = Color(0xFFFFE5E5),
                            contentColor = Color(0xFF7A1C1C),
                        ),
                    ) {
                        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Text(
                                "Yeni müşteri kaydı · ${stringResource(operation.status.labelResource)}",
                                fontWeight = FontWeight.SemiBold,
                                color = Color(0xFF7A1C1C),
                            )
                            operation.error?.let { error ->
                                Text(
                                    when (error) {
                                "DUPLICATE_TAX_NUMBER" -> "Bu vergi numarasıyla kayıtlı müşteri zaten var."
                                "INVALID_CUSTOMER_TYPE" -> "Seçilen müşteri türü artık geçerli değil."
                                "INVALID_CREDIT_LIMIT" -> "Maksimum borç bakiyesi sunucu tarafından geçersiz bulundu."
                                "TAX_OFFICE_REQUIRED" -> "Vergi dairesi zorunludur."
                                "TAX_IDENTITY_REQUIRED" -> "VKN veya TCKN girilmelidir."
                                "OWNER_NAME_REQUIRED" -> "Sahibi adı soyadı zorunludur."
                                "BUSINESS_TITLE_REQUIRED" -> "İşyeri ünvanı zorunludur."
                                "INVALID_VKN" -> "VKN 10 haneli rakamlardan oluşmalıdır."
                                "INVALID_TCKN" -> "TCKN 11 haneli rakamlardan oluşmalıdır."
                                "CUSTOMER_TYPE_REQUIRED" -> "Müşteri tipi zorunludur."
                                "ROUTE_DAY_REQUIRED" -> "Geçerli bir rut günü seçilmelidir."
                                "LOCATION_REQUIRED" -> "Konum kaydı alınmalı ve doğruluğu en fazla 50 metre olmalıdır."
                                "VALIDATION_ERROR" -> "Müşteri bilgileri sunucu tarafından doğrulanamadı."
                                "DATABASE_CONFLICT" -> "Veritabanı çakışması oluştu; işlem aynı kimlikle tekrar denenecek."
                                "DATABASE_CONNECTION_LOST" -> "Veritabanı bağlantısı geçici kesildi; işlem tekrar denenecek."
                                "RELATED_RECORD_NOT_FOUND" -> "İlgili müşteri veya temsilci kaydı bulunamadı."
                                else -> if (error.startsWith("RETRYABLE_DATABASE_")) {
                                    "Sunucuda veritabanı hatası oluştu: ${error.removePrefix("RETRYABLE_DATABASE_")}."
                                } else {
                                    error
                                }
                                    },
                                    style = MaterialTheme.typography.bodySmall,
                                )
                            }
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.End,
                            ) {
                                TextButton(onClick = { viewModel.dismissCustomerCreation(operation.id) }) {
                                    Text("Kapat", color = Color(0xFF7A1C1C))
                                }
                            }
                        }
                    }
                },
            )
        }
        if (filtered.isEmpty()) {
            EmptyMessage(
                if (state.customers.isEmpty()) stringResource(R.string.no_customers)
                else stringResource(R.string.customer_search_empty),
            )
        } else {
            LazyColumn(
                contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 16.dp, vertical = 8.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                items(filtered, key = { it.code }) { customer ->
                    CustomerCard(customer = customer, onClick = { onCustomer(customer) })
                }
            }
        }
    }
    if (showCreateForm) {
        NewCustomerDialog(
            state = state,
            viewModel = viewModel,
            onDismiss = { showCreateForm = false },
        )
    }
    if (editCustomerOperation != null) {
        val initialRequest = runCatching {
            kotlinx.serialization.json.Json { ignoreUnknownKeys = true }
                .decodeFromString<CustomerCreateRequest>(editCustomerOperation!!.payload)
        }.getOrNull()
        if (initialRequest != null) {
            NewCustomerDialog(
                state = state,
                viewModel = viewModel,
                initialRequest = initialRequest,
                editOperationId = editCustomerOperation!!.id,
                onDismiss = { editCustomerOperation = null },
            )
        } else {
            editCustomerOperation = null
        }
    }
    deleteCustomerOperationId?.let { operationId ->
        AlertDialog(
            onDismissRequest = { deleteCustomerOperationId = null },
            title = { Text("Gönderilmeyen müşteri silinsin mi?") },
            text = { Text("Yalnızca sunucuya kabul edilmemiş kayıt silinir. Kabul edilmiş müşteri silinmez.") },
            confirmButton = {
                TextButton(
                    onClick = {
                        deleteCustomerOperationId = null
                        viewModel.deleteCustomerCreation(operationId)
                    },
                ) { Text("Sil") }
            },
            dismissButton = {
                TextButton(onClick = { deleteCustomerOperationId = null }) { Text("Vazgeç") }
            },
        )
    }
}

@Composable
private fun NewCustomerDialog(
    state: MobileUiState,
    viewModel: AppViewModel,
    onDismiss: () -> Unit,
    initialRequest: CustomerCreateRequest? = null,
    editOperationId: String? = null,
) {
    var ownerName by rememberSaveable { mutableStateOf(initialRequest?.ownerName.orEmpty()) }
    var businessTitle by rememberSaveable { mutableStateOf(initialRequest?.businessTitle.orEmpty()) }
    var phone by rememberSaveable { mutableStateOf(initialRequest?.phone.orEmpty()) }
    var mobilePhone by rememberSaveable { mutableStateOf(initialRequest?.mobilePhone.orEmpty()) }
    var taxNo by rememberSaveable { mutableStateOf(initialRequest?.taxNo.orEmpty()) }
    var tckn by rememberSaveable { mutableStateOf(initialRequest?.tckn.orEmpty()) }
    var taxOffice by rememberSaveable { mutableStateOf(initialRequest?.taxOffice.orEmpty()) }
    var address by rememberSaveable { mutableStateOf(initialRequest?.address.orEmpty()) }
    var email by rememberSaveable { mutableStateOf(initialRequest?.email.orEmpty()) }
    var province by rememberSaveable { mutableStateOf(initialRequest?.province.orEmpty()) }
    var district by rememberSaveable { mutableStateOf(initialRequest?.district.orEmpty()) }
    var customerGroupCode by rememberSaveable { mutableStateOf(initialRequest?.customerGroupCode.orEmpty()) }
    var creditLimitText by rememberSaveable {
        mutableStateOf(initialRequest?.creditLimit?.toString().orEmpty())
    }
    val creditLimitInput = CreditLimitRules.parseInput(creditLimitText)
    var capturedLocation by remember {
        mutableStateOf(
            initialRequest?.let { request ->
                LocationReading(
                    latitude = request.locationLatitude,
                    longitude = request.locationLongitude,
                    accuracyM = request.locationAccuracyM,
                    capturedAt = request.locationCapturedAt,
                )
            },
        )
    }
    var locationLoading by remember { mutableStateOf(false) }
    var locationMessage by remember { mutableStateOf<String?>(null) }
    var customerTypeCode by rememberSaveable { mutableStateOf(initialRequest?.customerTypeCode.orEmpty()) }
    var routeDay by rememberSaveable { mutableStateOf(initialRequest?.routeDay.orEmpty()) }
    var customerTypeMenuExpanded by remember { mutableStateOf(false) }
    var routeDayMenuExpanded by remember { mutableStateOf(false) }
    var provinceMenuExpanded by remember { mutableStateOf(false) }
    var districtMenuExpanded by remember { mutableStateOf(false) }
    var customerGroupMenuExpanded by remember { mutableStateOf(false) }
    var taxCheckAttempt by remember { mutableStateOf(0) }
    var taxCheckLoading by remember { mutableStateOf(false) }
    var checkedTaxKey by remember { mutableStateOf<String?>(null) }
    var taxNumberExists by remember { mutableStateOf<Boolean?>(null) }
    var taxCheckError by remember { mutableStateOf<String?>(null) }
    val routeDays = listOf("Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi", "Pazar")
    val districtsByProvince = mapOf(
        "Antalya" to listOf("Akseki", "Alanya", "Kemer", "Kepez", "Konyaaltı", "Manavgat", "Muratpaşa", "Serik"),
        "Burdur" to listOf("Bucak", "Gölhisar", "Merkez", "Tefenni"),
        "İzmir" to listOf("Bornova", "Buca", "Karşıyaka", "Konak", "Urla"),
    )
    val allowedCustomerTypes = state.customerTypes.filter { it.name.equals("Perakende", true) || it.name.equals("Horeca", true) }
    val selectedType = allowedCustomerTypes.firstOrNull { it.code == customerTypeCode }
    val taxKey = "${taxOffice.trim()}|${taxNo.trim()}|${tckn.trim()}"
    val taxFieldsMessage = CustomerIdentityRules.missingFieldsMessage(taxOffice, taxNo, tckn)
    val taxFieldsValid = taxFieldsMessage == null
    val requiredNameMessage = CustomerIdentityRules.missingRequiredNameMessage(ownerName, businessTitle)
    val requiredNameValid = requiredNameMessage == null

    LaunchedEffect(taxKey, state.serverReachable, taxCheckAttempt) {
        checkedTaxKey = null
        taxNumberExists = null
        taxCheckError = null
        if (!taxFieldsValid || state.serverReachable != true) {
            taxCheckLoading = false
            return@LaunchedEffect
        }
        kotlinx.coroutines.delay(350)
        taxCheckLoading = true
        val numbers = listOf(taxNo.trim(), tckn.trim()).filter(String::isNotBlank).distinct()
        val results = numbers.map { viewModel.checkCustomerTaxNumber(it) }
        taxCheckLoading = false
        checkedTaxKey = taxKey
        val failure = results.firstOrNull { it.isFailure }
        if (failure == null) {
            taxNumberExists = results.any { it.getOrThrow() }
        } else {
            taxCheckError = failure.exceptionOrNull()?.message ?: "VKN/TCKN kontrol edilemedi."
        }
    }

    val taxCheckPassed = state.serverReachable != true ||
        (checkedTaxKey == taxKey && taxNumberExists == false && !taxCheckLoading)
    val emailValid = email.trim().isBlank()
        || Regex("^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$").matches(email.trim())
    val canContinue = taxFieldsValid && taxCheckPassed && emailValid

    Dialog(
        onDismissRequest = { if (!state.customerCreating) onDismiss() },
        properties = DialogProperties(usePlatformDefaultWidth = false),
    ) {
        Surface(
            modifier = Modifier.fillMaxWidth(0.96f).fillMaxHeight(0.94f).imePadding(),
            shape = RoundedCornerShape(24.dp),
            color = Color.White,
            shadowElevation = 12.dp,
        ) {
            Column(Modifier.fillMaxSize()) {
                Column(
                    Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 16.dp),
                    verticalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    Text("Yeni Müşteri", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
                    Text("Önce vergi bilgilerini doğrulayın.", style = MaterialTheme.typography.bodyMedium)
                }
                HorizontalDivider()
                Column(
                    Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState()).padding(20.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    OutlinedTextField(
                        value = taxOffice,
                        onValueChange = { taxOffice = it },
                        label = { Text("Vergi Dairesi *") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    OutlinedTextField(
                        value = taxNo,
                        onValueChange = { value -> if (value.length <= 10 && value.all { it in '0'..'9' }) taxNo = value },
                        label = { Text("Vergi Numarası (VKN)") },
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    OutlinedTextField(
                        value = tckn,
                        onValueChange = { value -> if (value.length <= 11 && value.all { it in '0'..'9' }) tckn = value },
                        label = { Text("T.C. Kimlik Numarası (TCKN)") },
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    when {
                        !taxFieldsValid -> Text(taxFieldsMessage!!, color = MaterialTheme.colorScheme.error)
                        state.serverReachable != true ->
                            Text("Çevrimdışı kayıt: VKN/TCKN eşitleme sırasında kontrol edilecek.")
                        taxCheckLoading -> Row(verticalAlignment = Alignment.CenterVertically) {
                            CircularProgressIndicator(Modifier.size(18.dp))
                            Text(" VKN/TCKN kontrol ediliyor…")
                        }
                        taxNumberExists == true && checkedTaxKey == taxKey ->
                            Text("Bu VKN veya TCKN ile kayıtlı müşteri zaten var.", color = MaterialTheme.colorScheme.error)
                        taxCheckError != null -> Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(taxCheckError!!, modifier = Modifier.weight(1f), color = MaterialTheme.colorScheme.error)
                            TextButton(onClick = { taxCheckAttempt++ }) { Text("Tekrar Dene") }
                        }
                        checkedTaxKey == taxKey && taxNumberExists == false ->
                            Text("VKN/TCKN kullanılabilir.", color = MaterialTheme.colorScheme.primary)
                    }

                    if (canContinue) {
                        HorizontalDivider()
                        Text("Müşteri bilgileri", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                        if (taxNo.isBlank() && tckn.isNotBlank()) {
                            Text("E-belge için kişinin yasal adı ve soyadı ile adres, il ve ilçe bilgileri gereklidir.")
                        }
                        OutlinedTextField(
                            value = businessTitle,
                            onValueChange = { businessTitle = it },
                            label = { Text("İşyeri Ünvanı *") },
                            singleLine = true,
                            modifier = Modifier.fillMaxWidth(),
                        )
                        OutlinedTextField(
                            value = ownerName,
                            onValueChange = { ownerName = it },
                            label = { Text("Sahibi Adı Soyadı *") },
                            singleLine = true,
                            modifier = Modifier.fillMaxWidth(),
                        )
                        if (requiredNameMessage != null) {
                            Text(requiredNameMessage, color = MaterialTheme.colorScheme.error)
                        }
                        OutlinedTextField(
                            value = phone,
                            onValueChange = { phone = it },
                            label = { Text("Telefon Numarası") },
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone),
                            singleLine = true,
                            modifier = Modifier.fillMaxWidth(),
                        )
                        OutlinedTextField(
                            value = mobilePhone,
                            onValueChange = { mobilePhone = it },
                            label = { Text("Cep Telefonu Numarası") },
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone),
                            singleLine = true,
                            modifier = Modifier.fillMaxWidth(),
                        )
                        OutlinedTextField(
                            value = address,
                            onValueChange = { address = it },
                            label = { Text("Adres (boşsa 0 kaydedilir)") },
                            modifier = Modifier.fillMaxWidth(),
                        )
                        OutlinedTextField(
                            value = email,
                            onValueChange = { email = it.take(254) },
                            label = { Text("E-posta (boşsa 0 kaydedilir)") },
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
                            singleLine = true,
                            isError = email.trim().isNotBlank() && !emailValid,
                            modifier = Modifier.fillMaxWidth(),
                        )
                        if (email.trim().isNotBlank() && !emailValid) {
                            Text("Geçerli bir e-posta adresi girin.", color = MaterialTheme.colorScheme.error)
                        }
                        Box(Modifier.fillMaxWidth()) {
                            OutlinedButton(onClick = { provinceMenuExpanded = true }, modifier = Modifier.fillMaxWidth()) {
                                Text(province.ifBlank { "İl *" })
                            }
                            DropdownMenu(expanded = provinceMenuExpanded, onDismissRequest = { provinceMenuExpanded = false }) {
                                districtsByProvince.keys.forEach { option ->
                                    DropdownMenuItem(
                                        text = { Text(option) },
                                        onClick = {
                                            province = option
                                            district = ""
                                            provinceMenuExpanded = false
                                        },
                                    )
                                }
                            }
                        }
                        Box(Modifier.fillMaxWidth()) {
                            OutlinedButton(onClick = { districtMenuExpanded = true }, enabled = province.isNotBlank(), modifier = Modifier.fillMaxWidth()) {
                                Text(district.ifBlank { "İlçe *" })
                            }
                            DropdownMenu(expanded = districtMenuExpanded, onDismissRequest = { districtMenuExpanded = false }) {
                                districtsByProvince[province].orEmpty().forEach { option ->
                                    DropdownMenuItem(
                                        text = { Text(option) },
                                        onClick = {
                                            district = option
                                            districtMenuExpanded = false
                                        },
                                    )
                                }
                            }
                        }
                        Box(Modifier.fillMaxWidth()) {
                            OutlinedButton(onClick = { customerGroupMenuExpanded = true }, modifier = Modifier.fillMaxWidth()) {
                                Text(state.customerGroups.firstOrNull { it.code == customerGroupCode }?.name ?: "Cari Grup *")
                            }
                            DropdownMenu(expanded = customerGroupMenuExpanded, onDismissRequest = { customerGroupMenuExpanded = false }) {
                                state.customerGroups.forEach { group ->
                                    DropdownMenuItem(
                                        text = { Text(group.name) },
                                        onClick = {
                                            customerGroupCode = group.code
                                            customerGroupMenuExpanded = false
                                        },
                                    )
                                }
                            }
                        }
                        if (province.isBlank()) Text("İl seçilmelidir.", color = MaterialTheme.colorScheme.error)
                        if (district.isBlank()) Text("İlçe seçilmelidir.", color = MaterialTheme.colorScheme.error)
                        if (customerGroupCode.isBlank()) Text("Cari grup seçilmelidir.", color = MaterialTheme.colorScheme.error)
                        OutlinedButton(
                            onClick = {
                                locationLoading = true
                                locationMessage = null
                                viewModel.captureBestLocation { result ->
                                    locationLoading = false
                                    capturedLocation = result.getOrNull()
                                    locationMessage = result.exceptionOrNull()?.message
                                }
                            },
                            enabled = !locationLoading,
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Icon(Icons.Default.LocationOn, contentDescription = null)
                            Spacer(Modifier.width(8.dp))
                            Text(if (locationLoading) "En doğru konum alınıyor…" else "En doğru konumu al")
                        }
                        capturedLocation?.let { reading ->
                            val quality = when {
                                reading.accuracyM <= 15 -> "Çok iyi"
                                reading.accuracyM <= 30 -> "Kullanılabilir"
                                else -> "Düşük doğruluk — tekrar ölçün"
                            }
                            Text(
                                "Konum: ${"%.6f".format(Locale.US, reading.latitude)}, " +
                                    "${"%.6f".format(Locale.US, reading.longitude)}\n" +
                                    "Doğruluk: ±${reading.accuracyM.toInt()} metre · $quality",
                                color = if (reading.accuracyM <= 50) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.error,
                            )
                        }
                        locationMessage?.let { Text(it, color = MaterialTheme.colorScheme.error) }
                        Box(Modifier.fillMaxWidth()) {
                            OutlinedButton(
                                onClick = { customerTypeMenuExpanded = true },
                                modifier = Modifier.fillMaxWidth(),
                            ) {
                                Text(selectedType?.name ?: "Müşteri Tipi *")
                            }
                            DropdownMenu(
                                expanded = customerTypeMenuExpanded,
                                onDismissRequest = { customerTypeMenuExpanded = false },
                            ) {
                                allowedCustomerTypes.forEach { type ->
                                    DropdownMenuItem(
                                        text = { Text(type.name) },
                                        onClick = {
                                            customerTypeCode = type.code
                                            customerTypeMenuExpanded = false
                                        },
                                    )
                                }
                            }
                        }
                        if (customerTypeCode.isBlank()) {
                            Text("Müşteri tipi seçilmelidir.", color = MaterialTheme.colorScheme.error)
                        }
                        Box(Modifier.fillMaxWidth()) {
                            OutlinedButton(
                                onClick = { routeDayMenuExpanded = true },
                                modifier = Modifier.fillMaxWidth(),
                            ) {
                                Text(routeDay.ifBlank { "Rut Günü *" })
                            }
                            DropdownMenu(
                                expanded = routeDayMenuExpanded,
                                onDismissRequest = { routeDayMenuExpanded = false },
                            ) {
                                routeDays.forEach { day ->
                                    DropdownMenuItem(
                                        text = { Text(day) },
                                        onClick = {
                                            routeDay = day
                                            routeDayMenuExpanded = false
                                        },
                                    )
                                }
                            }
                        }
                        if (routeDay.isBlank()) {
                            Text("Rut günü seçilmelidir.", color = MaterialTheme.colorScheme.error)
                        }
                    }
                    OutlinedTextField(
                        value = creditLimitText,
                        onValueChange = { value ->
                            if (value.length <= 16 && value.all { it.isDigit() || it == ',' || it == '.' }) creditLimitText = value
                        },
                        label = { Text("Maksimum borç bakiyesi (TL)") },
                        supportingText = {
                            Text(
                                creditLimitInput.exceptionOrNull()?.message ?: "Boş bırakılırsa limit uygulanmaz.",
                                color = if (creditLimitInput.isFailure) MaterialTheme.colorScheme.error else Color.Unspecified,
                            )
                        },
                        isError = creditLimitInput.isFailure,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth().testTag("customer-credit-limit"),
                    )
                    state.error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
                }
                HorizontalDivider()
                Row(
                    Modifier.fillMaxWidth().padding(16.dp),
                    horizontalArrangement = Arrangement.spacedBy(12.dp, Alignment.End),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    TextButton(onClick = onDismiss, enabled = !state.customerCreating) { Text("Vazgeç") }
                    Button(
                        onClick = {
                            val reading = requireNotNull(capturedLocation)
                            val request = CustomerCreateRequest(
                                ownerName = ownerName.trim(),
                                businessTitle = businessTitle.trim(),
                                customerTypeCode = customerTypeCode,
                                phone = CustomerIdentityRules.normalizeOptionalText(phone),
                                mobilePhone = CustomerIdentityRules.normalizeOptionalText(mobilePhone),
                                taxNo = taxNo.trim(),
                                tckn = tckn.trim(),
                                taxOffice = taxOffice.trim(),
                                address = CustomerIdentityRules.normalizeOptionalText(address),
                                province = province,
                                district = district,
                                email = CustomerIdentityRules.normalizeOptionalText(email),
                                customerGroupCode = customerGroupCode,
                                location = "${reading.latitude},${reading.longitude}",
                                locationLatitude = reading.latitude,
                                locationLongitude = reading.longitude,
                                locationAccuracyM = reading.accuracyM,
                                locationCapturedAt = reading.capturedAt,
                                routeDay = routeDay,
                                creditLimit = creditLimitInput.getOrNull(),
                            )
                            if (editOperationId != null) {
                                viewModel.editCustomerCreation(editOperationId, request, onEdited = onDismiss)
                            } else {
                                viewModel.createCustomer(request, onCreated = onDismiss)
                            }
                        },
                        enabled = canContinue && requiredNameValid && customerTypeCode.isNotBlank() && routeDay.isNotBlank() &&
                            creditLimitInput.isSuccess &&
                            capturedLocation?.accuracyM?.let { it in 0.0..50.0 } == true &&
                            !state.customerCreating,
                    ) {
                        if (state.customerCreating) CircularProgressIndicator(Modifier.size(18.dp))
                        else Text("Kaydet")
                    }
                }
            }
        }
    }
}

@Composable
private fun CustomerCard(
    customer: CustomerSummary,
    onClick: () -> Unit,
    onOrder: (() -> Unit)? = null,
    onStart: (() -> Unit)? = null,
    onFinish: ((String, String, String) -> Unit)? = null,
    modifier: Modifier = Modifier,
    showCustomerDetails: Boolean = false,
) {
    Card(
        modifier = Modifier.fillMaxWidth().then(modifier).clickable(onClick = onClick),
    shape = RoundedCornerShape(22.dp),
    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
    elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
) {
    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(11.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Surface(
                shape = RoundedCornerShape(15.dp),
                color = MaterialTheme.colorScheme.primaryContainer,
                modifier = Modifier.size(46.dp),
            ) {
                Box(contentAlignment = Alignment.Center) {
                    Text(
                        customer.name.trim().take(1).uppercase(Locale("tr", "TR")),
                        color = MaterialTheme.colorScheme.primary,
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.Bold,
                    )
                }
            }
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(
                    customer.title?.takeIf(String::isNotBlank) ?: customer.name,
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                )
                customer.title?.takeIf(String::isNotBlank)?.let {
                    Text(customer.name, style = MaterialTheme.typography.bodySmall)
                }
                Surface(
                    shape = RoundedCornerShape(8.dp),
                    color = MaterialTheme.colorScheme.surfaceVariant,
                ) {
                    Text(
                        customer.code,
                        modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            customer.visitState?.let { VisitStateBadge(it) }
        }
        val area = listOfNotNull(customer.district, customer.province).joinToString(", ")
        if (area.isNotBlank()) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                Icon(Icons.Default.LocationOn, contentDescription = null, tint = MaterialTheme.colorScheme.secondary, modifier = Modifier.size(16.dp))
                Text(area, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        customer.address?.takeIf(String::isNotBlank)?.let {
            Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        if (showCustomerDetails) {
            customer.balance?.let { balance ->
                Text(
                    "Cari bakiye · ${balance.toDoubleOrNull()?.let(::money) ?: balance}",
                    style = MaterialTheme.typography.bodySmall,
                    fontWeight = FontWeight.SemiBold,
                    color = MaterialTheme.colorScheme.primary,
                )
            }
        }
            if (onOrder != null || onStart != null) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    onStart?.let { OutlinedButton(onClick = it) { Text(stringResource(R.string.start_visit)) } }
                    onOrder?.let {
                        Button(
                            onClick = it,
                            colors = ButtonDefaults.buttonColors(containerColor = mobileOrderBlue),
                        ) { Text(stringResource(R.string.new_order)) }
                    }
                }
            }
            customer.visitState?.takeIf { it in setOf("pending", "open", "completion_pending") }?.let {
                onFinish?.let { finish ->
                    var showDialog by remember(customer.code) { mutableStateOf(false) }
                    OutlinedButton(onClick = { showDialog = true }) { Text(stringResource(R.string.finish_visit)) }
                    if (showDialog) VisitCompleteDialog(
                        onDismiss = { showDialog = false },
                        onConfirm = { result, note ->
                            finish(customer.code, result, note)
                            showDialog = false
                        },
                    )
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CustomerDetailScreen(
    state: MobileUiState,
    customer: CustomerSummary?,
    onBack: () -> Unit,
    onCaptureLocation: ((Result<LocationReading>) -> Unit) -> Unit,
    onStartVisit: (LocationReading?, Boolean, String?, (Result<Unit>) -> Unit) -> Unit,
    onFinishVisit: (String, String, String, (Result<Unit>) -> Unit) -> Unit,
    onNewOrder: () -> Unit,
    onNewSale: () -> Unit,
    onCollection: () -> Unit,
) {
    val selectedSalesContext = state.salesContext?.takeIf { customer == null || it.customer.code == customer.code }
    val current = selectedSalesContext?.customer?.let { detail ->
        val latestCustomer = (state.route + state.customers).firstOrNull { it.code == detail.code }
        detail.copy(visitState = latestCustomer?.visitState ?: detail.visitState)
    } ?: customer
    var showBalance by remember(current?.code) { mutableStateOf(false) }
    var verifyingLocation by remember(current?.code) { mutableStateOf(false) }
    var locationMessage by remember(current?.code) { mutableStateOf<String?>(null) }
    var unverifiedVisitPrompt by remember(current?.code) { mutableStateOf<UnverifiedVisitPrompt?>(null) }
    val openingRouteCustomer = state.workday?.openingSnapshot?.get("route")?.let {
        runCatching { it.jsonArray }.getOrNull()
    }.orEmpty().firstOrNull { element ->
        element.jsonObject["customerCode"]?.jsonPrimitive?.contentOrNull == current?.code
    }?.jsonObject
    if (current == null) {
        Column(Modifier.fillMaxSize()) {
            TopAppBar(
                title = { Text(stringResource(R.string.customers)) },
                navigationIcon = {
                    IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = null) }
                },
            )
            EmptyMessage(stringResource(R.string.no_customers))
        }
        return
    }
    Column(Modifier.fillMaxSize()) {
        TopAppBar(
            title = { Text(current.name, maxLines = 1) },
            navigationIcon = {
                IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = null) }
            },
        )
        Column(
            Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Card(
                shape = RoundedCornerShape(24.dp),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                elevation = CardDefaults.cardElevation(defaultElevation = 3.dp),
            ) {
                Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(current.name, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.primary)
                    InfoLine(stringResource(R.string.customer_code), current.code)
                    current.title?.takeIf(String::isNotBlank)?.let { InfoLine(stringResource(R.string.company_title), it) }
                    current.address?.let { InfoLine(stringResource(R.string.address), it) }
                    current.phone?.let { InfoLine(stringResource(R.string.phone), it) }
                    current.taxOffice?.takeIf(String::isNotBlank)?.let { InfoLine(stringResource(R.string.tax_office), it) }
                    current.taxNo?.takeIf(String::isNotBlank)?.let { InfoLine(stringResource(R.string.tax_number), it) }
                    current.tckn?.takeIf(String::isNotBlank)?.let { InfoLine("TCKN", it) }
                    current.locationAccuracyM?.let { InfoLine("Kayıtlı konum doğruluğu", "±${it.toInt()} metre") }
                    listOfNotNull(current.district, current.province).filter(String::isNotBlank)
                        .takeIf { it.isNotEmpty() }?.joinToString(", ")?.let {
                            InfoLine("İlçe / İl", it)
                        }
                    val balance = selectedSalesContext?.balance ?: current.balance
                    balance?.let { InfoLine(stringResource(R.string.balance), it.toDoubleOrNull()?.let(::money) ?: it) }
                        ?: openingRouteCustomer?.get("balance")?.jsonPrimitive?.contentOrNull?.let {
                            InfoLine(stringResource(R.string.balance), it)
                        }
                    selectedSalesContext?.lastOrder?.let { InfoLine(stringResource(R.string.last_order), it) }
                    openingRouteCustomer?.get("lastMonthSales")?.jsonArray?.let { sales ->
                        Text("Son 30 günlük satışlar", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold)
                        if (sales.isEmpty()) {
                            Text("Son 30 günde satış kaydı yok.", color = MaterialTheme.colorScheme.onSurfaceVariant)
                        } else {
                            sales.forEach { sale ->
                                val invoice = sale.jsonObject
                                Text(
                                    "${invoice["invoiceNo"]?.jsonPrimitive?.contentOrNull ?: "Fatura"} · ${invoice["invoiceDate"]?.jsonPrimitive?.contentOrNull.orEmpty()} · ${money(invoice["totalAmount"]?.jsonPrimitive?.content?.toDoubleOrNull() ?: 0.0)}",
                                    style = MaterialTheme.typography.bodySmall,
                                )
                            }
                        }
                    }
                    current.visitState?.let { VisitStateBadge(it) }
                }
            }
            val visitActive = current.visitState in setOf("pending", "open")
            if (!visitActive && current.visitState != "completion_pending"
                && "mobile.visit.create" in state.session?.capabilities.orEmpty()) {
                OutlinedButton(
                    onClick = {
                        verifyingLocation = true
                        locationMessage = null
                        onCaptureLocation capture@{ captured ->
                            val reading = captured.getOrNull()
                            if (reading == null) {
                                verifyingLocation = false
                                unverifiedVisitPrompt = UnverifiedVisitPrompt(
                                    location = null,
                                    reason = "gps_unavailable",
                                    detail = captured.exceptionOrNull()?.message ?: "Konum alınamadı.",
                                )
                                return@capture
                            }
                            if (reading.accuracyM > 30) {
                                verifyingLocation = false
                                unverifiedVisitPrompt = UnverifiedVisitPrompt(
                                    location = null,
                                    reason = "gps_accuracy_insufficient",
                                    detail = "GPS doğruluğu ±${reading.accuracyM.toInt()} metre.",
                                )
                                return@capture
                            }
                            val customerLatitude = current.locationLatitude
                            val customerLongitude = current.locationLongitude
                            if (customerLatitude == null || customerLongitude == null) {
                                verifyingLocation = false
                                unverifiedVisitPrompt = UnverifiedVisitPrompt(
                                    location = reading,
                                    reason = "customer_location_missing",
                                    detail = "Müşterinin kayıtlı konumu bulunmuyor.",
                                )
                                return@capture
                            }
                            val distance = FloatArray(1)
                            android.location.Location.distanceBetween(
                                reading.latitude,
                                reading.longitude,
                                customerLatitude,
                                customerLongitude,
                                distance,
                            )
                            if (distance[0] > 30) {
                                verifyingLocation = false
                                locationMessage = "Müşterinin kayıtlı konumuna ${distance[0].toInt()} metre uzaktasınız."
                                return@capture
                            }
                            onStartVisit(reading, false, null) { result ->
                                verifyingLocation = false
                                locationMessage = result.fold(
                                    onSuccess = { "Konum doğrulandı · Ziyaret otomatik başlatıldı." },
                                    onFailure = { it.message ?: "Ziyaret başlatılamadı." },
                                )
                            }
                        }
                    },
                    enabled = !verifyingLocation,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    if (verifyingLocation) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                    else Icon(Icons.Default.LocationOn, contentDescription = null)
                    Spacer(Modifier.width(8.dp))
                    Text(if (verifyingLocation) "Konum doğrulanıyor…" else "Konumu doğrula ve ziyareti başlat")
                }
            }
            locationMessage?.let {
                Text(
                    it,
                    color = if (it.startsWith("Konum doğrulandı") || it.startsWith("Ziyaret başlatıldı")) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.error,
                )
            }
            if (visitActive) {
                if ("mobile.order.create" in state.session?.capabilities.orEmpty()) {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(onClick = onNewSale, modifier = Modifier.weight(1f)) { Text("Satış") }
                        Button(
                            onClick = onNewOrder,
                            modifier = Modifier.weight(1f),
                            colors = ButtonDefaults.buttonColors(containerColor = mobileOrderBlue),
                        ) { Text("Sipariş") }
                    }
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(onClick = onCollection, modifier = Modifier.weight(1f)) {
                        Text("Tahsilat")
                    }
                    OutlinedButton(onClick = { showBalance = true }, modifier = Modifier.weight(1f)) {
                        Text("Cari Bakiye")
                    }
                }
                if ("mobile.visit.complete" in state.session?.capabilities.orEmpty()) {
                    VisitFinishButton(current, onFinishVisit)
                }
            } else if (current.visitState == "completion_pending") {
                Text(
                    "Ziyaret bitirme işlemi eşitlenmeyi bekliyor.",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            if (state.serverReachable == false && state.salesContext == null) {
                Text(stringResource(R.string.server_unavailable), color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
    unverifiedVisitPrompt?.let { prompt ->
        AlertDialog(
            onDismissRequest = { unverifiedVisitPrompt = null },
            title = { Text("Konum doğrulanmadı") },
            text = { Text("${prompt.detail}\n\nYine de ziyaret başlasın mı?") },
            confirmButton = {
                Button(
                    onClick = {
                        unverifiedVisitPrompt = null
                        verifyingLocation = true
                        onStartVisit(prompt.location, true, prompt.reason) { result ->
                            verifyingLocation = false
                            locationMessage = result.fold(
                                onSuccess = { "Ziyaret başlatıldı · Konum doğrulanmadı." },
                                onFailure = { it.message ?: "Ziyaret başlatılamadı." },
                            )
                        }
                    },
                ) { Text("Evet, ziyareti başlat") }
            },
            dismissButton = {
                OutlinedButton(onClick = { unverifiedVisitPrompt = null }) { Text("Vazgeç") }
            },
        )
    }
    if (showBalance) {
        val salesContext = selectedSalesContext
        val balance = selectedSalesContext?.balance ?: current.balance
            ?: openingRouteCustomer?.get("balance")?.jsonPrimitive?.contentOrNull
        AlertDialog(
            onDismissRequest = { showBalance = false },
            title = { Text("Cari Hareketler · Son 1 Ay") },
            text = {
                Column(
                    Modifier.fillMaxWidth().height(420.dp).verticalScroll(rememberScrollState()),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    Text(current.title?.takeIf(String::isNotBlank) ?: current.name, fontWeight = FontWeight.SemiBold)
                    Text("Güncel bakiye: ${balance?.toDoubleOrNull()?.let(::money) ?: balance ?: "bilgi bulunamadı."}")
                    HorizontalDivider()
                    when {
                        state.serverReachable == false ->
                            Text("Son bir aylık hareketleri görmek için internet bağlantısı gerekir.")
                        salesContext == null ->
                            Text(
                                state.error?.let { "Cari hareketler alınamadı: $it" }
                                    ?: if (state.loading) "Cari hareketler yükleniyor…" else "Cari hareketler yüklenemedi.",
                            )
                        salesContext.accountMovements == null ->
                            Text("Son bir aylık cari hareketler için sunucu API güncellemesi gerekiyor.")
                        salesContext.accountMovements.isEmpty() ->
                            Text("Son bir ay içinde cari hareket bulunamadı.")
                        else -> salesContext.accountMovements.orEmpty().forEach { movement ->
                            Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
                                Row(
                                    Modifier.fillMaxWidth(),
                                    horizontalArrangement = Arrangement.SpaceBetween,
                                    verticalAlignment = Alignment.Top,
                                ) {
                                    Column(Modifier.weight(1f)) {
                                        Text(movement.type, fontWeight = FontWeight.SemiBold)
                                        Text(
                                            listOfNotNull(movement.date, movement.reference)
                                                .filter(String::isNotBlank)
                                                .joinToString(" · "),
                                            style = MaterialTheme.typography.bodySmall,
                                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                                        )
                                    }
                                    Text(
                                        "${if (movement.balanceEffect >= 0) "+" else "−"}${money(kotlin.math.abs(movement.balanceEffect))}",
                                        color = if (movement.balanceEffect >= 0) {
                                            MaterialTheme.colorScheme.error
                                        } else {
                                            MaterialTheme.colorScheme.primary
                                        },
                                        fontWeight = FontWeight.SemiBold,
                                    )
                                }
                                movement.description?.takeIf(String::isNotBlank)?.let {
                                    Text(it, style = MaterialTheme.typography.bodySmall)
                                }
                            }
                            HorizontalDivider()
                        }
                    }
                }
            },
            confirmButton = {
                TextButton(onClick = { showBalance = false }) { Text("Kapat") }
            },
        )
    }
}

@Composable
private fun VisitFinishButton(
    customer: CustomerSummary,
    onFinishVisit: (String, String, String, (Result<Unit>) -> Unit) -> Unit,
) {
    var showDialog by remember { mutableStateOf(false) }
    var isFinishing by remember(customer.code) { mutableStateOf(false) }
    var completionError by remember(customer.code) { mutableStateOf<String?>(null) }
    OutlinedButton(onClick = { showDialog = true }, modifier = Modifier.fillMaxWidth()) {
        Text(stringResource(R.string.finish_visit))
    }
    if (showDialog) VisitCompleteDialog(
        error = completionError,
        isFinishing = isFinishing,
        onDismiss = { if (!isFinishing) showDialog = false },
        onConfirm = { result, note ->
            if (!isFinishing) {
                isFinishing = true
                completionError = null
                onFinishVisit(customer.code, result, note) { completion ->
                    isFinishing = false
                    if (completion.isSuccess) {
                        showDialog = false
                    } else {
                        completionError = completion.exceptionOrNull()?.message
                            ?: "Ziyaret tamamlanamadı."
                    }
                }
            }
        },
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun OrderScreen(
    state: MobileUiState,
    draftId: String,
    onBack: () -> Unit,
    editOperationId: String? = null,
    onLoadUnitPrice: (String, String, String, String) -> Unit,
    onChangeQuantity: (String, ProductSummary, String, Double) -> Unit,
    onChangeDiscount: ((String, ProductSummary, String, Double) -> Unit)?,
    onQuote: (String, Map<String, Boolean>, String?) -> Unit,
    onSubmit: (String, Map<String, Boolean>, String?) -> Unit,
    onSaleSelectionsChanged: (String, Set<String>, String?) -> Unit,
    onSaveHotSaleLine: (String, ProductSummary, DraftLineSummary?, String, Double, Double, () -> Unit) -> Unit,
    onReplaceSale: (String, String, Map<String, Boolean>, String?, () -> Unit) -> Unit,
    onShowDetails: (String) -> Unit,
    hotSaleStockCheck: ((String, ProductSummary, String?, String, Double) -> HotSaleStockCheck?)? = null,
    blueThemeApplied: Boolean = false,
) {
    val themeDraft = state.activeDraft?.takeIf { it.id == draftId }
    if (!blueThemeApplied && themeDraft?.documentType == "order") {
        MobileOrderTheme {
            OrderScreen(
                state = state,
                draftId = draftId,
                onBack = onBack,
                editOperationId = editOperationId,
                onLoadUnitPrice = onLoadUnitPrice,
                onChangeQuantity = onChangeQuantity,
                onChangeDiscount = onChangeDiscount,
                onQuote = onQuote,
                onSubmit = onSubmit,
                onSaleSelectionsChanged = onSaleSelectionsChanged,
                onSaveHotSaleLine = onSaveHotSaleLine,
                onReplaceSale = onReplaceSale,
                onShowDetails = onShowDetails,
                hotSaleStockCheck = hotSaleStockCheck,
                blueThemeApplied = true,
            )
        }
        return
    }
    val draft = state.activeDraft?.takeIf { it.id == draftId }
    var search by rememberSaveable(draftId) { mutableStateOf("") }
    var saleStep by rememberSaveable(draftId) { mutableStateOf(if (editOperationId != null) 1 else 0) }
    var editorTarget by remember(draftId) { mutableStateOf<Pair<ProductSummary, DraftLineSummary?>?>(null) }
    var pendingPromotionId by rememberSaveable(draftId) { mutableStateOf<String?>(null) }
    var pendingRewardCode by rememberSaveable(draftId) { mutableStateOf<String?>(null) }
    var promotionInvalidated by rememberSaveable(draftId) { mutableStateOf(false) }
    val discountSelection = state.saleDiscountSelections[draftId].orEmpty()
    val selectedPromotionId = state.saleSelectedPromotions[draftId]
    if (draft == null) {
        LoadingRow()
        return
    }
    val isHotSale = draft.documentType == "van_sale"
    val usesInvoiceFlow = isHotSale || draft.documentType == "order"
    val priceDocumentType = if (usesInvoiceFlow) "van_sale" else draft.documentType
    val saleLineSignature = draft.lines.joinToString("|") {
        "${it.productCode}:${it.unitCode}:${it.quantity}:${it.manualDiscountPercent}"
    }
    LaunchedEffect(saleStep, saleLineSignature, discountSelection, selectedPromotionId, state.quote) {
        if (usesInvoiceFlow && saleStep == 1 && draft.lines.isNotEmpty()
            && state.quote == null && (state.serverReachable == true || state.mockMode)
        ) {
            onQuote(draft.id, discountSelection.associateWith { true }, selectedPromotionId)
        }
    }
    val hotSaleEstimatedNet = if (usesInvoiceFlow) {
        val linePrices = draft.lines.map { line ->
            state.unitPrices["${draft.customerCode}::${line.productCode}::${line.unitCode}::$priceDocumentType"]
                ?.unitPrice?.times(line.quantity)
        }
        linePrices.takeIf { prices -> prices.all { it != null } }?.sumOf { it ?: 0.0 }
    } else {
        draft.netEstimate
    }
    val promotionalQuoteLines = state.quote?.result?.get("lines")?.let {
        runCatching { it.jsonArray }.getOrNull()
    }.orEmpty().map { it.jsonObject }.filter {
        it["priceSource"]?.jsonPrimitive?.contentOrNull == "PROMOTION_FREE_GOODS"
    }
    Column(Modifier.fillMaxSize()) {
        TopAppBar(
            title = {
                Text(
                    if (isHotSale) stringResource(R.string.hot_sale_summary)
                    else stringResource(R.string.order_summary),
                )
            },
            navigationIcon = {
                IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = null) }
            },
        )
        LazyColumn(
            modifier = Modifier.weight(1f),
            contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 16.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            item {
                Text(
                    stringResource(
                        if (isHotSale) R.string.new_hot_sale_for else R.string.new_order_for,
                        draft.customerName,
                    ),
                    style = MaterialTheme.typography.titleLarge,
                    fontWeight = FontWeight.Bold,
                )
                Text(stringResource(R.string.status_label, stringResource(draft.stateLabelResource())), color = MaterialTheme.colorScheme.onSurfaceVariant)
                if (draft.state == "access_revoked") {
                    Text(stringResource(R.string.error_customer_access_revoked), color = MaterialTheme.colorScheme.error)
                }
            }
            if (usesInvoiceFlow && saleStep == 0) {
                item {
                    Card(shape = RoundedCornerShape(16.dp)) {
                        Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            Text(if (isHotSale) "Cari bilgileri" else "Sipariş bilgileri", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                            Text(draft.customerName)
                            if (isHotSale) state.salesContext?.balance?.let { Text("Cari bakiye: $it") }
                            Text("Uygulanacak cari ve ödeme iskontolarını seçin. Ürün iskontosu ürün satırında girilir.")
                            val availableDiscounts = listOf(
                                "m1" to "M1 İskonto",
                                "m2" to "M2 İskonto",
                                "m3" to "M3 İskonto",
                                "cash" to "Peşin İskonto",
                                "deferred" to "Vadeli İskonto",
                            ).filter { (key, _) -> (state.salesContext?.discountRates?.get(key) ?: 0.0) > 0.0 }
                            if (availableDiscounts.isEmpty()) {
                                Text("Bu caride tanımlı müşteri/ödeme iskontosu bulunmuyor.")
                            }
                            availableDiscounts.forEach { (key, label) ->
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Checkbox(
                                        checked = key in discountSelection,
                                        onCheckedChange = { checked ->
                                            val updatedSelection = if (checked) discountSelection + key else discountSelection - key
                                            onSaleSelectionsChanged(draft.id, updatedSelection, selectedPromotionId)
                                        },
                                    )
                                    Text("$label %${state.salesContext?.discountRates?.get(key) ?: 0.0}")
                                }
                            }
                        }
                    }
                }
            }
            if (!usesInvoiceFlow || saleStep == 1) {
                item {
                    Text(
                        stringResource(R.string.estimated_net) + ": " +
                            (hotSaleEstimatedNet?.let(::money) ?: "Fiyatlar hesaplanıyor…"),
                        style = MaterialTheme.typography.titleMedium,
                    )
                    if (state.serverReachable != true) Text(stringResource(R.string.offline_estimate), style = MaterialTheme.typography.bodySmall)
                }
                if (usesInvoiceFlow) {
                    item {
                        OutlinedButton(onClick = {
                            saleStep = 0
                            onSaleSelectionsChanged(draft.id, discountSelection, null)
                        }) {
                            Text("Cari / iskonto seçimine dön")
                        }
                    }
                    item {
                        Text(if (isHotSale) "Sıcak satış özeti" else "Sipariş özeti", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                    }
                    items(draft.lines, key = { "sale-summary-${it.id}" }) { line ->
                        val product = state.products.firstOrNull { it.code == line.productCode }
                        if (product != null) {
                            val priceKey = "${draft.customerCode}::${line.productCode}::${line.unitCode}::$priceDocumentType"
                            LaunchedEffect(draft.customerCode, line.productCode, line.unitCode) {
                                onLoadUnitPrice(draft.customerCode, line.productCode, line.unitCode, priceDocumentType)
                            }
                            val unitPrice = state.unitPrices[priceKey]?.unitPrice
                            val quoteLine = state.quote?.result?.get("lines")?.let {
                                runCatching { it.jsonArray }.getOrNull()
                            }.orEmpty().firstOrNull { element ->
                                val values = element.jsonObject
                                values["productCode"]?.jsonPrimitive?.contentOrNull == line.productCode &&
                                    values["unitCode"]?.jsonPrimitive?.contentOrNull == line.unitCode
                            }?.jsonObject
                            val quotedAmount = quoteLine?.get("productNetAmount")?.jsonPrimitive?.doubleOrNull
                                ?: quoteLine?.get("netAmount")?.jsonPrimitive?.doubleOrNull
                            HotSaleLineSummary(
                                product = product,
                                quantity = line.quantity,
                                unit = line.unitCode,
                                discountPercent = line.manualDiscountPercent,
                                amount = quotedAmount ?: unitPrice?.times(line.quantity)
                                    ?.times(1.0 - line.manualDiscountPercent / 100.0),
                                enabled = draft.state == "draft",
                                onClick = { editorTarget = product to line },
                                onDelete = {
                                    promotionInvalidated = selectedPromotionId != null && selectedPromotionId != "SKIP"
                                    onSaleSelectionsChanged(draft.id, discountSelection, null)
                                    onChangeQuantity(draft.id, product, line.unitCode, -line.quantity)
                                },
                            )
                        }
                    }
                    items(
                        promotionalQuoteLines,
                        key = { "sale-promotion-${it.stringValue("promotionCode")}-${it.stringValue("productCode")}" },
                    ) { line ->
                        PromotionalGiftLineCard(line)
                    }
                }
                item { Text(stringResource(R.string.products_tab), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold) }
                if (draft.lines.isEmpty()) item { EmptyMessage(stringResource(R.string.no_lines)) }
                items(draft.lines, key = { it.id }) { line ->
                    val product = state.products.firstOrNull { it.code == line.productCode }
                    if (product != null && !usesInvoiceFlow) {
                        val unitPriceKey = "${draft.customerCode}::${product.code}::${line.unitCode}::${draft.documentType}"
                        LaunchedEffect(draft.customerCode, draft.documentType, product.code, line.unitCode) {
                            onLoadUnitPrice(draft.customerCode, product.code, line.unitCode, draft.documentType)
                        }
                        val unitPrice = state.unitPrices[unitPriceKey]
                        DraftLineCard(
                            product = product,
                            quantity = line.quantity,
                            unit = line.unitCode,
                            unitPrice = unitPrice,
                            unitPriceLoading = unitPriceKey in state.loadingUnitPrices,
                            unitPriceError = state.unitPriceErrors[unitPriceKey],
                            manualDiscountPercent = line.manualDiscountPercent,
                            enabled = draft.state == "draft",
                            automaticDiscount = draft.documentType == "van_sale",
                            onChange = { delta ->
                                onSaleSelectionsChanged(draft.id, discountSelection, null)
                                onChangeQuantity(draft.id, product, line.unitCode, delta)
                            },
                            discountEnabled = onChangeDiscount != null,
                            onChangeDiscount = { percent ->
                                onSaleSelectionsChanged(draft.id, discountSelection, null)
                                onChangeDiscount?.invoke(draft.id, product, line.unitCode, percent)
                            },
                        )
                    }
                }
                item {
                    OutlinedTextField(
                        value = search,
                        onValueChange = { search = it },
                        label = { Text(stringResource(R.string.products_tab)) },
                        leadingIcon = { Icon(Icons.Default.Search, contentDescription = null) },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
                val productMatches = state.products.filter {
                    (!usesInvoiceFlow || draft.lines.none { line -> line.productCode == it.code })
                        && (it.name.contains(search, ignoreCase = true) || it.code.contains(search, ignoreCase = true))
                }
                if (productMatches.isEmpty()) {
                    item {
                        EmptyMessage(
                            if (usesInvoiceFlow && draft.lines.isNotEmpty() && search.isBlank()) {
                                if (isHotSale) "Tüm ürünler bu sıcak satışa eklendi." else "Tüm ürünler bu siparişe eklendi."
                            } else {
                                stringResource(R.string.no_products)
                            },
                        )
                    }
                }
                items(productMatches, key = { "product-${it.code}" }) { product ->
                    if (usesInvoiceFlow) {
                        HotSaleProductPickerCard(
                            product = product,
                            onClick = {
                                editorTarget = product to null
                                onLoadUnitPrice(draft.customerCode, product.code, product.unit, priceDocumentType)
                            },
                        )
                    } else {
                        ProductPickerCard(
                            product = product,
                            customerCode = draft.customerCode,
                            documentType = draft.documentType,
                            enabled = draft.state == "draft",
                            unitPrices = state.unitPrices,
                            loadingUnitPrices = state.loadingUnitPrices,
                            unitPriceErrors = state.unitPriceErrors,
                            onLoadUnitPrice = { selectedUnit ->
                                onLoadUnitPrice(draft.customerCode, product.code, selectedUnit, draft.documentType)
                            },
                        ) { selectedUnit ->
                            onSaleSelectionsChanged(draft.id, discountSelection, null)
                            onLoadUnitPrice(draft.customerCode, product.code, selectedUnit, draft.documentType)
                            onChangeQuantity(draft.id, product, selectedUnit, 1.0)
                        }
                    }
                }
                state.quote?.let { quote ->
                    item { QuoteCard(quote = quote, mock = state.mockMode, products = state.products) }
                }
                val promotionChoices = state.quote?.result?.get("promotions")?.let {
                    runCatching { it.jsonArray }.getOrNull()
                }.orEmpty()
                if (state.quote?.quoteStatus == "promotion_selection_required") {
                    item {
                        Text("Birden fazla promosyon uygun. Uygulanacak promosyonu seçin:", fontWeight = FontWeight.SemiBold)
                    }
                    items(promotionChoices) { option ->
                        val promotion = option.jsonObject
                        val id = promotion["id"]?.jsonPrimitive?.contentOrNull.orEmpty()
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            RadioButton(
                                selected = selectedPromotionId == id,
                                onClick = { onSaleSelectionsChanged(draft.id, discountSelection, id) },
                            )
                            Text(
                                "${promotion["code"]?.jsonPrimitive?.contentOrNull.orEmpty()} · " +
                                    promotion["name"]?.jsonPrimitive?.contentOrNull.orEmpty(),
                            )
                        }
                    }
                }
                state.error?.let { item { InlineError(it) } }
            }
        }
        Surface(
            modifier = Modifier.windowInsetsPadding(WindowInsets.navigationBars),
            shadowElevation = 8.dp,
        ) {
            Column(
                Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                if (usesInvoiceFlow && saleStep == 0) {
                    Button(onClick = { saleStep = 1 }, modifier = Modifier.fillMaxWidth()) {
                        Text(if (isHotSale) "Satışa Geç" else "Siparişe Geç")
                    }
                } else if (usesInvoiceFlow) {
                    Button(
                        onClick = {
                            if (editOperationId != null) {
                                onReplaceSale(
                                    editOperationId,
                                    draft.id,
                                    discountSelection.associateWith { true },
                                    selectedPromotionId,
                                    onBack,
                                )
                            } else {
                                onShowDetails(draft.id)
                            }
                        },
                        enabled = draft.state == "draft" && draft.lines.isNotEmpty() && !state.loading
                            && (editOperationId == null || state.serverReachable == true),
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Text(
                            if (editOperationId != null) "Düzeltmeyi Kaydet"
                            else if (isHotSale) "Satış detayını göster" else "Sipariş detayını göster",
                        )
                    }
                } else {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedButton(
                            onClick = { onQuote(draft.id, discountSelection.associateWith { true }, selectedPromotionId) },
                            enabled = draft.state == "draft" &&
                                (state.serverReachable == true || state.mockMode) && draft.lines.isNotEmpty(),
                            modifier = Modifier.weight(1f),
                        ) { Text(stringResource(R.string.quote)) }
                        Button(
                            onClick = { onSubmit(draft.id, discountSelection.associateWith { true }, selectedPromotionId) },
                            enabled = draft.state == "draft" && !state.loading && draft.lines.isNotEmpty()
                                && (!usesInvoiceFlow || state.quote?.quoteStatus == "accepted"),
                            modifier = Modifier.weight(1f),
                        ) {
                            Text(
                                if (isHotSale) stringResource(R.string.submit_hot_sale)
                                else stringResource(R.string.send_order),
                            )
                        }
                    }
                }
                if (state.loading) LoadingRow()
            }
        }
        val quoteStatus = state.quote?.quoteStatus
        if (usesInvoiceFlow
            && quoteStatus in setOf("promotion_selection_required", "promotion_reward_selection_required")
        ) {
            val promotionChoices = state.quote?.result?.get("promotions")?.let {
                runCatching { it.jsonArray }.getOrNull()
            }.orEmpty()
            val rewardChoices = if (quoteStatus == "promotion_reward_selection_required") {
                state.quote?.result?.get("rewardProducts")?.let {
                    runCatching { it.jsonArray }.getOrNull()
                }.orEmpty()
            } else {
                promotionChoices.firstOrNull {
                    it.jsonObject["id"]?.jsonPrimitive?.contentOrNull == pendingPromotionId
                }?.jsonObject?.get("rewardProducts")?.let {
                    runCatching { it.jsonArray }.getOrNull()
                }.orEmpty()
            }
            AlertDialog(
                onDismissRequest = {},
                title = {
                    Text(
                        if (quoteStatus == "promotion_reward_selection_required") {
                            "Bedelsiz ürünü seçin"
                        } else {
                            "Promosyon uygulanabilir"
                        },
                    )
                },
                text = {
                    Column(
                        Modifier.fillMaxWidth().verticalScroll(rememberScrollState()),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        if (quoteStatus == "promotion_selection_required") {
                            Text(if (isHotSale) "Bu satış için uygun promosyon bulundu. Uygulamak ister misiniz." else "Bu sipariş için uygun promosyon bulundu. Uygulamak ister misiniz.")
                            promotionChoices.forEach { option ->
                                val promotion = option.jsonObject
                                val id = promotion["id"]?.jsonPrimitive?.contentOrNull.orEmpty()
                                val rewardType = promotion["rewardType"]?.jsonPrimitive?.contentOrNull
                                val benefit = promotion["benefitAmount"]?.jsonPrimitive?.doubleOrNull
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    RadioButton(
                                        selected = pendingPromotionId == id,
                                        onClick = {
                                            pendingPromotionId = id
                                            pendingRewardCode = null
                                        },
                                    )
                                    Column {
                                        Text(
                                            "${promotion["code"]?.jsonPrimitive?.contentOrNull.orEmpty()} · " +
                                                promotion["name"]?.jsonPrimitive?.contentOrNull.orEmpty(),
                                            fontWeight = FontWeight.SemiBold,
                                        )
                                        Text(
                                            if (rewardType == "discount") {
                                                "%${promotion["rewardValue"]?.jsonPrimitive?.contentOrNull.orEmpty()} indirim" +
                                                    (benefit?.let { " · Kazanç ${money(it)}" } ?: "")
                                            } else {
                                                "Bedelsiz ürün" + (benefit?.let { " · Değer ${money(it)}" } ?: "")
                                            },
                                            style = MaterialTheme.typography.bodySmall,
                                        )
                                    }
                                }
                            }
                        }
                        if (rewardChoices.size > 1 || quoteStatus == "promotion_reward_selection_required") {
                            Text("Bedelsiz ürün seçimi", fontWeight = FontWeight.Bold)
                            rewardChoices.forEach { option ->
                                val reward = option.jsonObject
                                val code = reward["code"]?.jsonPrimitive?.contentOrNull.orEmpty()
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    RadioButton(
                                        selected = pendingRewardCode == code,
                                        onClick = { pendingRewardCode = code },
                                    )
                                    Text(
                                        "$code · ${reward["name"]?.jsonPrimitive?.contentOrNull.orEmpty()} · " +
                                            "${reward["quantity"]?.jsonPrimitive?.contentOrNull.orEmpty()} " +
                                            reward["unit"]?.jsonPrimitive?.contentOrNull.orEmpty(),
                                    )
                                }
                            }
                        } else if (rewardChoices.size == 1) {
                            val reward = rewardChoices.first().jsonObject
                            Text(
                                "Bedelsiz: ${reward["name"]?.jsonPrimitive?.contentOrNull.orEmpty()} · " +
                                    "${reward["quantity"]?.jsonPrimitive?.contentOrNull.orEmpty()} " +
                                    reward["unit"]?.jsonPrimitive?.contentOrNull.orEmpty(),
                            )
                        }
                    }
                },
                dismissButton = {
                    TextButton(onClick = {
                        pendingPromotionId = null
                        pendingRewardCode = null
                        onSaleSelectionsChanged(draft.id, discountSelection, "SKIP")
                    }) { Text("Promosyonsuz devam et") }
                },
                confirmButton = {
                    val effectivePromotionId = pendingPromotionId
                        ?: state.quote?.result?.get("promotion")?.jsonObject
                            ?.get("id")?.jsonPrimitive?.contentOrNull
                    val rewardRequired = rewardChoices.size > 1
                    Button(
                        enabled = effectivePromotionId != null && (!rewardRequired || pendingRewardCode != null),
                        onClick = {
                            val token = buildString {
                                append(effectivePromotionId)
                                pendingRewardCode?.let { append(":").append(it) }
                            }
                            onSaleSelectionsChanged(draft.id, discountSelection, token)
                            pendingPromotionId = null
                            pendingRewardCode = null
                        },
                    ) { Text("Uygula") }
                },
                containerColor = Color.White,
            )
        }
        if (promotionInvalidated) {
            AlertDialog(
                onDismissRequest = { promotionInvalidated = false },
                title = { Text("Promosyon yeniden kontrol edilecek") },
                text = { Text("Sepet değiştiği için önceki promosyon seçimi iptal edildi.") },
                confirmButton = {
                    Button(onClick = { promotionInvalidated = false }) { Text("Tamam") }
                },
                containerColor = Color.White,
            )
        }
        editorTarget?.let { (product, line) ->
            HotSaleLineEditorDialog(
                product = product,
                existingLine = line,
                customerCode = draft.customerCode,
                enabled = draft.state == "draft" && !state.loading,
                unitPrices = state.unitPrices,
                loadingUnitPrices = state.loadingUnitPrices,
                unitPriceErrors = state.unitPriceErrors,
                error = state.error,
                stockCheck = hotSaleStockCheck?.takeIf { draft.documentType == "van_sale" }?.let { check ->
                    { unit: String, quantity: Double -> check(draft.id, product, line?.unitCode, unit, quantity) }
                },
                stockSourceLabel = state.hotSaleStock?.let { stock ->
                    if (stock.fromCache) "Son eşitlenen araç stoğu (${stock.fetchedAt.orEmpty().take(16).replace('T', ' ')})" else null
                },
                stockLoading = state.hotSaleStockLoading,
                stockError = state.hotSaleStockError,
                onLoadUnitPrice = { unit ->
                    onLoadUnitPrice(draft.customerCode, product.code, unit, priceDocumentType)
                },
                onDismiss = { editorTarget = null },
                onSave = { unit, quantity, discountPercent ->
                    promotionInvalidated = selectedPromotionId != null && selectedPromotionId != "SKIP"
                    onSaleSelectionsChanged(draft.id, discountSelection, null)
                    onSaveHotSaleLine(
                        draft.id,
                        product,
                        line,
                        unit,
                        quantity,
                        discountPercent,
                    ) { editorTarget = null }
                },
            )
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HotSaleDetailsScreen(
    state: MobileUiState,
    draftId: String,
    onBack: () -> Unit,
    onLoadUnitPrice: (String, String, String, String) -> Unit,
    onQuote: (String, Map<String, Boolean>, String?) -> Unit,
    onSubmit: (String, Map<String, Boolean>, String?) -> Unit,
    onSaleSelectionsChanged: (String, Set<String>, String?) -> Unit,
    blueThemeApplied: Boolean = false,
) {
    val themeDraft = state.activeDraft?.takeIf { it.id == draftId }
    if (!blueThemeApplied && themeDraft?.documentType == "order") {
        MobileOrderTheme {
            HotSaleDetailsScreen(
                state = state,
                draftId = draftId,
                onBack = onBack,
                onLoadUnitPrice = onLoadUnitPrice,
                onQuote = onQuote,
                onSubmit = onSubmit,
                onSaleSelectionsChanged = onSaleSelectionsChanged,
                blueThemeApplied = true,
            )
        }
        return
    }
    val draft = state.activeDraft?.takeIf { it.id == draftId }
    val isHotSale = draft?.documentType == "van_sale"
    val priceDocumentType = if (draft?.documentType == "order") "van_sale" else draft?.documentType.orEmpty()
    val selectedDiscounts = state.saleDiscountSelections[draftId].orEmpty()
    val selectedPromotion = state.saleSelectedPromotions[draftId]
    val customer = state.salesContext?.customer?.takeIf { it.code == draft?.customerCode }
        ?: state.customers.firstOrNull { it.code == draft?.customerCode }
    LaunchedEffect(draft?.id, draft?.lines, selectedDiscounts, selectedPromotion) {
        if (draft != null && (draft.documentType == "van_sale" || draft.documentType == "order") && draft.lines.isNotEmpty()
            && state.quote == null && (state.serverReachable == true || state.mockMode)
        ) {
            onQuote(draft.id, selectedDiscounts.associateWith { true }, selectedPromotion)
        }
    }
    if (draft == null) {
        LoadingRow()
        return
    }
    val selectedDiscountLabels = listOf(
        "m1" to "M1 İskonto",
        "m2" to "M2 İskonto",
        "m3" to "M3 İskonto",
        "cash" to "Peşin İskonto",
        "deferred" to "Vadeli İskonto",
    ).filter { it.first in selectedDiscounts }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(if (isHotSale) "Satış detayı" else "Sipariş detayı") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Geri")
                    }
                },
            )
        },
        bottomBar = {
            Surface(
                modifier = Modifier.windowInsetsPadding(WindowInsets.navigationBars),
                shadowElevation = 8.dp,
            ) {
                Column(
                    Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Button(
                        onClick = {
                            onSubmit(draft.id, selectedDiscounts.associateWith { true }, selectedPromotion)
                        },
                        enabled = draft.state == "draft" && !state.loading && draft.lines.isNotEmpty()
                            && state.quote?.quoteStatus == "accepted",
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Text(if (isHotSale) "Satış faturasını gönder / kaydet" else "Siparişi gönder / kaydet")
                    }
                    if (state.loading) LoadingRow()
                }
            }
        },
    ) { padding ->
        LazyColumn(
            Modifier.fillMaxSize().padding(padding),
            contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            item {
                Text(
                    if (isHotSale) stringResource(R.string.invoice_preview) else "Sipariş ön izlemesi",
                    style = MaterialTheme.typography.labelLarge,
                    color = MaterialTheme.colorScheme.primary,
                )
                Text(if (isHotSale) "Satış faturası" else "Sipariş", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
            }
            item {
                Card(shape = RoundedCornerShape(16.dp)) {
                    Column(Modifier.fillMaxWidth().padding(14.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                        Text(stringResource(R.string.customer_code) + ": ${customer?.code ?: draft.customerCode}", style = MaterialTheme.typography.labelMedium)
                        Text(customer?.name ?: draft.customerName, fontWeight = FontWeight.Bold)
                        customer?.title?.let { InfoLine(stringResource(R.string.company_title), it) }
                        customer?.taxOffice?.let { InfoLine(stringResource(R.string.tax_office), it) }
                        customer?.taxNo?.let { InfoLine(stringResource(R.string.tax_number), it) }
                        customer?.tckn?.takeIf(String::isNotBlank)?.let { InfoLine("TCKN", it) }
                        customer?.address?.let { InfoLine(stringResource(R.string.address), it) }
                        customer?.phone?.let { InfoLine(stringResource(R.string.phone), it) }
                    }
                }
            }
            item {
                Text(stringResource(R.string.product_line_items), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            }
            item {
                Card(shape = RoundedCornerShape(16.dp)) {
                    Column(Modifier.fillMaxWidth().padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text("Cari / ödeme iskontoları", fontWeight = FontWeight.Bold)
                        if (selectedDiscountLabels.isEmpty()) {
                            Text("İskonto seçilmedi.", color = MaterialTheme.colorScheme.onSurfaceVariant)
                        } else {
                            selectedDiscountLabels.forEach { (key, label) ->
                                val rate = state.salesContext?.discountRates?.get(key) ?: 0.0
                                Text("$label · %$rate")
                            }
                        }
                    }
                }
            }
            val quoteLines = state.quote?.result?.get("lines")?.let {
                runCatching { it.jsonArray }.getOrNull()
            }.orEmpty()
            val promotionalQuoteLines = quoteLines.map { it.jsonObject }.filter {
                it["priceSource"]?.jsonPrimitive?.contentOrNull == "PROMOTION_FREE_GOODS"
            }
            items(draft.lines, key = { it.id }) { line ->
                val product = state.products.firstOrNull { it.code == line.productCode }
                val productName = product?.name ?: line.productName
                val quoteLine = quoteLines.firstOrNull { element ->
                    val values = element.jsonObject
                    values["productCode"]?.jsonPrimitive?.contentOrNull == line.productCode &&
                        values["unitCode"]?.jsonPrimitive?.contentOrNull == line.unitCode
                }?.jsonObject
                val discountAmount = quoteLine?.get("manualDiscountAmount")?.jsonPrimitive?.doubleOrNull
                    ?: quoteLine?.get("discountAmount")?.jsonPrimitive?.doubleOrNull
                val netAmount = quoteLine?.get("productNetAmount")?.jsonPrimitive?.doubleOrNull
                    ?: quoteLine?.get("netAmount")?.jsonPrimitive?.doubleOrNull
                val priceKey = "${draft.customerCode}::${line.productCode}::${line.unitCode}::$priceDocumentType"
                LaunchedEffect(draft.customerCode, line.productCode, line.unitCode) {
                    onLoadUnitPrice(draft.customerCode, line.productCode, line.unitCode, priceDocumentType)
                }
                val price = state.unitPrices[priceKey]
                Card(shape = RoundedCornerShape(16.dp)) {
                    Column(
                        Modifier.fillMaxWidth().padding(12.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            if (isPieceUnit(line.unitCode)) PieceUnitWarning()
                            Text(
                                productName,
                                fontWeight = FontWeight.SemiBold,
                                color = if (isPieceUnit(line.unitCode)) pieceWarningRed else MaterialTheme.colorScheme.onSurface,
                            )
                        }
                        Text(line.productCode, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Row(
                            Modifier.fillMaxWidth(),
                            verticalAlignment = Alignment.Top,
                            horizontalArrangement = Arrangement.spacedBy(12.dp),
                        ) {
                            ProductImagePlaceholder(product?.imageDataUrl)
                            Row(
                                Modifier.weight(1f),
                                verticalAlignment = Alignment.Top,
                                horizontalArrangement = Arrangement.spacedBy(6.dp),
                            ) {
                                InvoiceCell(
                                    stringResource(R.string.invoice_quantity),
                                    quantityLabel(line.quantity),
                                    Modifier.weight(0.8f),
                                )
                                InvoiceCell(stringResource(R.string.invoice_unit), line.unitCode, Modifier.weight(0.8f))
                                InvoiceCell("İsk.", discountAmount?.let(::money) ?: "—", Modifier.weight(1f))
                                InvoiceCell(
                                    stringResource(R.string.invoice_net_amount),
                                    netAmount?.let(::money) ?: "—",
                                    Modifier.weight(1.2f),
                                    emphasized = true,
                                )
                            }
                        }
                        Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                            val representativeDiscountPercent =
                                quoteLine?.get("appliedManualDiscountPercent")?.jsonPrimitive?.doubleOrNull
                            val representativeDiscountAmount =
                                quoteLine?.get("manualDiscountAmount")?.jsonPrimitive?.doubleOrNull
                            if (representativeDiscountPercent != null && representativeDiscountPercent > 0.0
                                && representativeDiscountAmount != null) {
                                Text(
                                    "Temsilci iskontosu · %${quantityLabel(representativeDiscountPercent)} " +
                                        "(${money(representativeDiscountAmount)})",
                                    style = MaterialTheme.typography.bodySmall,
                                    fontWeight = FontWeight.SemiBold,
                                )
                            }
                        }
                        when {
                            price != null -> {
                                Text("Birim fiyatı · ${money(price.unitPrice)}")
                                if (quoteLine == null) {
                                    Text("Brüt satır tutarı · ${money(price.unitPrice * line.quantity)}")
                                }
                            }
                            priceKey in state.loadingUnitPrices -> Text("Fiyat yükleniyor…")
                            else -> Text(
                                state.unitPriceErrors[priceKey] ?: "Fiyat alınamadı",
                                color = MaterialTheme.colorScheme.error,
                            )
                        }
                    }
                }
            }
            items(
                promotionalQuoteLines,
                key = { "invoice-promotion-${it.stringValue("promotionCode")}-${it.stringValue("productCode")}" },
            ) { line ->
                PromotionalGiftLineCard(line)
            }
            if (state.quote?.quoteStatus == "promotion_selection_required") {
                item { Text("Uygulanacak promosyonu seçin", fontWeight = FontWeight.Bold) }
                val promotionChoices = state.quote?.result?.get("promotions")?.let {
                    runCatching { it.jsonArray }.getOrNull()
                }.orEmpty()
                items(promotionChoices) { option ->
                    val promotion = option.jsonObject
                    val id = promotion["id"]?.jsonPrimitive?.contentOrNull.orEmpty()
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        RadioButton(
                            selected = selectedPromotion == id,
                            onClick = { onSaleSelectionsChanged(draft.id, selectedDiscounts, id) },
                        )
                        Text("${promotion["code"]?.jsonPrimitive?.contentOrNull.orEmpty()} · " +
                            promotion["name"]?.jsonPrimitive?.contentOrNull.orEmpty())
                    }
                }
            }
            state.quote?.let { item { QuoteCard(it, state.mockMode, state.products) } }
            state.error?.let { item { InlineError(it) } }
        }
    }
}

@Composable
private fun InvoiceCell(label: String, value: String, modifier: Modifier, emphasized: Boolean = false) {
    Column(modifier, verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(label, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(value, style = MaterialTheme.typography.bodySmall, fontWeight = if (emphasized) FontWeight.Bold else FontWeight.Medium)
    }
}

@Composable
private fun PromotionalGiftLineCard(line: JsonObject) {
        val quantity = line["quantity"]?.jsonPrimitive?.doubleOrNull ?: 0.0
        val promotionValue = line["promotionAmount"]?.jsonPrimitive?.doubleOrNull ?: 0.0
        Card(
            shape = RoundedCornerShape(16.dp),
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.secondaryContainer),
        ) {
            Column(
                Modifier.fillMaxWidth().padding(12.dp),
                verticalArrangement = Arrangement.spacedBy(5.dp),
            ) {
                Text("BEDELSİZ · PROMOSYON", style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Bold)
                Text(line.stringValue("productName"), fontWeight = FontWeight.SemiBold)
                Text(line.stringValue("productCode"), style = MaterialTheme.typography.labelSmall)
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Text("${quantityLabel(quantity)} ${line.stringValue("unitCode")}")
                    Text("Fatura tutarı: ${money(0.0)}", fontWeight = FontWeight.Bold)
                }
                Text(
                    "${line.stringValue("promotionCode")} · Promosyon değeri ${money(promotionValue)}",
                    style = MaterialTheme.typography.bodySmall,
                )
        }
    }
}

@Composable
private fun ProductImagePlaceholder(
    imageDataUrl: String? = null,
    modifier: Modifier = Modifier.size(58.dp),
) {
    val bitmap = remember(imageDataUrl) {
        imageDataUrl?.substringAfter(',', missingDelimiterValue = "")
            ?.takeIf(String::isNotBlank)
            ?.let { encoded ->
                runCatching {
                    val bytes = Base64.decode(encoded, Base64.DEFAULT)
                    BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
                }.getOrNull()
            }
    }
    Surface(
        modifier = modifier,
        shape = RoundedCornerShape(12.dp),
        color = MaterialTheme.colorScheme.surfaceVariant,
    ) {
        if (bitmap != null) {
            Image(
                bitmap = bitmap.asImageBitmap(),
                contentDescription = "Ürün görseli",
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize(),
            )
        } else {
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center,
            ) {
                Icon(Icons.Default.Inventory2, contentDescription = "Ürün görsel alanı", tint = MaterialTheme.colorScheme.primary)
                Text("Görsel", style = MaterialTheme.typography.labelSmall)
            }
        }
    }
}

@Composable
private fun HotSaleProductPickerCard(product: ProductSummary, onClick: () -> Unit) {
    Card(
        modifier = Modifier.fillMaxWidth().clickable(onClick = onClick),
        shape = RoundedCornerShape(14.dp),
    ) {
        Row(
            Modifier.fillMaxWidth().padding(14.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            ProductImagePlaceholder(product.imageDataUrl)
            Column(Modifier.weight(1f)) {
                Text(product.name, fontWeight = FontWeight.SemiBold)
                Text(product.code, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Text("Seç", color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.SemiBold)
        }
    }
}

@Composable
private fun HotSaleLineSummary(
    product: ProductSummary,
    quantity: Double,
    unit: String,
    discountPercent: Double,
    amount: Double?,
    enabled: Boolean,
    onClick: () -> Unit,
    onDelete: () -> Unit,
) {
    val dismissState = rememberSwipeToDismissBoxState(
        positionalThreshold = { distance -> distance * 0.5f },
        confirmValueChange = { value ->
            if (value == SwipeToDismissBoxValue.StartToEnd && enabled) onDelete()
            false
        },
    )
    SwipeToDismissBox(
        state = dismissState,
        enableDismissFromStartToEnd = enabled,
        enableDismissFromEndToStart = false,
        gesturesEnabled = enabled,
        backgroundContent = {
            if (dismissState.dismissDirection == SwipeToDismissBoxValue.StartToEnd) {
                Box(
                    Modifier.fillMaxSize()
                        .background(MaterialTheme.colorScheme.errorContainer, RoundedCornerShape(14.dp))
                        .padding(horizontal = 20.dp),
                    contentAlignment = Alignment.CenterStart,
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Icon(Icons.Default.Delete, contentDescription = null, tint = MaterialTheme.colorScheme.onErrorContainer)
                        Text(stringResource(R.string.swipe_to_delete), color = MaterialTheme.colorScheme.onErrorContainer)
                    }
                }
            }
        },
        content = {
            Card(
                modifier = Modifier.fillMaxWidth().clickable(enabled = enabled, onClick = onClick),
                shape = RoundedCornerShape(14.dp),
            ) {
                Column(
                    Modifier.fillMaxWidth().padding(14.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        if (isPieceUnit(unit)) PieceUnitWarning()
                        Text(
                            product.name,
                            fontWeight = FontWeight.SemiBold,
                            color = if (isPieceUnit(unit)) pieceWarningRed else MaterialTheme.colorScheme.onSurface,
                        )
                    }
                    Row(
                        Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        InvoiceCell("Miktar", quantityLabel(quantity), Modifier.weight(1f))
                        InvoiceCell("Birim", unit, Modifier.weight(0.9f))
                        InvoiceCell("İskonto", "%${quantityLabel(discountPercent)}", Modifier.weight(1f))
                        InvoiceCell("Tutar", amount?.let(::money) ?: "…", Modifier.weight(1.2f), emphasized = true)
                    }
                }
            }
        },
    )
}

@Composable
private fun HotSaleStockInfo(
    productName: String,
    unit: String,
    result: HotSaleStockCheck?,
    sourceLabel: String?,
    loading: Boolean,
    error: String?,
) {
    Column(Modifier.fillMaxWidth().testTag("hot-sale-stock-info"), verticalArrangement = Arrangement.spacedBy(2.dp)) {
        val available = when (result) {
            is HotSaleStockCheck.Allowed -> result.availableInUnit
            is HotSaleStockCheck.Exceeds -> result.availableInUnit
            HotSaleStockCheck.NoStock -> 0.0
            else -> null
        }
        when {
            available != null -> Text(
                "Araç stoğu: ${HotSaleStockRules.formatQuantity(available)} $unit",
                fontWeight = FontWeight.SemiBold,
                color = if (result is HotSaleStockCheck.Allowed) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.error,
            )
            loading -> Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
                Text("Araç stoğu alınıyor…", style = MaterialTheme.typography.bodySmall)
            }
        }
        sourceLabel?.let { Text(it, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
        if (result != null && result !is HotSaleStockCheck.Allowed && !(loading && result == HotSaleStockCheck.UnknownStock)) {
            Text(
                HotSaleStockRules.message(productName, unit, result).orEmpty(),
                color = MaterialTheme.colorScheme.error,
                style = MaterialTheme.typography.bodySmall,
            )
        }
        if (result == HotSaleStockCheck.UnknownStock && error != null && !loading) {
            Text(error, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
        }
    }
}

@Composable
internal fun HotSaleLineEditorDialog(
    product: ProductSummary,
    existingLine: DraftLineSummary?,
    customerCode: String,
    enabled: Boolean,
    unitPrices: Map<String, UnitPriceSummary>,
    loadingUnitPrices: Set<String>,
    unitPriceErrors: Map<String, String>,
    error: String?,
    onLoadUnitPrice: (String) -> Unit,
    onDismiss: () -> Unit,
    onSave: (String, Double, Double) -> Unit,
    stockCheck: ((String, Double) -> HotSaleStockCheck?)? = null,
    stockSourceLabel: String? = null,
    stockLoading: Boolean = false,
    stockError: String? = null,
) {
    var expanded by remember(product.code, existingLine?.id) { mutableStateOf(false) }
    var selectedUnit by rememberSaveable(product.code, existingLine?.id) {
        mutableStateOf(existingLine?.unitCode ?: product.unit)
    }
    var quantity by rememberSaveable(product.code, existingLine?.id) {
        mutableStateOf(existingLine?.quantity ?: 1.0)
    }
    var discountText by rememberSaveable(product.code, existingLine?.id) {
        mutableStateOf(
            existingLine?.manualDiscountPercent?.takeIf { it > 0.0 }?.let(::quantityLabel).orEmpty(),
        )
    }
    var confirmPieceUnit by rememberSaveable(product.code, existingLine?.id) { mutableStateOf(false) }
    LaunchedEffect(customerCode, product.code, selectedUnit) { onLoadUnitPrice(selectedUnit) }
    val priceKey = "$customerCode::${product.code}::$selectedUnit::van_sale"
    val unitPrice = unitPrices[priceKey]
    val discountPercent = if (discountText.isBlank()) 0.0 else discountText.replace(',', '.').toDoubleOrNull()
    val validDiscount = discountPercent != null && discountPercent in 0.0..100.0
    val stockResult = stockCheck?.invoke(selectedUnit, quantity)
    val nextStockResult = stockCheck?.invoke(selectedUnit, quantity + 1.0)
    val stockAllows = stockCheck == null || stockResult is HotSaleStockCheck.Allowed
    val canSave = enabled && unitPrice != null && quantity >= 1.0 && validDiscount && stockAllows
    val units = (product.units + product.unit).filter(String::isNotBlank).distinct()

    Dialog(
        onDismissRequest = { if (enabled) onDismiss() },
        properties = DialogProperties(usePlatformDefaultWidth = false),
    ) {
        Surface(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp),
            shape = RoundedCornerShape(20.dp),
            color = Color.White,
            shadowElevation = 12.dp,
        ) {
            Column(
                Modifier.fillMaxWidth().padding(20.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                ProductImagePlaceholder(
                    imageDataUrl = product.imageDataUrl,
                    modifier = Modifier.fillMaxWidth().height(150.dp),
                )
                Text(product.name, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                if (isPieceUnit(selectedUnit)) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        PieceUnitWarning()
                        Text(stringResource(R.string.piece_unit_warning), color = pieceWarningRed)
                    }
                }
                Row(
                    Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    Box(Modifier.weight(1f)) {
                        OutlinedButton(
                            onClick = { expanded = true },
                            enabled = enabled,
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Text("Birim: $selectedUnit")
                        }
                        DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
                            units.forEach { unit ->
                                DropdownMenuItem(
                                    text = { Text(unit) },
                                    onClick = {
                                        selectedUnit = unit
                                        expanded = false
                                        onLoadUnitPrice(unit)
                                    },
                                )
                            }
                        }
                    }
                    Column(Modifier.weight(1f)) {
                        Text("Birim fiyatı", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        when {
                            unitPrice != null -> Text("${money(unitPrice.unitPrice)} TL", fontWeight = FontWeight.SemiBold)
                            priceKey in loadingUnitPrices -> CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
                            else -> Text("Fiyat alınamadı", color = MaterialTheme.colorScheme.error)
                        }
                    }
                }
                if (stockCheck != null) {
                    HotSaleStockInfo(
                        productName = product.name,
                        unit = selectedUnit,
                        result = stockResult,
                        sourceLabel = stockSourceLabel,
                        loading = stockLoading,
                        error = stockError,
                    )
                }
                unitPriceErrors[priceKey]?.let {
                    Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
                }
                Row(
                    Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween,
                ) {
                    Text("Adet", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        OutlinedButton(onClick = { quantity = (quantity - 1.0).coerceAtLeast(1.0) }, enabled = enabled && quantity > 1.0) {
                            Text("−")
                        }
                        Text(quantityLabel(quantity), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                        Button(
                            onClick = { quantity += 1.0 },
                            enabled = enabled && (stockCheck == null || nextStockResult is HotSaleStockCheck.Allowed),
                        ) { Text("+") }
                    }
                }
                OutlinedTextField(
                    value = discountText,
                    onValueChange = { value ->
                        if (value.matches(Regex("^\\d{0,3}([.,]\\d{0,2})?$"))) discountText = value
                    },
                    label = { Text(stringResource(R.string.manual_discount_percent)) },
                    suffix = { Text("%") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                    singleLine = true,
                    enabled = enabled,
                    modifier = Modifier.fillMaxWidth(),
                )
                if (!validDiscount) {
                    Text("İskonto %0 ile %100 arasında olmalıdır.", color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
                }
                error?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
                Row(
                    Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    OutlinedButton(onClick = onDismiss, enabled = enabled) { Text("Vazgeç") }
                    Button(
                        onClick = {
                            if (isPieceUnit(selectedUnit)) confirmPieceUnit = true
                            else onSave(selectedUnit, quantity, discountPercent ?: 0.0)
                        },
                        enabled = canSave,
                    ) {
                        if (!enabled) {
                            CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                            Spacer(Modifier.width(8.dp))
                        }
                        Text(if (existingLine == null) stringResource(R.string.add_product) else "Güncelle")
                    }
                }
                if (confirmPieceUnit) {
                    AlertDialog(
                        onDismissRequest = { confirmPieceUnit = false },
                        icon = { PieceUnitWarning() },
                        title = { Text(stringResource(R.string.piece_unit_confirmation_title)) },
                        text = { Text(stringResource(R.string.piece_unit_confirmation, product.name)) },
                        confirmButton = {
                            TextButton(
                                enabled = canSave,
                                onClick = {
                                    confirmPieceUnit = false
                                    onSave(selectedUnit, quantity, discountPercent ?: 0.0)
                                },
                            ) { Text(stringResource(R.string.piece_unit_confirm)) }
                        },
                        dismissButton = {
                            TextButton(onClick = { confirmPieceUnit = false }) { Text(stringResource(R.string.cancel)) }
                        },
                    )
                }
            }
        }
    }
}

@Composable
private fun ProductPickerCard(
    product: ProductSummary,
    customerCode: String,
    documentType: String,
    enabled: Boolean,
    unitPrices: Map<String, UnitPriceSummary>,
    loadingUnitPrices: Set<String>,
    unitPriceErrors: Map<String, String>,
    onLoadUnitPrice: (String) -> Unit,
    onAdd: (String) -> Unit,
) {
    var expanded by remember(product.code) { mutableStateOf(false) }
    var selectedUnit by remember(product.code, product.units) { mutableStateOf(product.unit) }
    LaunchedEffect(customerCode, documentType, selectedUnit) { onLoadUnitPrice(selectedUnit) }
    val unitPriceKey = "$customerCode::${product.code}::$selectedUnit::$documentType"
    val unitPrice = unitPrices[unitPriceKey]
    val unitPriceLoading = unitPriceKey in loadingUnitPrices
    val unitPriceError = unitPriceErrors[unitPriceKey]
    Card(shape = RoundedCornerShape(14.dp)) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                ProductImagePlaceholder(product.imageDataUrl)
                Spacer(Modifier.width(10.dp))
                Column(Modifier.weight(1f)) {
                    Text(product.name, fontWeight = FontWeight.SemiBold)
                    Text(product.code, style = MaterialTheme.typography.bodySmall)
                }
                Column(horizontalAlignment = Alignment.End) {
                    Text("Fiyat / $selectedUnit", style = MaterialTheme.typography.labelSmall)
                    when {
                        unitPrice != null -> Column(horizontalAlignment = Alignment.End) {
                            Text(
                                stringResource(R.string.vat_exclusive_price, money(unitPrice.unitPrice)),
                                fontWeight = FontWeight.SemiBold,
                            )
                            if (unitPrice.innerQuantity != 1.0) {
                                Text(
                                    "${quantityLabel(unitPrice.innerQuantity)} × ${money(unitPrice.baseUnitPrice)}",
                                    style = MaterialTheme.typography.labelSmall,
                                )
                            }
                        }
                        unitPriceLoading -> CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                        unitPriceError != null -> Text("Fiyat alınamadı", color = MaterialTheme.colorScheme.error)
                        else -> Text(stringResource(R.string.not_orderable), color = MaterialTheme.colorScheme.error)
                    }
                }
            }
            unitPriceError?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Box {
                    OutlinedButton(onClick = { expanded = true }, enabled = enabled) { Text(selectedUnit.ifBlank { product.unit }) }
                    DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
                        product.units.forEach { unit ->
                            DropdownMenuItem(
                                text = { Text(unit) },
                                onClick = {
                                    selectedUnit = unit
                                    expanded = false
                                    onLoadUnitPrice(unit)
                                },
                            )
                        }
                    }
                }
                Spacer(Modifier.weight(1f))
                Button(onClick = { onAdd(selectedUnit) }, enabled = enabled) {
                    Icon(Icons.Default.ShoppingCart, contentDescription = null)
                    Spacer(Modifier.width(6.dp))
                    Text(stringResource(R.string.add_product))
                }
            }
        }
    }
}

@Composable
private fun DraftLineCard(
    product: ProductSummary,
    quantity: Double,
    unit: String,
    unitPrice: UnitPriceSummary?,
    unitPriceLoading: Boolean,
    unitPriceError: String?,
    manualDiscountPercent: Double,
    enabled: Boolean,
    automaticDiscount: Boolean = false,
    onChange: (Double) -> Unit,
    discountEnabled: Boolean,
    onChangeDiscount: (Double) -> Unit,
) {
    var discountText by rememberSaveable(product.code, unit) {
        mutableStateOf(if (manualDiscountPercent == 0.0) "" else manualDiscountPercent.toString())
    }
    LaunchedEffect(discountText, manualDiscountPercent, automaticDiscount, enabled) {
        if (!automaticDiscount || !enabled) return@LaunchedEffect
        delay(350)
        val parsedDiscount = discountText.replace(',', '.').toDoubleOrNull()
        val requestedDiscount = if (discountText.isBlank()) 0.0 else parsedDiscount
        if (requestedDiscount != null && requestedDiscount in 0.0..100.0
            && requestedDiscount != manualDiscountPercent) {
            onChangeDiscount(requestedDiscount)
        }
    }
    Card(shape = RoundedCornerShape(14.dp)) {
        Column(Modifier.fillMaxWidth().padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                ProductImagePlaceholder(product.imageDataUrl)
                Column(Modifier.weight(1f)) {
                    Text(product.name, fontWeight = FontWeight.SemiBold)
                    Text("$quantity $unit", style = MaterialTheme.typography.bodySmall)
                    unitPrice?.let {
                        Text("Birim fiyatı: ${money(it.unitPrice)}", style = MaterialTheme.typography.bodySmall)
                        if (it.innerQuantity != 1.0) {
                            Text(
                                "Kutu içi ${quantityLabel(it.innerQuantity)} × ${money(it.baseUnitPrice)}",
                                style = MaterialTheme.typography.bodySmall,
                            )
                        }
                        Text("Satır toplamı: ${money(it.unitPrice * quantity)}", fontWeight = FontWeight.SemiBold)
                    }
                    if (unitPrice == null && unitPriceLoading) Text("Birim fiyatı yükleniyor…", style = MaterialTheme.typography.bodySmall)
                    unitPriceError?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
                }
                OutlinedButton(onClick = { onChange(-1.0) }, enabled = enabled) { Text("−") }
                Text(quantity.toString(), fontWeight = FontWeight.Bold)
                Button(onClick = { onChange(1.0) }, enabled = enabled) { Text("+") }
            }
            if (discountEnabled) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    OutlinedTextField(
                        value = discountText,
                        onValueChange = { value ->
                            if (value.matches(Regex("^\\d{0,3}([.,]\\d{0,2})?$"))) discountText = value
                        },
                        label = { Text(stringResource(R.string.manual_discount_percent)) },
                        suffix = { Text("%") },
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                        singleLine = true,
                        enabled = enabled,
                        modifier = Modifier.weight(1f).onFocusChanged { focus ->
                            if (focus.isFocused && discountText.replace(',', '.').toDoubleOrNull() == 0.0) {
                                discountText = ""
                            }
                        },
                    )
                    if (!automaticDiscount) {
                        Button(
                            onClick = {
                                onChangeDiscount(discountText.replace(',', '.').toDoubleOrNull() ?: 0.0)
                            },
                            enabled = enabled && (discountText.isBlank()
                                || discountText.replace(',', '.').toDoubleOrNull()?.let { it in 0.0..100.0 } == true),
                        ) {
                            Text(stringResource(R.string.apply_discount))
                        }
                    }
                }
                if (automaticDiscount) {
                    Text("Temsilci iskontosu yazıldıkça otomatik uygulanır.", style = MaterialTheme.typography.bodySmall)
                }
            }
        }
    }
}

@Composable
internal fun QuoteCard(
    quote: com.vdgida.vdesgo.sales.data.QuoteResponse,
    mock: Boolean,
    products: List<ProductSummary>,
) {
    Card(
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer),
        shape = RoundedCornerShape(16.dp),
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(
                stringResource(if (mock) R.string.quote_mock_note else R.string.quote_authoritative_note),
                fontWeight = FontWeight.Bold,
            )
            if (quote.quoteStatus == "requires_approval") {
                Text(stringResource(R.string.discount_approval_required), color = MaterialTheme.colorScheme.error)
            }
            val result = quote.result
            if (result != null) {
                val subtotal = result["basketTotal"]?.jsonPrimitive?.doubleOrNull
                    ?: result["subtotal"]?.jsonPrimitive?.doubleOrNull
                val productDiscount = result["productDiscountTotal"]?.jsonPrimitive?.doubleOrNull
                    ?: result["discountTotal"]?.jsonPrimitive?.doubleOrNull
                val customerDiscount = result["customerDiscountTotal"]?.jsonPrimitive?.doubleOrNull
                val freeGoodsTotal = result["freeGoodsTotal"]?.jsonPrimitive?.doubleOrNull ?: 0.0
                val promotionDiscount = result["promotionDiscountTotal"]?.jsonPrimitive?.doubleOrNull
                    ?: result["promotionTotal"]?.jsonPrimitive?.doubleOrNull
                val paymentDiscount = result["paymentDiscountTotal"]?.jsonPrimitive?.doubleOrNull
                val totalDiscount = result["totalDiscount"]?.jsonPrimitive?.doubleOrNull
                val ePointDiscount = result["ePointDiscountTotal"]?.jsonPrimitive?.doubleOrNull ?: 0.0
                val netTotal = result["netTotal"]?.jsonPrimitive?.doubleOrNull
                val grandTotal = result["grandTotal"]?.jsonPrimitive?.doubleOrNull

                if (grandTotal != null) {
                    Text("Fatura Alt Bilgileri", fontWeight = FontWeight.Bold)
                    paymentDiscount?.let { QuoteAmountLine("Ödeme İndirimi", it) }
                    customerDiscount?.let { QuoteAmountLine("Müşteri İndirimi", it) }
                    productDiscount?.let { QuoteAmountLine("Ürün İndirimi", it) }
                    if (promotionDiscount != null && promotionDiscount > 0.0) {
                        QuoteAmountLine("Promosyon İndirimi", promotionDiscount)
                    }
                    QuoteAmountLine("Bedelsiz Ürün", freeGoodsTotal)
                    QuoteAmountLine("E-Puan İndirimi", ePointDiscount)
                    subtotal?.let { QuoteAmountLine("Sepet Toplamı", it) }
                    totalDiscount?.let { QuoteAmountLine("Toplam İndirim", it, emphasized = true) }
                    netTotal?.let { QuoteAmountLine("Ara Toplam", it, emphasized = true) }
                    val vatAmounts = (result["vatBreakdown"] as? kotlinx.serialization.json.JsonArray)
                        .orEmpty().mapNotNull { entry ->
                            val vat = entry as? JsonObject ?: return@mapNotNull null
                            val rate = vat["rate"]?.jsonPrimitive?.doubleOrNull ?: return@mapNotNull null
                            val amount = vat["amount"]?.jsonPrimitive?.doubleOrNull ?: return@mapNotNull null
                            rate to amount
                        }.toMap()
                    val standardVatRates = listOf(1.0, 10.0, 20.0)
                    (standardVatRates + vatAmounts.keys.filterNot(standardVatRates::contains).sorted()).forEach { rate ->
                        QuoteAmountLine("KDV %${quantityLabel(rate)}", vatAmounts[rate] ?: 0.0)
                    }
                    QuoteAmountLine("Genel Toplam", grandTotal, emphasized = true)

                    val quotedLines = (result["lines"] as? kotlinx.serialization.json.JsonArray).orEmpty()
                        .mapNotNull { it as? JsonObject }
                    val productsByCode = products.associateBy(ProductSummary::code)
                    var totalWeightGrams = 0.0
                    var hasWeight = false
                    var totalVolumeLiters = 0.0
                    var hasVolume = false
                    var totalEPoints = 0.0
                    var hasEPoints = false
                    var totalItems = 0.0
                    quotedLines.forEach { line ->
                        val quantity = line["totalQuantity"]?.jsonPrimitive?.contentOrNull
                            ?.replace(',', '.')?.toDoubleOrNull()
                            ?: line["quantity"]?.jsonPrimitive?.doubleOrNull ?: 0.0
                        totalItems += quantity
                        val product = productsByCode[line.stringValue("productCode")] ?: return@forEach
                        product.weight?.let(::parseMeasure)?.let { (value, unit) ->
                            val grams = when (unit.lowercase(Locale.ROOT)) {
                                "mg" -> value / 1_000.0
                                "g", "gr", "gram", "grams" -> value
                                "kg", "kgs" -> value * 1_000.0
                                else -> null
                            }
                            if (grams != null) {
                                totalWeightGrams += grams * quantity
                                hasWeight = true
                            }
                        }
                        product.volume?.let(::parseMeasure)?.let { (value, unit) ->
                            val liters = when (unit.lowercase(Locale.ROOT)) {
                                "ml", "cc" -> value / 1_000.0
                                "l", "lt", "liter", "litre" -> value
                                else -> null
                            }
                            if (liters != null) {
                                totalVolumeLiters += liters * quantity
                                hasVolume = true
                            }
                        }
                        product.ePoint?.replace(',', '.')?.toDoubleOrNull()?.let { points ->
                            totalEPoints += points * quantity
                            hasEPoints = true
                        }
                    }
                    HorizontalDivider()
                    val productCount = quotedLines.mapNotNull { it.stringValue("productCode") }.distinct().size
                    if (productCount != 0) QuoteAmountLine("Toplam Çeşit", productCount.toString())
                    if (totalItems != 0.0) QuoteAmountLine("Toplam Kalem", quantityLabel(totalItems))
                    if (hasWeight && hasVisibleAmount(totalWeightGrams)) QuoteAmountLine(
                        "Toplam Ağırlık",
                        "${measureNumber(if (totalWeightGrams >= 1_000.0) totalWeightGrams / 1_000.0 else totalWeightGrams)} " +
                            if (totalWeightGrams >= 1_000.0) "kg" else "g",
                    )
                    if (hasVolume && hasVisibleAmount(totalVolumeLiters)) QuoteAmountLine(
                        "Toplam Hacim",
                        "${measureNumber(totalVolumeLiters)} L",
                    )
                    if (hasEPoints && totalEPoints != 0.0) QuoteAmountLine("Toplam E-Puan", quantityLabel(totalEPoints))
                } else if (quote.quoteStatus == "conflict") {
                    Text("Fiyatlar değişti; devam etmeden önce yeniden hesaplayın.")
                }
            }
            if (result == null) Text(stringResource(R.string.error_generic))
        }
    }
}

private fun JsonObject.stringValue(key: String): String =
    this[key]?.jsonPrimitive?.contentOrNull.orEmpty()

private fun parseMeasure(value: String): Pair<Double, String>? {
    val match = Regex("^\\s*(\\d+(?:[.,]\\d+)?)\\s*([a-zA-Z]+)\\s*$").matchEntire(value)
        ?: return null
    val amount = match.groupValues[1].replace(',', '.').toDoubleOrNull() ?: return null
    return amount to match.groupValues[2]
}

private fun measureNumber(value: Double): String =
    String.format(Locale("tr", "TR"), "%.2f", value)

@Composable
private fun QuoteAmountLine(label: String, amount: Double, emphasized: Boolean = false) {
    if (!hasVisibleAmount(amount)) return
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(label, fontWeight = if (emphasized) FontWeight.Bold else FontWeight.Normal)
        Text(money(amount), fontWeight = if (emphasized) FontWeight.Bold else FontWeight.Normal)
    }
}

@Composable
private fun QuoteAmountLine(label: String, amount: String) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(label)
        Text(amount)
    }
}

@Composable
@OptIn(ExperimentalMaterial3Api::class)
private fun SalesContent(
    state: MobileUiState,
    viewModel: AppViewModel,
    onOpenDraft: (String) -> Unit,
    onEditSale: (String, String) -> Unit,
) {
    val context = LocalContext.current
    val printNumbers = remember(context, state.session?.tenantCode, state.session?.representativeId) {
        PrintNumberStore(context, state.session?.tenantCode.orEmpty(), state.session?.representativeId.orEmpty())
    }
    var printTarget by remember { mutableStateOf<OperationSummary?>(null) }
    var printNumber by rememberSaveable { mutableStateOf("") }
    var printError by remember { mutableStateOf<String?>(null) }
    var printNumberRevision by remember { mutableStateOf(0) }
    var deleteTarget by remember { mutableStateOf<OperationSummary?>(null) }
    var cancelTarget by remember { mutableStateOf<OperationSummary?>(null) }
    var numberlessPrintTarget by remember { mutableStateOf<OperationSummary?>(null) }
    val documentOperations = state.operations.filter {
        it.type in setOf("order.submit", "sale.submit") && isToday(it.createdAt)
    }
    val canDelete = "mobile.order.create" in state.session?.capabilities.orEmpty()
    LaunchedEffect(documentOperations) {
        documentOperations
            .filter { it.type == "sale.submit" && it.printedAt == null }
            .forEach { operation ->
                val oldPrintNumber = printNumbers.numberFor(operation.id)
                if (oldPrintNumber.isNotBlank()) {
                    viewModel.markDocumentPrinted(operation.id, oldPrintNumber)
                }
            }
    }
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        item {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(stringResource(R.string.sales), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
                TextButton(onClick = viewModel::refresh) { Text(stringResource(R.string.sync_now)) }
            }
        }
        state.error?.let { message -> item { InlineError(message) } }
        printError?.let { message -> item { InlineError(message) } }
        if (documentOperations.isEmpty()) {
            item { EmptyMessage(stringResource(R.string.no_created_documents)) }
        } else {
            item {
                Text("Sipariş ve satış kayıtları", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            }
        }
        items(documentOperations, key = { "document-${it.id}" }) { operation ->
            val draft = operation.draftId?.let { draftId -> state.drafts.firstOrNull { it.id == draftId } }
            val result = operation.result?.let {
                runCatching { kotlinx.serialization.json.Json.parseToJsonElement(it).jsonObject }.getOrNull()
            }
            val isSale = operation.type == "sale.submit"
            val savedPrintNumber = operation.printNumber
                ?: remember(printNumbers, operation.id, printNumberRevision) { printNumbers.numberFor(operation.id) }
            val isPrinted = isSale && (operation.printedAt != null || !savedPrintNumber.isNullOrBlank())
            val amount = result?.get("grandTotal")?.jsonPrimitive?.doubleOrNull
            SwipeToDeleteDocument(
                canDelete = canDelete && !state.loading && !isPrinted,
                canEdit = canDelete && isSale && !isPrinted && operation.status == OperationUiState.ACCEPTED && !state.loading,
                onDelete = { deleteTarget = operation },
                onEdit = {
                    viewModel.createSaleCorrection(operation) { draftId ->
                        onEditSale(draftId, operation.id)
                    }
                },
            ) {
                Card(shape = RoundedCornerShape(16.dp)) {
                    Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                        Text(
                            if (isSale) stringResource(R.string.document_type_hot_sale) else stringResource(R.string.document_type_order),
                            color = MaterialTheme.colorScheme.primary,
                            fontWeight = FontWeight.Bold,
                        )
                        if (isSale) {
                            Text(
                                stringResource(R.string.print_invoice_number) + ": " +
                                    (savedPrintNumber?.takeIf(String::isNotBlank)
                                        ?: if (isPrinted) stringResource(R.string.printed_without_number) else "—"),
                            )
                        } else {
                            Text(
                                stringResource(R.string.print_order_number) + ": " +
                                    remember(printNumbers, operation.id, printNumberRevision) {
                                        printNumbers.numberFor(operation.id).ifBlank { "—" }
                                    },
                            )
                        }
                        draft?.let { Text(it.customerName, fontWeight = FontWeight.SemiBold) }
                        if (amount != null) Text("Genel toplam · ${money(amount)}", fontWeight = FontWeight.Bold)
                        Text(stringResource(R.string.status_label, stringResource(operation.status.labelResource)))
                        val canPrint = if (isSale) {
                            operation.status in setOf(OperationUiState.PENDING, OperationUiState.RETRY, OperationUiState.ACCEPTED) ||
                                operation.error == "SALE_PRINT_REQUIRED"
                        } else {
                            operation.status == OperationUiState.ACCEPTED
                        }
                        if (canPrint && operation.status != OperationUiState.CANCEL_PENDING
                            && operation.status != OperationUiState.CANCELLED) {
                            Button(
                                onClick = {
                                    printNumber = savedPrintNumber.orEmpty().ifBlank {
                                        printNumbers.suggestion(operation.id, operation.type)
                                    }
                                    printError = null
                                    printTarget = operation
                                },
                                modifier = Modifier.fillMaxWidth(),
                            ) { Text(if (isPrinted) "Yeniden yazdır" else stringResource(R.string.print_document)) }
                        }
                        if (isSale && isPrinted && operation.status != OperationUiState.CANCELLED) {
                            OutlinedButton(
                                onClick = { cancelTarget = operation },
                                enabled = !state.loading,
                                modifier = Modifier.fillMaxWidth(),
                            ) {
                                Text(
                                    if (operation.status == OperationUiState.CANCEL_PENDING) {
                                        stringResource(R.string.status_cancel_pending)
                                    } else {
                                        "İptal et"
                                    },
                                )
                            }
                        }
                        if (operation.status != OperationUiState.ACCEPTED) {
                            OperationCard(operation, draft?.netEstimate) {
                                viewModel.reviewConflict(operation, onOpenDraft)
                            }
                        }
                    }
                }
            }
        }
    }
    printTarget?.let { operation ->
        val isSale = operation.type == "sale.submit"
        val savedNumber = operation.printNumber ?: printNumbers.numberFor(operation.id)
        val numberValid = !isSale || printNumber.isBlank() || isSalePrintNumberValid(printNumber) ||
            (savedNumber.isNotBlank() && printNumber == savedNumber)
        AlertDialog(
            onDismissRequest = { printTarget = null },
            title = {
                Text(stringResource(if (operation.type == "sale.submit") R.string.print_invoice_number else R.string.print_order_number))
            },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text(if (isSale) "3 harf, yıl ve 9 rakam girin. Örnek: ABC2026000000001" else stringResource(R.string.print_number_hint))
                    OutlinedTextField(
                        value = printNumber,
                        onValueChange = { printNumber = if (isSale) it.uppercase(Locale.ROOT).take(16) else it.take(100) },
                        singleLine = true,
                        isError = !numberValid,
                        label = {
                            Text(stringResource(if (operation.type == "sale.submit") R.string.print_invoice_number else R.string.print_order_number))
                        },
                        modifier = Modifier.fillMaxWidth(),
                    )
                    if (!numberValid) Text("Geçerli bir fatura numarası girin.", color = MaterialTheme.colorScheme.error)
                }
            },
            confirmButton = {
                TextButton(
                    enabled = numberValid && (printNumber.isNotBlank() || isSale),
                    onClick = {
                        val number = printNumber.trim()
                        if (operation.type == "sale.submit" && number.isBlank()) {
                            printTarget = null
                            numberlessPrintTarget = operation
                            return@TextButton
                        }
                        printTarget = null
                        DocumentPrinter.printDocument(
                            context = context,
                            operation = operation,
                            draft = operation.draftId?.let { id -> state.drafts.firstOrNull { it.id == id } },
                            representativeName = state.session?.representativeName.orEmpty(),
                            number = number,
                            onQueued = {
                                if (number.isNotBlank()) {
                                    try {
                                        printNumbers.record(operation.id, operation.type, number)
                                        printNumberRevision++
                                    } catch (error: java.io.IOException) {
                                        android.util.Log.e("DocumentPrinter", "Unable to persist print number", error)
                                        printError = error.message
                                    }
                                }
                                viewModel.markDocumentPrinted(operation.id, number)
                            },
                            onError = { message -> printError = message },
                        )
                    },
                ) { Text(stringResource(R.string.print_document)) }
            },
            dismissButton = {
                TextButton(onClick = { printTarget = null }) { Text(stringResource(R.string.cancel)) }
            },
        )
    }
    numberlessPrintTarget?.let { operation ->
        AlertDialog(
            onDismissRequest = { numberlessPrintTarget = null },
            title = { Text(stringResource(R.string.print_invoice_number)) },
            text = { Text(stringResource(R.string.print_numberless_warning)) },
            confirmButton = {
                TextButton(onClick = {
                    numberlessPrintTarget = null
                    DocumentPrinter.printDocument(
                        context = context,
                        operation = operation,
                        draft = operation.draftId?.let { id -> state.drafts.firstOrNull { it.id == id } },
                        representativeName = state.session?.representativeName.orEmpty(),
                        number = "",
                        onQueued = { viewModel.markDocumentPrinted(operation.id, null) },
                        onError = { message -> printError = message },
                    )
                }) { Text(stringResource(R.string.print_numberless_action)) }
            },
            dismissButton = {
                TextButton(onClick = {
                    numberlessPrintTarget = null
                    printTarget = operation
                }) { Text("Fatura numarası gir") }
            },
        )
    }
    deleteTarget?.let { operation ->
        AlertDialog(
            onDismissRequest = { deleteTarget = null },
            title = { Text(stringResource(R.string.delete_document_title)) },
            text = {
                Text(stringResource(R.string.delete_document_confirmation))
            },
            confirmButton = {
                TextButton(
                    enabled = !state.loading,
                    onClick = {
                        deleteTarget = null
                        viewModel.deleteDocument(operation.id)
                    },
                ) {
                    Text(stringResource(R.string.delete_document_yes))
                }
            },
            dismissButton = {
                TextButton(onClick = { deleteTarget = null }) {
                    Text(stringResource(R.string.delete_document_no))
                }
            },
        )
    }
    cancelTarget?.let { operation ->
        AlertDialog(
            onDismissRequest = { cancelTarget = null },
            title = { Text(stringResource(R.string.cancel_document_title)) },
            text = { Text(stringResource(R.string.cancel_document_confirmation)) },
            confirmButton = {
                TextButton(
                    enabled = !state.loading,
                    onClick = {
                        cancelTarget = null
                        viewModel.cancelDocument(operation.id)
                    },
                ) { Text(stringResource(R.string.cancel_document_yes)) }
            },
            dismissButton = {
                TextButton(onClick = { cancelTarget = null }) {
                    Text(stringResource(R.string.delete_document_no))
                }
            },
        )
    }
}

@Composable
@OptIn(ExperimentalMaterial3Api::class)
private fun SwipeToDeleteDocument(
    canDelete: Boolean,
    canEdit: Boolean,
    onDelete: () -> Unit,
    onEdit: () -> Unit,
    content: @Composable () -> Unit,
) {
    val dismissState = rememberSwipeToDismissBoxState(
        positionalThreshold = { distance -> distance * 0.5f },
        confirmValueChange = { value ->
            when (value) {
                SwipeToDismissBoxValue.StartToEnd -> if (canDelete) onDelete()
                SwipeToDismissBoxValue.EndToStart -> if (canEdit) onEdit()
                SwipeToDismissBoxValue.Settled -> Unit
            }
            false
        },
    )
    SwipeToDismissBox(
        state = dismissState,
        enableDismissFromStartToEnd = canDelete,
        enableDismissFromEndToStart = canEdit,
        gesturesEnabled = canEdit || canDelete,
        backgroundContent = {
            val editing = dismissState.dismissDirection == SwipeToDismissBoxValue.EndToStart
            Box(
                Modifier.fillMaxSize()
                    .background(
                        if (editing) MaterialTheme.colorScheme.secondaryContainer else MaterialTheme.colorScheme.errorContainer,
                        RoundedCornerShape(16.dp),
                    )
                    .padding(horizontal = 20.dp),
                contentAlignment = if (editing) Alignment.CenterEnd else Alignment.CenterStart,
            ) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (editing) {
                        Icon(Icons.Default.Edit, contentDescription = null, tint = MaterialTheme.colorScheme.onSecondaryContainer)
                        Text("Düzelt", color = MaterialTheme.colorScheme.onSecondaryContainer)
                    } else {
                        Text(stringResource(R.string.swipe_to_delete), color = MaterialTheme.colorScheme.onErrorContainer)
                        Icon(Icons.Default.Delete, contentDescription = null, tint = MaterialTheme.colorScheme.onErrorContainer)
                    }
                }
            }
        },
        content = { content() },
    )
}

@Composable
private fun OperationCard(operation: OperationSummary, previousTotal: Double?, onReview: () -> Unit) {
    Card(shape = RoundedCornerShape(16.dp)) {
        Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Default.Sync, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
                Spacer(Modifier.width(8.dp))
                Text(stringResource(operation.status.labelResource), fontWeight = FontWeight.Bold)
            }
            when (operation.status) {
                OperationUiState.ACCEPTED -> operation.documentNumber?.let {
                    Text(stringResource(R.string.accepted_order_detail, it))
                } ?: Text(stringResource(R.string.no_erp_order_number))
                OperationUiState.CONFLICT -> {
                    Text(stringResource(R.string.conflict_requires_review))
                    previousTotal?.let { InfoLine(stringResource(R.string.previous_total), money(it)) }
                    operation.result?.let(::conflictGrandTotal)?.let {
                        InfoLine(stringResource(R.string.current_server_total), money(it))
                    }
                    Button(onClick = onReview) { Text(stringResource(R.string.review_conflict)) }
                }
                OperationUiState.APPROVAL -> Text(stringResource(R.string.discount_approval_required))
                OperationUiState.REJECTED -> if (operation.error == "CREDIT_LIMIT_EXCEEDED") {
                    Text(
                        operation.result?.let(::creditLimitRejectionMessage)
                            ?: "Müşteri maksimum borç bakiyesini aşıyor.",
                        color = MaterialTheme.colorScheme.error,
                    )
                    Text(stringResource(R.string.rejection_reason_code, "CREDIT_LIMIT_EXCEEDED"))
                } else {
                    Text(stringResource(
                        when (operation.error) {
                            "SALE_PRINT_REQUIRED" -> R.string.sale_print_required
                            "CUSTOMER_NOT_ASSIGNED" -> R.string.error_customer_access_revoked
                            "VAN_SALES_NOT_CONFIGURED" -> R.string.hot_sale_not_configured
                            "INSUFFICIENT_VEHICLE_STOCK" -> R.string.hot_sale_insufficient_stock
                            "MOBILE_SALES_MIGRATION_REQUIRED" -> R.string.hot_sale_setup_required
                            "WORKDAY_NOT_OPEN" -> R.string.rejection_workday_not_open
                            else -> R.string.rejected_notice
                        },
                    ))
                    operation.error?.takeIf { it.isNotBlank() }?.let {
                        Text(stringResource(R.string.rejection_reason_code, it))
                    }
                    if (operation.error == "WORKDAY_NOT_OPEN" && operation.draftId != null) {
                        Button(onClick = onReview) {
                            Text(stringResource(R.string.reopen_rejected_draft))
                        }
                    }
                }
                OperationUiState.RETRY -> Text(
                    if (operation.error == com.vdgida.vdesgo.sales.data.SYNC_CANCELLED_UNCONFIRMED) {
                        "Gönderim iptal edildi; sunucu sonucu bir sonraki eşitlemede doğrulanacak. Kayıt geri alınmadı."
                    } else {
                        stringResource(R.string.retry_notice)
                    },
                )
                OperationUiState.PENDING, OperationUiState.SENDING -> Text(stringResource(R.string.retry_notice))
                OperationUiState.CANCEL_PENDING -> Text(stringResource(R.string.status_cancel_pending))
                OperationUiState.CANCELLED -> Text(stringResource(R.string.status_cancelled))
            }
        }

    }
}

internal fun creditLimitRejectionMessage(serialized: String): String? = try {
    val root = kotlinx.serialization.json.Json.parseToJsonElement(serialized).jsonObject
    val details = (root["result"] as? kotlinx.serialization.json.JsonObject) ?: root
    fun amount(key: String) = (details[key] as? kotlinx.serialization.json.JsonPrimitive)?.content?.toDoubleOrNull()
    val message = (details["message"] as? kotlinx.serialization.json.JsonPrimitive)?.content?.takeIf(String::isNotBlank)
    val limit = amount("creditLimit")
    val projected = amount("projectedBalance")
    val excess = amount("excessAmount")
    val figures = listOfNotNull(
        limit?.let { "Limit: ${CreditLimitRules.money(it)}" },
        amount("balance")?.let { "Bakiye: ${CreditLimitRules.money(it)}" },
        amount("openOrderAmount")?.let { "Açık sipariş: ${CreditLimitRules.money(it)}" },
        projected?.let { "İşlem sonrası: ${CreditLimitRules.money(it)}" },
        excess?.let { "Aşım: ${CreditLimitRules.money(it)}" },
    ).joinToString(" · ")
    listOfNotNull(message ?: "Müşteri maksimum borç bakiyesini aşıyor.", figures.takeIf(String::isNotBlank))
        .joinToString("\n")
} catch (_: kotlinx.serialization.SerializationException) {
    null
} catch (_: IllegalArgumentException) {
    null
}

private fun conflictGrandTotal(serialized: String): Double? {
    return try {
        val result = kotlinx.serialization.json.Json.parseToJsonElement(serialized).jsonObject
        val details = result["result"]?.jsonObject ?: result
        (details["grandTotal"] ?: details["totalAmount"])?.jsonPrimitive?.content?.toDoubleOrNull()
    } catch (_: kotlinx.serialization.SerializationException) {
        null
    }
}

@Composable
private fun MapContent(state: MobileUiState) {
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(stringResource(R.string.map_basic_title), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
        Card(shape = RoundedCornerShape(18.dp)) {
            Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(stringResource(R.string.map_gap), color = MaterialTheme.colorScheme.error, fontWeight = FontWeight.Bold)
                Text(stringResource(R.string.map_gap_detail))
            }
        }
        state.route.forEachIndexed { index, customer ->
            Card(shape = RoundedCornerShape(14.dp)) {
                Row(Modifier.fillMaxWidth().padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text("${index + 1}", fontWeight = FontWeight.Bold)
                    Spacer(Modifier.width(12.dp))
                    Column {
                        Text(customer.name, fontWeight = FontWeight.SemiBold)
                        customer.address?.takeIf(String::isNotBlank)?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
                    }
                }
            }
        }
    }
}

@Composable
private fun MoreContent(state: MobileUiState, viewModel: AppViewModel, onWorkday: () -> Unit) {
    val session = state.session
    val context = LocalContext.current
    val printerStore = remember(context) { BluetoothPrinterSettingsStore(context) }
    val bluetoothPrinter = remember(context) { BluetoothPrinter(context) }
    var printerDialogVisible by rememberSaveable { mutableStateOf(false) }
    var printerAddress by remember { mutableStateOf(printerStore.printerAddress()) }
    var printerName by remember { mutableStateOf(printerStore.printerName()) }
    var companyTitle by remember { mutableStateOf(printerStore.companyTitle()) }
    var companyAddress by remember { mutableStateOf(printerStore.companyAddress()) }
    var companyPhone by remember { mutableStateOf(printerStore.companyPhone()) }
    var companyTaxOffice by remember { mutableStateOf(printerStore.companyTaxOffice()) }
    var companyTaxNo by remember { mutableStateOf(printerStore.companyTaxNo()) }
    var companyTckn by remember { mutableStateOf(printerStore.companyTckn()) }
    var pairedPrinterMenuExpanded by remember { mutableStateOf(false) }
    var pairedPrinters by remember { mutableStateOf(bluetoothPrinter.pairedDevices()) }
    val bluetoothPermissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { granted ->
        pairedPrinters = if (granted) bluetoothPrinter.pairedDevices() else emptyList()
    }

    fun openPrinterSettings() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.BLUETOOTH_CONNECT) !=
            PackageManager.PERMISSION_GRANTED
        ) {
            bluetoothPermissionLauncher.launch(Manifest.permission.BLUETOOTH_CONNECT)
        } else {
            pairedPrinters = bluetoothPrinter.pairedDevices()
        }
        printerDialogVisible = true
    }

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        item {
            Card(shape = RoundedCornerShape(18.dp)) {
                Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text(stringResource(R.string.more), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                    InfoLine(stringResource(R.string.username), session?.username.orEmpty())
                    InfoLine(stringResource(R.string.representative), session?.representativeName.orEmpty())
                    InfoLine(stringResource(R.string.device), viewModel.debugDeviceId())
                    InfoLine(stringResource(R.string.device_status), session?.deviceStatus.orEmpty())
                    InfoLine(stringResource(R.string.app_version), BuildConfig.VERSION_NAME)
                    InfoLine(stringResource(R.string.last_sync), state.lastSync ?: "—")
                    InfoLine(stringResource(R.string.waiting_operations), state.pendingCount.toString())
                }
            }
        }
        item {
            Card(shape = RoundedCornerShape(18.dp)) {
                Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text("Bluetooth Yazıcı", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                    InfoLine("Yazıcı", printerName.ifBlank { "Seçilmedi" })
                    InfoLine("Adres", printerAddress.ifBlank { "—" })
                    InfoLine("Kağıt", "80 mm")
                    InfoLine("Mod", "ESC/POS")
                    OutlinedButton(
                        onClick = ::openPrinterSettings,
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Text("Yazıcı Ayarları")
                    }
                }
            }
        }
        item {
            Button(onClick = viewModel::refresh, modifier = Modifier.fillMaxWidth()) {
                Icon(Icons.Default.Sync, contentDescription = null)
                Spacer(Modifier.width(8.dp))
                Text(stringResource(R.string.sync_now))
            }
        }
        item {
            OutlinedButton(onClick = onWorkday, modifier = Modifier.fillMaxWidth()) {
                Text("Gün sonu sayımı ve kapatma")
            }
        }
        item {
            OutlinedButton(onClick = viewModel::logout, modifier = Modifier.fillMaxWidth()) {
                Text(stringResource(R.string.logout))
            }
        }
    }
    if (printerDialogVisible) {
        AlertDialog(
            onDismissRequest = { printerDialogVisible = false },
            title = { Text("Bluetooth Yazıcı Ayarları") },
            text = {
                Column(
                    modifier = Modifier.verticalScroll(rememberScrollState()),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    OutlinedButton(
                        onClick = {
                            context.startActivity(
                                Intent(Settings.ACTION_BLUETOOTH_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                            )
                        },
                        modifier = Modifier.fillMaxWidth(),
                    ) { Text("Android Bluetooth Ayarlarını Aç") }

                    Box(Modifier.fillMaxWidth()) {
                        OutlinedButton(
                            onClick = { pairedPrinterMenuExpanded = true },
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Text(printerName.ifBlank { "Eşleşmiş yazıcı seçin" })
                        }
                        DropdownMenu(
                            expanded = pairedPrinterMenuExpanded,
                            onDismissRequest = { pairedPrinterMenuExpanded = false },
                        ) {
                            pairedPrinters.forEach { (address, name) ->
                                DropdownMenuItem(
                                    text = { Text(name.ifBlank { address }) },
                                    onClick = {
                                        printerAddress = address
                                        printerName = name.ifBlank { address }
                                        pairedPrinterMenuExpanded = false
                                    },
                                )
                            }
                        }
                    }
                    if (pairedPrinters.isEmpty()) {
                        Text(
                            "Eşleşmiş ZYWELL/ZM04 cihazı bulunamadı. Android Bluetooth ayarlarından yazıcıyı eşleyip tekrar açın.",
                            color = MaterialTheme.colorScheme.error,
                        )
                    }
                    OutlinedTextField(
                        value = companyTitle,
                        onValueChange = { companyTitle = it },
                        label = { Text("Firma Ünvanı") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    OutlinedTextField(
                        value = companyAddress,
                        onValueChange = { companyAddress = it },
                        label = { Text("Firma Adresi") },
                        modifier = Modifier.fillMaxWidth(),
                    )
                    OutlinedTextField(
                        value = companyPhone,
                        onValueChange = { companyPhone = it },
                        label = { Text("Firma Telefonu") },
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone),
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    OutlinedTextField(
                        value = companyTaxOffice,
                        onValueChange = { companyTaxOffice = it },
                        label = { Text("Vergi Dairesi") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    OutlinedTextField(
                        value = companyTaxNo,
                        onValueChange = { value -> if (value.length <= 10) companyTaxNo = value.filter(Char::isDigit) },
                        label = { Text("VKN") },
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    OutlinedTextField(
                        value = companyTckn,
                        onValueChange = { value -> if (value.length <= 11) companyTckn = value.filter(Char::isDigit) },
                        label = { Text("TCKN") },
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            },
            confirmButton = {
                TextButton(
                    enabled = printerAddress.isNotBlank(),
                    onClick = {
                        printerStore.savePrinter(printerAddress, printerName)
                        printerStore.saveCompany(
                            companyTitle,
                            companyAddress,
                            companyPhone,
                            companyTaxOffice,
                            companyTaxNo,
                            companyTckn,
                        )
                        printerDialogVisible = false
                    },
                ) { Text("Kaydet") }
            },
            dismissButton = {
                TextButton(onClick = { printerDialogVisible = false }) { Text("Kapat") }
            },
        )
    }
}

@Composable
private fun VisitCompleteDialog(
    error: String? = null,
    isFinishing: Boolean = false,
    onDismiss: () -> Unit,
    onConfirm: (String, String) -> Unit,
) {
    var note by rememberSaveable { mutableStateOf("") }
    var result by rememberSaveable { mutableStateOf("NoOrder") }
    AlertDialog(
        onDismissRequest = { if (!isFinishing) onDismiss() },
        title = { Text(stringResource(R.string.finish_visit)) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                OutlinedButton(
                    onClick = { result = "OrderCreated" },
                    modifier = Modifier.fillMaxWidth(),
                    enabled = !isFinishing,
                    colors = visitResultButtonColors(result == "OrderCreated"),
                ) {
                    Text(stringResource(R.string.visit_result_order))
                }
                OutlinedButton(
                    onClick = { result = "NoOrder" },
                    modifier = Modifier.fillMaxWidth(),
                    enabled = !isFinishing,
                    colors = visitResultButtonColors(result == "NoOrder"),
                ) {
                    Text(stringResource(R.string.visit_result_no_order))
                }
                OutlinedButton(
                    onClick = { result = "Closed" },
                    modifier = Modifier.fillMaxWidth(),
                    enabled = !isFinishing,
                    colors = visitResultButtonColors(result == "Closed"),
                ) {
                    Text(stringResource(R.string.visit_result_closed))
                }
                OutlinedTextField(
                    value = note,
                    onValueChange = { if (it.length <= 2000) note = it },
                    label = { Text(stringResource(R.string.visit_note)) },
                    modifier = Modifier.fillMaxWidth(),
                    enabled = !isFinishing,
                )
                error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            }
        },
        confirmButton = {
            Button(onClick = { onConfirm(result, note) }, enabled = !isFinishing) {
                if (isFinishing) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                else Text(stringResource(R.string.finish_visit))
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss, enabled = !isFinishing) {
                Text(stringResource(R.string.cancel))
            }
        },
    )
}

@Composable
private fun visitResultButtonColors(selected: Boolean) = ButtonDefaults.outlinedButtonColors(
    containerColor = if (selected) MaterialTheme.colorScheme.primaryContainer else Color.Transparent,
    contentColor = if (selected) MaterialTheme.colorScheme.onPrimaryContainer else MaterialTheme.colorScheme.primary,
)

@Composable
private fun VisitStateBadge(state: String) {
    val label = when (state) {
        "complete" -> stringResource(R.string.visit_finished)
        "open" -> stringResource(R.string.visit_open)
        else -> stringResource(R.string.visit_pending)
    }
    Surface(color = MaterialTheme.colorScheme.secondaryContainer, shape = RoundedCornerShape(20.dp)) {
        Text(label, modifier = Modifier.padding(horizontal = 10.dp, vertical = 5.dp), style = MaterialTheme.typography.labelSmall)
    }
}

@Composable
private fun MetricCard(label: String, value: String, modifier: Modifier = Modifier) {
    Card(modifier, shape = RoundedCornerShape(16.dp)) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(value, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
            Text(label, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun InfoLine(label: String, value: String) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Text("$label:", fontWeight = FontWeight.Medium)
        Text(value, modifier = Modifier.weight(1f))
    }
}

@Composable
private fun EmptyMessage(message: String) {
    Column(
        Modifier.fillMaxWidth().padding(28.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Icon(Icons.Default.Inventory2, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(message, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun WorkdayScreen(
        state: MobileUiState,
        viewModel: AppViewModel,
        outsideRoute: Boolean = false,
        onStartRoute: () -> Unit = {},
        onShowOutside: () -> Unit = {},
        onBackToWorkday: () -> Unit = {},
        onOrder: (CustomerSummary) -> Unit = {},
        onHotSale: (CustomerSummary) -> Unit = {},
        onBalance: (CustomerSummary) -> Unit = {},
        onCollection: (CustomerSummary) -> Unit = {},
        onWorkdayClosed: (String?) -> Unit = {},
    ) {
        val workday = state.workday
        var closingOdometer by rememberSaveable { mutableStateOf("") }
        var closingOpeningOdometer by rememberSaveable(workday?.id) {
            mutableStateOf(
                (workday?.openingOdometerKm ?: workday?.suggestedOpeningOdometerKm)
                    ?.toString()
                    .orEmpty(),
            )
        }
        var manualOpeningOdometerConfirmed by rememberSaveable(workday?.id) {
            mutableStateOf(false)
        }
        var closeFormVisible by rememberSaveable { mutableStateOf(false) }
        var dayMenuExpanded by remember { mutableStateOf(false) }
        var stockVisible by rememberSaveable { mutableStateOf(false) }
        var search by rememberSaveable { mutableStateOf("") }
        var sortMode by rememberSaveable { mutableStateOf("visit") }
        var sortMenuExpanded by remember { mutableStateOf(false) }
        var selectedRouteCustomer by remember { mutableStateOf<JsonObject?>(null) }
        val snapshot = workday?.openingSnapshot
        val route = snapshot?.get("route")?.let { runCatching { it.jsonArray }.getOrNull() }.orEmpty()
        val stock = snapshot?.get("stock")?.let { runCatching { it.jsonArray }.getOrNull() }.orEmpty()
        val routeCodes = route.mapNotNull { it.jsonObject["customerCode"]?.jsonPrimitive?.contentOrNull }
        val initialOrder = state.routeOrder.takeIf { it.size == routeCodes.size && it.toSet() == routeCodes.toSet() } ?: routeCodes
        val orderedRoute = remember(route, state.routeOrder) {
            route.sortedBy { item ->
                val code = item.jsonObject["customerCode"]?.jsonPrimitive?.contentOrNull
                initialOrder.indexOf(code).let { if (it < 0) Int.MAX_VALUE else it }
            }
        }
        val visibleRoute = orderedRoute.filter { item ->
            val customer = item.jsonObject
            val query = search.trim()
            query.isBlank() || listOf("customerName", "customerCode", "district", "province")
                .any { key -> customer[key]?.jsonPrimitive?.contentOrNull.orEmpty().contains(query, ignoreCase = true) }
        }.let { filtered ->
            when (sortMode) {
                "az" -> filtered.sortedBy { it.jsonObject["customerName"]?.jsonPrimitive?.contentOrNull.orEmpty().lowercase() }
                "za" -> filtered.sortedByDescending { it.jsonObject["customerName"]?.jsonPrimitive?.contentOrNull.orEmpty().lowercase() }
                else -> filtered
            }
        }
        val dragThresholdPx = with(androidx.compose.ui.platform.LocalDensity.current) { 72.dp.toPx() }
        val outsideAssignments = if (state.outsideDay.isNullOrBlank()) {
            state.outsideAssignments
        } else {
            state.outsideAssignments.filter { it.routeDay == state.outsideDay }
        }

        Scaffold(
            containerColor = MaterialTheme.colorScheme.background,
            topBar = {
                TopAppBar(
                    title = { Text(if (outsideRoute) "Rut dışı müşteriler" else "Günlük çalışma", fontWeight = FontWeight.Bold) },
                    navigationIcon = {
                        if (outsideRoute) {
                            IconButton(onClick = onBackToWorkday) {
                                Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Günlük ekrana dön")
                            }
                        }
                    },
                    actions = {
                        IconButton(onClick = if (outsideRoute) ({ viewModel.loadOutsideRoute(state.outsideDay) }) else viewModel::refreshWorkdayWithProgress) {
                            Icon(Icons.Default.Refresh, contentDescription = stringResource(R.string.refresh))
                        }
                    },
                    colors = TopAppBarDefaults.topAppBarColors(
                        containerColor = MaterialTheme.colorScheme.background,
                        titleContentColor = MaterialTheme.colorScheme.onBackground,
                        navigationIconContentColor = MaterialTheme.colorScheme.primary,
                        actionIconContentColor = MaterialTheme.colorScheme.primary,
                    ),
                )
            },
        ) { padding ->
            LazyColumn(
                modifier = Modifier.fillMaxSize().padding(padding),
                contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                state.error?.let { message -> item { InlineError(message) } }
                if (outsideRoute) {
                    item {
                        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            Text("Bugün dışındaki atanmış müşteriler", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                            Box {
                                OutlinedButton(onClick = { dayMenuExpanded = true }) {
                                    Text(state.outsideDay ?: "Tüm günler")
                                }
                                DropdownMenu(expanded = dayMenuExpanded, onDismissRequest = { dayMenuExpanded = false }) {
                                    DropdownMenuItem(
                                        text = { Text("Tüm günler") },
                                        onClick = {
                                            dayMenuExpanded = false
                                            viewModel.loadOutsideRoute()
                                        },
                                    )
                                    state.outsideDays.forEach { day ->
                                        DropdownMenuItem(
                                            text = { Text(day) },
                                            onClick = {
                                                dayMenuExpanded = false
                                                viewModel.loadOutsideRoute(day)
                                            },
                                        )
                                    }
                                }
                            }
                        }
                    }
                    if (state.loading && state.outsideAssignments.isEmpty()) item { LoadingRow() }
                    if (outsideAssignments.isEmpty() && !state.loading) {
                        item { EmptyMessage("Seçilen filtre için rut dışı müşteri bulunamadı.") }
                    }
                    items(outsideAssignments, key = { it.id }) { assignment ->
                        Card {
                            Column(Modifier.fillMaxWidth().padding(14.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                                Text(assignment.customerName, fontWeight = FontWeight.Bold)
                                Text("${assignment.customerCode} · ${assignment.routeDay} · ${assignment.salesRepresentativeName}")
                                Text("${listOfNotNull(assignment.district, assignment.province).joinToString(", ")} · Bakiye ${money(assignment.balance)}")
                            }
                        }
                    }
                    return@LazyColumn
                }

                if (workday == null) {
                    item {
                        Card(
                            shape = RoundedCornerShape(28.dp),
                            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primary),
                            elevation = CardDefaults.cardElevation(defaultElevation = 4.dp),
                        ) {
                            Column(Modifier.fillMaxWidth().padding(22.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                                Surface(
                                    shape = RoundedCornerShape(15.dp),
                                    color = Color.White.copy(alpha = 0.16f),
                                    modifier = Modifier.size(52.dp),
                                ) {
                                    Box(contentAlignment = Alignment.Center) {
                                        Icon(Icons.Default.CalendarToday, contentDescription = null, tint = Color.White, modifier = Modifier.size(25.dp))
                                    }
                                }
                                Text("Günlük açılış", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold, color = Color.White)
                                Text(
                                    "Bugünün rutunu, müşteri bakiyelerini, son 30 günlük satışları ve araç deposu stokunu açılış anında sabitleyin.",
                                    color = Color.White.copy(alpha = 0.88f),
                                    style = MaterialTheme.typography.bodyMedium,
                                )
                                if (!state.workdayChecked || state.loading) {
                                    CircularProgressIndicator(color = Color.White)
                                } else {
                                    Button(
                                        onClick = viewModel::refreshWorkdayWithProgress,
                                        enabled = !state.loading,
                                        modifier = Modifier.fillMaxWidth().height(52.dp),
                                        colors = androidx.compose.material3.ButtonDefaults.buttonColors(
                                            containerColor = Color.White,
                                            contentColor = MaterialTheme.colorScheme.primary,
                                        ),
                                    ) {
                                        Text("Bugünün açılışını yap")
                                    }
                                    OutlinedButton(
                                        onClick = viewModel::refreshWorkdayWithProgress,
                                        enabled = !state.loading,
                                        modifier = Modifier.fillMaxWidth(),
                                        colors = androidx.compose.material3.ButtonDefaults.outlinedButtonColors(contentColor = Color.White),
                                    ) {
                                        Text("Yenile")
                                    }
                                }
                            }
                        }
                    }
                    return@LazyColumn
                }

                item {
                    val warehouse = snapshot?.get("vehicleWarehouse")?.jsonObject
                    val representative = snapshot?.get("salesRepresentative")?.jsonObject
                    Card(
                        shape = RoundedCornerShape(24.dp),
                        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer),
                    ) {
                        Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(7.dp)) {
                            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                                Surface(shape = RoundedCornerShape(13.dp), color = MaterialTheme.colorScheme.surface, modifier = Modifier.size(42.dp)) {
                                    Box(contentAlignment = Alignment.Center) {
                                        Icon(Icons.Default.CalendarToday, contentDescription = null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(21.dp))
                                    }
                                }
                                Column {
                                    Text(if (workday.status == "closed") "Gün kapatıldı" else "Bugünün rutunu", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                                    Text("${workday.businessDate} · ${workday.routeDay}", color = MaterialTheme.colorScheme.onSurfaceVariant)
                                }
                            }
                            Text("Temsilci: ${representative?.get("name")?.jsonPrimitive?.contentOrNull.orEmpty()}")
                            Text("Araç deposu: ${warehouse?.get("name")?.jsonPrimitive?.contentOrNull ?: warehouse?.get("code")?.jsonPrimitive?.contentOrNull.orEmpty()}")
                            Text("Açılış: ${workday.openedAt.orEmpty()}", color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
                item {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text("Bugünkü müşteriler", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
                        Surface(shape = RoundedCornerShape(12.dp), color = MaterialTheme.colorScheme.primaryContainer) {
                            Text(
                                route.size.toString(),
                                modifier = Modifier.padding(horizontal = 11.dp, vertical = 7.dp),
                                fontWeight = FontWeight.Bold,
                                color = MaterialTheme.colorScheme.primary,
                            )
                        }
                        Box {
                            OutlinedButton(onClick = { sortMenuExpanded = true }) {
                                Text(when (sortMode) { "az" -> "A–Z"; "za" -> "Z–A"; else -> "Ziyaret sırası" })
                            }
                            DropdownMenu(expanded = sortMenuExpanded, onDismissRequest = { sortMenuExpanded = false }) {
                                listOf("visit" to "Ziyaret sırası", "az" to "A–Z", "za" to "Z–A").forEach { (mode, label) ->
                                    DropdownMenuItem(text = { Text(label) }, onClick = {
                                        sortMode = mode
                                        sortMenuExpanded = false
                                    })
                                }
                            }
                        }
                    }
                }
                item {
                    OutlinedTextField(
                        value = search,
                        onValueChange = { search = it },
                        label = { Text("Müşteri ara") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
                item {
                    OutlinedButton(onClick = { stockVisible = !stockVisible }, modifier = Modifier.fillMaxWidth()) {
                        Text(if (stockVisible) "Araç stokunu gizle (${stock.size})" else "Araç stokunu göster (${stock.size})")
                    }
                }
                if (!stockVisible && route.isEmpty()) item { EmptyMessage("Bugün için atanmış müşteri yok.") }
                if (!stockVisible && route.isNotEmpty() && visibleRoute.isEmpty()) item { EmptyMessage("Arama için müşteri bulunamadı.") }
                if (!stockVisible) {
                    items(visibleRoute, key = { it.jsonObject["customerCode"]?.jsonPrimitive?.contentOrNull.orEmpty() }) { element ->
                        val customer = element.jsonObject
                        val customerCode = customer["customerCode"]?.jsonPrimitive?.contentOrNull.orEmpty()
                        val displayedOrder = visibleRoute.mapNotNull {
                            it.jsonObject["customerCode"]?.jsonPrimitive?.contentOrNull
                        }
                        Card(
                            shape = RoundedCornerShape(22.dp),
                            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                            elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
                            modifier = Modifier
                                .pointerInput(customerCode, initialOrder, displayedOrder, sortMode, search) {
                                    var accumulated = 0f
                                    detectDragGesturesAfterLongPress(
                                        onDragStart = { accumulated = 0f },
                                        onDragEnd = { accumulated = 0f },
                                    ) { change, dragAmount ->
                                        accumulated += dragAmount.y
                                        val dragOrder = if (sortMode == "visit") initialOrder else displayedOrder
                                        if (search.isBlank() && accumulated > dragThresholdPx) {
                                            val index = dragOrder.indexOf(customerCode)
                                            if (index in 0 until dragOrder.lastIndex) {
                                                val reordered = dragOrder.toMutableList().apply { add(index + 1, removeAt(index)) }
                                                viewModel.updateRouteOrder(reordered)
                                                sortMode = "visit"
                                                accumulated -= dragThresholdPx
                                            }
                                        } else if (search.isBlank() && accumulated < -dragThresholdPx) {
                                            val index = dragOrder.indexOf(customerCode)
                                            if (index > 0) {
                                                val reordered = dragOrder.toMutableList().apply { add(index - 1, removeAt(index)) }
                                                viewModel.updateRouteOrder(reordered)
                                                sortMode = "visit"
                                                accumulated += dragThresholdPx
                                            }
                                        }
                                        change.consume()
                                    }
                                }
                                .clickable { selectedRouteCustomer = customer },
                        ) {
                            Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(9.dp)) {
                                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                                    Surface(
                                        shape = RoundedCornerShape(15.dp),
                                        color = MaterialTheme.colorScheme.primaryContainer,
                                        modifier = Modifier.size(44.dp),
                                    ) {
                                        Box(contentAlignment = Alignment.Center) {
                                            Text(
                                                customer["customerName"]?.jsonPrimitive?.contentOrNull.orEmpty().trim().take(1).uppercase(Locale("tr", "TR")),
                                                color = MaterialTheme.colorScheme.primary,
                                                fontWeight = FontWeight.Bold,
                                            )
                                        }
                                    }
                                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                                        Text(customer["customerName"]?.jsonPrimitive?.contentOrNull.orEmpty(), fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleMedium)
                                        Text(customerCode, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.labelMedium)
                                    }
                                    customer["balance"]?.jsonPrimitive?.content?.toDoubleOrNull()?.let { balance ->
                                        Surface(shape = RoundedCornerShape(10.dp), color = MaterialTheme.colorScheme.surfaceVariant) {
                                            Text(money(balance), modifier = Modifier.padding(horizontal = 9.dp, vertical = 6.dp), color = MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Bold)
                                        }
                                    }
                                }
                                val area = listOfNotNull(customer["district"]?.jsonPrimitive?.contentOrNull, customer["province"]?.jsonPrimitive?.contentOrNull).joinToString(", ")
                                if (area.isNotBlank()) {
                                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                                        Icon(Icons.Default.LocationOn, contentDescription = null, tint = MaterialTheme.colorScheme.secondary, modifier = Modifier.size(15.dp))
                                        Text(area, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                    }
                                }
                                Text("${customer["lastMonthSales"]?.jsonArray?.size ?: 0} fatura · son 30 gün", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
                                if (search.isBlank()) Text("Basılı tutup sürükleyin · bırakınca ziyaret sırası uygulanır", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.primary)
                                else Text("Sürüklemek için arama metnini temizleyin", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                        }
                    }
                }
                if (stockVisible) item {
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text("Araç deposu açılış stoku", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
                        Text(stock.size.toString(), fontWeight = FontWeight.Bold)
                    }
                }
                if (stockVisible) items(stock, key = { it.jsonObject["productCode"]?.jsonPrimitive?.contentOrNull.orEmpty() }) { element ->
                    val product = element.jsonObject
                    val code = product["productCode"]?.jsonPrimitive?.contentOrNull.orEmpty()
                    val openingQuantity = product["quantity"]?.jsonPrimitive?.contentOrNull.orEmpty()
                    Card {
                        Column(Modifier.fillMaxWidth().padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            Text(product["productName"]?.jsonPrimitive?.contentOrNull.orEmpty(), fontWeight = FontWeight.Bold)
                            Text("$code · Açılış: $openingQuantity ${product["unit"]?.jsonPrimitive?.contentOrNull.orEmpty()}")
                        }
                    }
                }
                if (workday.status == "open") {
                    item {
                        if (!closeFormVisible) {
                            Button(onClick = onShowOutside, modifier = Modifier.fillMaxWidth()) {
                                Text("Rut dışı müşteriler")
                            }
                            Button(onClick = onStartRoute, modifier = Modifier.fillMaxWidth()) {
                                Text("Rutuma başla")
                            }
                            OutlinedButton(
                                onClick = {
                                    manualOpeningOdometerConfirmed = false
                                    closeFormVisible = true
                                },
                                modifier = Modifier.fillMaxWidth(),
                                enabled = !state.loading,
                            ) {
                                Text(if (state.pendingCount > 0) "Eşitle ve günü kapat (${state.pendingCount} bekleyen)" else "Günü Kapat")
                            }
                        } else {
                            val knownOpeningOdometer = workday.openingOdometerKm
                                ?: workday.suggestedOpeningOdometerKm
                            val openingKm = closingOpeningOdometer.replace(',', '.').toDoubleOrNull()
                                ?: knownOpeningOdometer
                            val needsManualOpeningOdometer =
                                knownOpeningOdometer == null && !manualOpeningOdometerConfirmed
                            val closingKm = closingOdometer.replace(',', '.').toDoubleOrNull()

                            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                                Text("Gün sonu raporları", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                                DailyReportButtons(state)
                                Text("Araç kilometre bilgisi", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                                if (needsManualOpeningOdometer) {
                                    Text("Başlangıç kilometresi bulunamadı. Önce gün başındaki kilometreyi girin.")
                                    OutlinedTextField(
                                        value = closingOpeningOdometer,
                                        onValueChange = {
                                            closingOpeningOdometer = it.filter { char ->
                                                char.isDigit() || char == ',' || char == '.'
                                            }
                                        },
                                        label = { Text("Başlangıç kilometresi") },
                                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                                        singleLine = true,
                                        modifier = Modifier.fillMaxWidth(),
                                    )
                                    Button(
                                        onClick = { manualOpeningOdometerConfirmed = true },
                                        enabled = openingKm != null && openingKm >= 0 && !state.loading,
                                        modifier = Modifier.fillMaxWidth(),
                                    ) {
                                        Text("Devam Et")
                                    }
                                } else {
                                    Text(
                                        "Başlangıç kilometresi: ${openingKm ?: 0.0} km",
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                    OutlinedTextField(
                                        value = closingOdometer,
                                        onValueChange = {
                                            closingOdometer = it.filter { char ->
                                                char.isDigit() || char == ',' || char == '.'
                                            }
                                        },
                                        label = { Text("Araç son kilometresi") },
                                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                                        singleLine = true,
                                        modifier = Modifier.fillMaxWidth(),
                                    )
                                    Button(
                                        onClick = {
                                            viewModel.closeWorkday(closingKm!!, openingKm) { routePointsSyncError ->
                                                closeFormVisible = false
                                                onWorkdayClosed(routePointsSyncError)
                                            }
                                        },
                                        enabled = openingKm != null && openingKm >= 0
                                            && closingKm != null && closingKm >= openingKm
                                            && !state.loading,
                                        modifier = Modifier.fillMaxWidth(),
                                    ) {
                                        Text("Kaydet ve günü kapat")
                                    }
                                }
                                OutlinedButton(
                                    onClick = { closeFormVisible = false },
                                    enabled = !state.loading,
                                    modifier = Modifier.fillMaxWidth(),
                                ) {
                                    Text("Vazgeç")
                                }
                            }
                        }
                    }
                } else {
                    item { Text("Gün sonu özeti", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold) }
                    item {
                        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                            InfoLine("Başlangıç kilometresi", "${workday.openingOdometerKm ?: 0.0} km")
                            InfoLine("Kapanış kilometresi", "${workday.closingOdometerKm ?: 0.0} km")
                            InfoLine("Günlük yapılan yol", "${workday.traveledKm ?: 0.0} km")
                            DailyReportButtons(state)
                        }
                    }
                }
            }
            selectedRouteCustomer?.let { customer ->
                val summary = CustomerSummary(
                    code = customer["customerCode"]?.jsonPrimitive?.contentOrNull.orEmpty(),
                    name = customer["customerName"]?.jsonPrimitive?.contentOrNull.orEmpty(),
                    address = customer["address"]?.jsonPrimitive?.contentOrNull,
                    phone = customer["phone"]?.jsonPrimitive?.contentOrNull,
                    province = customer["province"]?.jsonPrimitive?.contentOrNull,
                    district = customer["district"]?.jsonPrimitive?.contentOrNull,
                    visitState = null,
                )
                AlertDialog(
                    onDismissRequest = { selectedRouteCustomer = null },
                    title = { Text(summary.name) },
                    text = { Text("Müşteri işlemini seçin.") },
                    confirmButton = {
                        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            Button(
                                onClick = { selectedRouteCustomer = null; onOrder(summary) },
                                modifier = Modifier.fillMaxWidth(),
                                colors = ButtonDefaults.buttonColors(containerColor = mobileOrderBlue),
                            ) { Text("Sipariş") }
                            Button(onClick = { selectedRouteCustomer = null; onHotSale(summary) }, modifier = Modifier.fillMaxWidth()) { Text("Satış") }
                            OutlinedButton(onClick = { selectedRouteCustomer = null; onBalance(summary) }, modifier = Modifier.fillMaxWidth()) { Text("Bakiye") }
                            OutlinedButton(onClick = { selectedRouteCustomer = null; onCollection(summary) }, modifier = Modifier.fillMaxWidth()) { Text("Tahsilat") }
                            TextButton(onClick = { selectedRouteCustomer = null }, modifier = Modifier.fillMaxWidth()) { Text("Kapat") }
                        }
                    },
                )
            }
        }
    }

@Composable
private fun DailyReportButtons(state: MobileUiState) {
    val context = LocalContext.current
    val todayOperations = state.operations.filter { isToday(it.createdAt) }
    Button(
        onClick = {
            DocumentPrinter.printDailyList(
                context,
                "Fatura Kontrol Listesi",
                todayOperations.filter { it.type == "sale.submit" },
                state.drafts,
                state.customers,
            )
        },
        modifier = Modifier.fillMaxWidth(),
    ) { Text("Fatura Kontrol Listesini Yazdır") }
    Button(
        onClick = {
            DocumentPrinter.printDailyList(
                context,
                "Sipariş Kontrol Listesi",
                todayOperations.filter { it.type == "order.submit" },
                state.drafts,
                state.customers,
            )
        },
        modifier = Modifier.fillMaxWidth(),
    ) { Text("Sipariş Kontrol Listesini Yazdır") }
    Button(
        onClick = {
            DocumentPrinter.printDailyList(
                context,
                "Tahsilat Listesi",
                todayOperations.filter { it.type == "collection.submit" },
                state.drafts,
                state.customers,
            )
        },
        modifier = Modifier.fillMaxWidth(),
    ) { Text("Tahsilat Listesini Yazdır") }
}

private fun isToday(value: String): Boolean = runCatching {
    Instant.parse(value).atZone(ZoneId.of("Europe/Istanbul")).toLocalDate() ==
        java.time.LocalDate.now(ZoneId.of("Europe/Istanbul"))
}.getOrDefault(false)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CollectionScreen(
        state: MobileUiState,
        customer: CustomerSummary,
        viewModel: AppViewModel,
        onBack: () -> Unit,
        onSaved: () -> Unit,
) {
        val operationId = rememberSaveable(customer.code) { java.util.UUID.randomUUID().toString() }
        var amount by rememberSaveable(customer.code) { mutableStateOf("") }
        val operationDate = java.time.LocalDate.now(ZoneId.of("Europe/Istanbul")).toString()
        var description by rememberSaveable(customer.code) { mutableStateOf("") }
        var collectionAttempted by rememberSaveable(customer.code) { mutableStateOf(false) }
        val openingCustomer = state.workday?.openingSnapshot?.get("route")?.let {
            runCatching { it.jsonArray }.getOrNull()
        }.orEmpty().firstOrNull {
            it.jsonObject["customerCode"]?.jsonPrimitive?.contentOrNull == customer.code
        }?.jsonObject
        val balance = state.salesContext?.takeIf { it.customer.code == customer.code }?.balance
            ?: openingCustomer?.get("balance")?.jsonPrimitive?.contentOrNull.orEmpty()
        val numericAmount = amount.replace(',', '.').toDoubleOrNull()

        Scaffold(
            topBar = {
                TopAppBar(
                    title = { Text("Tahsilat") },
                    navigationIcon = {
                        IconButton(onClick = onBack) {
                            Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Geri")
                        }
                    },
                )
            },
        ) { padding ->
            Column(
                Modifier.fillMaxSize().padding(padding).verticalScroll(rememberScrollState()).padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Text(customer.name, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                InfoLine("Cari kodu", customer.code)
                InfoLine("Mevcut bakiye", balance)
                state.error?.let { InlineError(it) }
                OutlinedTextField(
                    value = operationDate,
                    onValueChange = {},
                    label = { Text("İşlem tarihi") },
                    singleLine = true,
                    readOnly = true,
                    enabled = !collectionAttempted,
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = amount,
                    onValueChange = { amount = it.filter { character -> character.isDigit() || character == '.' || character == ',' } },
                    label = { Text("Tahsilat tutarı") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                    singleLine = true,
                    enabled = !collectionAttempted,
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = description,
                    onValueChange = { description = it.take(500) },
                    label = { Text("Açıklama (isteğe bağlı)") },
                    minLines = 2,
                    enabled = !collectionAttempted,
                    modifier = Modifier.fillMaxWidth(),
                )
                Button(
                    onClick = {
                        collectionAttempted = true
                        numericAmount?.let { value ->
                            viewModel.submitCollection(
                                operationId = operationId,
                                customerCode = customer.code,
                                amount = value,
                                operationDate = operationDate,
                                description = description,
                                onComplete = { success -> if (success) onSaved() },
                            )
                        }
                    },
                    enabled = !state.loading && numericAmount != null
                        && numericAmount in 0.01..1_000_000_000.0
                        && kotlin.math.abs(numericAmount * 100 - kotlin.math.round(numericAmount * 100)) <= 1e-7,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text(if (state.loading) "Kaydediliyor…" else if (collectionAttempted) "Aynı tahsilatı tekrar dene" else "Tahsilatı kaydet")
                }
                Text(
                    "Kayıt, cari bakiyeyi ve tahsilat hareketlerini günceller. Aynı işlem kimliğiyle güvenli tekrar denemesi yapılır.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
}

@Composable
private fun InlineError(message: String) {
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Icon(Icons.Default.CloudOff, contentDescription = null, tint = MaterialTheme.colorScheme.error)
        Text(message, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
    }
}

@Composable
private fun LoadingRow() {
    Row(
        Modifier.fillMaxWidth().padding(16.dp),
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        CircularProgressIndicator(Modifier.size(22.dp), strokeWidth = 2.dp)
        Spacer(Modifier.width(10.dp))
        Text(stringResource(R.string.loading))
    }
}

@androidx.annotation.StringRes
private fun DraftSummary.stateLabelResource(): Int = when (state) {
    "access_revoked" -> R.string.status_access_revoked
    "pending" -> R.string.status_pending
    "sending" -> R.string.status_sending
    "accepted" -> R.string.status_accepted
    "conflict" -> R.string.status_conflict
    "requires_approval" -> R.string.status_approval
    "rejected" -> R.string.status_rejected
    "retry" -> R.string.status_retry
    else -> R.string.status_draft
}

private fun todayDate(): String = DateTimeFormatter
    .ofPattern("EEEE, d MMMM yyyy", Locale("tr", "TR"))
    .format(java.time.LocalDate.now(ZoneId.of("Europe/Istanbul")))

private fun money(value: Double): String =
    MoneyFormatter.turkish(value)

private fun quantityLabel(value: Double): String =
    if (value % 1.0 == 0.0) value.toLong().toString() else value.toString()
