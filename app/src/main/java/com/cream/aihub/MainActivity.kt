package com.cream.aihub

import android.annotation.SuppressLint
import android.app.AlertDialog
import android.app.DownloadManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.res.ColorStateList
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.util.Base64
import android.os.Bundle
import android.os.Environment
import android.print.PrintAttributes
import android.print.PrintManager
import android.print.pdf.PrintedPdfDocument
import android.text.Editable
import android.text.TextWatcher
import android.view.KeyEvent
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputMethodManager
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.URLUtil
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.HorizontalScrollView
import android.widget.ImageButton
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.NotificationCompat
import androidx.core.content.FileProvider
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout
import androidx.webkit.WebSettingsCompat
import androidx.webkit.WebViewFeature
import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.qrcode.QRCodeWriter
import com.journeyapps.barcodescanner.ScanContract
import com.journeyapps.barcodescanner.ScanOptions
import com.google.android.material.bottomsheet.BottomSheetBehavior
import com.google.android.material.bottomsheet.BottomSheetDialog
import com.google.android.material.button.MaterialButton
import com.google.android.material.color.DynamicColors
import com.google.android.material.switchmaterial.SwitchMaterial
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.text.SimpleDateFormat
import java.util.concurrent.Callable
import java.util.concurrent.Executors
import java.util.Date
import java.util.Locale
import kotlin.math.roundToInt
import android.graphics.Canvas
import android.provider.MediaStore
import android.view.ActionMode
import android.view.Menu
import android.view.MenuItem

class MainActivity : AppCompatActivity() {

    data class WebTab(
        val id: String,
        var title: String,
        var url: String,
        val webView: WebView,
        val isSecurity: Boolean = false,
        var groupId: String? = null,
        var groupName: String? = null,
        var groupColor: String? = null,
        var isInactive: Boolean = false,
        var isTranslated: Boolean = false,
        var mediaUrl: String? = null,
        var lastAccessedTime: Long = System.currentTimeMillis(),
        var autoTranslatedUrl: String? = null
    )

    data class TabGroup(
        val id: String,
        var title: String,
        var colorHex: String,
        var isCollapsed: Boolean = false
    )

    data class BookmarkItem(
        val title: String,
        val url: String,
        val folder: String = "기본",
        val isCustom: Boolean = false
    )

    data class HistoryItem(
        val title: String,
        val url: String,
        val timestamp: Long
    )

    data class BagItem(
        val id: String,
        val type: String, // "link", "image", "text"
        val title: String,
        val content: String,
        val sourceUrl: String,
        val timestamp: Long
    )

    data class DownloadedFileItem(
        val filename: String,
        val url: String,
        val path: String,
        val size: Long,
        val timestamp: Long
    )

    private lateinit var rootLayout: ViewGroup
    private lateinit var webViewContainer: FrameLayout
    private lateinit var swipeRefresh: SwipeRefreshLayout
    private lateinit var progressBar: ProgressBar

    // 상단 툴바 및 옴니박스
    private lateinit var layoutTopBar: LinearLayout
    private lateinit var layoutAddressBar: LinearLayout
    private lateinit var ivUrlIcon: ImageView
    private lateinit var tvTopSecurityBadge: TextView
    private lateinit var etBrowserUrl: EditText
    private lateinit var btnClearUrl: ImageView
    private lateinit var btnQuickTranslateChip: LinearLayout
    private lateinit var ivTranslateChipIcon: ImageView
    private lateinit var tvTranslateChipText: TextView
    private lateinit var layoutTranslateProgress: LinearLayout
    private lateinit var pbTranslateSpinner: ProgressBar
    private lateinit var tvTranslateStatus: TextView
    private lateinit var btnCloseTranslateProgress: ImageView
    private lateinit var btnTopBack: ImageView
    private lateinit var btnTopForward: ImageView
    private lateinit var btnTopReload: ImageView
    private lateinit var btnMobileReload: ImageView
    private lateinit var btnTopMenu: ImageView
    private lateinit var btnTopHome: ImageView
    private lateinit var btnToggleSidebar: View
    private lateinit var tvSidebarBtnText: TextView

    private var customView: View? = null
    private var customViewCallback: WebChromeClient.CustomViewCallback? = null

    // 주소창 제안 오버레이
    private lateinit var layoutSearchSuggestions: LinearLayout
    private lateinit var chipClipboardPaste: LinearLayout
    private lateinit var tvClipboardText: TextView
    private lateinit var btnClearSearchHistory: TextView
    private lateinit var layoutRecentSearchesContainer: LinearLayout
    private lateinit var layoutRecentSitesChips: LinearLayout

    // 하단 모바일 내비게이션 바
    private lateinit var layoutBottomBar: View
    private lateinit var btnNavBack: ImageView
    private lateinit var btnNavForward: ImageView
    private lateinit var btnNavCreamy: View
    private lateinit var btnNavTabs: View
    private lateinit var tvNavTabCount: TextView
    private lateinit var btnNavHome: ImageView

    // 태블릿/데스크탑 사이드바
    private lateinit var layoutSidebar: LinearLayout
    private lateinit var btnCloseSidebar: ImageView
    private lateinit var btnTabAi: TextView
    private lateinit var btnTabBookmarks: TextView
    private lateinit var btnTabMenu: TextView
    private lateinit var btnTabSettings: TextView
    private lateinit var layoutTabMenuContent: View
    private lateinit var layoutTabAiContent: View
    private lateinit var layoutTabBookmarksContent: View
    private lateinit var layoutTabSettingsContent: View
    private lateinit var layoutSidebarSettingsContainer: LinearLayout
    private lateinit var layoutTabListContent: LinearLayout
    private lateinit var tvSidebarListTitle: TextView
    private lateinit var layoutSidebarListContainer: LinearLayout
    private lateinit var btnSidebarListAction: Button
    private lateinit var btnSidebarListBack: ImageView
    private lateinit var btnSidebarTopNewTab: Button
    private lateinit var btnSidebarTopSplit: Button

    // 듀얼 분할 브라우징
    private lateinit var layoutSplitHost: LinearLayout
    private lateinit var webViewContainerSplit: FrameLayout
    private lateinit var viewSplitDivider: View
    private var splitActive = false
    private var splitTabId: String? = null
    private var splitLeftRatio = 0.5f

    // 리서치 캔버스
    private lateinit var layoutResearchCanvas: LinearLayout
    private lateinit var canvasBoardHost: FrameLayout
    private var canvasView: ResearchCanvasView? = null

    // 사이드바 목록 패널
    private var sidebarListType = "bag"
    private lateinit var tvSidebarPageTitle: TextView
    private lateinit var tvSidebarPageUrl: TextView
    private lateinit var tvSidebarAiResult: TextView
    private lateinit var btnSidebarQuickSummary: Button
    private lateinit var btnSidebarQuickQuestions: Button
    private lateinit var btnSidebarQuickTranslate: Button
    private lateinit var etSidebarQuery: EditText
    private lateinit var btnSidebarSend: Button

    // 탭 및 그룹 상태
    private val tabs = mutableListOf<WebTab>()
    private val tabGroups = mutableListOf<TabGroup>()
    private var activeTabIndex = 0

    private val START_PAGE_URL = "file:///android_asset/start_page.html"
    private val START_PAGE_SECURITY_URL = "file:///android_asset/start_page_security.html"
    private val BASE_URL = "https://doteai.base44.app"
    private val CREAMY_URL = "https://doteai.base44.app/creamy"
    private val PREFS_NAME = "cream_ai_prefs"
    private val KEY_BASE44_TOKEN = "base44_access_token"

    // 커스텀 테마 색상 팔레트
    private val CUSTOM_ACCENTS = listOf(
        "#09090B" to "블랙",
        "#3B82F6" to "블루",
        "#10B981" to "에메랄드",
        "#8B5CF6" to "퍼플",
        "#EC4899" to "핑크",
        "#F59E0B" to "오렌지"
    )

    private data class TranslateLangOption(val code: String, val label: String)

    private val translateLanguages = listOf(
        TranslateLangOption("ko", "한국어"),
        TranslateLangOption("en", "영어"),
        TranslateLangOption("ja", "일본어"),
        TranslateLangOption("zh-CN", "중국어"),
        TranslateLangOption("es", "스페인어"),
        TranslateLangOption("fr", "프랑스어"),
        TranslateLangOption("de", "독일어")
    )

    private var fileChooserCallback: ValueCallback<Array<Uri>>? = null
    private var lastHandledText = ""
    private var pendingScriptToInject: String? = null
    private var isAppInForeground = false
    private var isSidebarOpen = false
    private var isDesktopMode = false
    private var currentPageText = ""
    private var currentSidebarTab = "ai"
    private var customBgDataUrlCache: String? = null

    // 태블릿 크롬형 상단 탭 스트립
    private lateinit var layoutTabletTabStrip: HorizontalScrollView
    private lateinit var layoutTabletTabsContainer: LinearLayout
    private lateinit var btnTabletNewTab: View
    private lateinit var btnTabletNewGroup: View

    private val DESKTOP_USER_AGENT =
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
    private val MOBILE_USER_AGENT =
        "Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36"

    // 알려진 광고 및 트래커 도메인 필터
    private val adDomains = listOf(
        "doubleclick.net", "googleadservices.com", "googlesyndication.com",
        "adservice.google.com", "google-analytics.com", "googletagservices.com",
        "taboola.com", "outbrain.com", "adform.net", "admaster.com.cn",
        "popads.net", "adnxs.com", "criteo.com", "adcolony.com",
        "amazon-adsystem.com", "adsrvr.org", "rubiconproject.com", "pubmatic.com",
        "moatads.com", "scorecardresearch.com", "ad.naver.com", "adfit"
    )

    private val fileChooserLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        val uri = if (result.resultCode == RESULT_OK) result.data?.data else null
        val resultUris = if (uri != null) arrayOf(uri) else null
        fileChooserCallback?.onReceiveValue(resultUris)
        fileChooserCallback = null
    }

    private val qrScanLauncher = registerForActivityResult(ScanContract()) { result ->
        val contents = result.contents
        if (!contents.isNullOrBlank()) {
            handleScannedCode(contents)
        }
    }

    private val backgroundImageLauncher = registerForActivityResult(
        ActivityResultContracts.GetContent()
    ) { uri ->
        handlePickedBackgroundImage(uri)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            WebView.enableSlowWholeDocumentDraw()
        }
        super.onCreate(savedInstanceState)
        if (isMaterialYouEnabled() && DynamicColors.isDynamicColorAvailable()) {
            DynamicColors.applyToActivityIfAvailable(this)
        }
        setContentView(R.layout.activity_main)

        initViews()
        requestNotificationPermission()
        setupResponsiveLayout()
        loadSavedTabGroups()
        initTabs()
        setupBrowserControls()
        setupSidebarControls()
        setupOmniboxSuggestions()
        handleIncomingIntent(intent)
        checkAndShowOnboarding()
        if (isTouchAnimationEnabled()) {
            applyTouchAnimationToAll(findViewById(android.R.id.content))
        }
        showPersistentQuickNotification()
        BriefingReceiver.scheduleDailyMorningBriefing(this)
    }

    private fun initViews() {
        rootLayout = findViewById(R.id.rootLayout)
        webViewContainer = findViewById(R.id.webViewContainer)
        swipeRefresh = findViewById(R.id.swipeRefresh)
        progressBar = findViewById(R.id.progressBar)

        // 상단 바
        layoutTopBar = findViewById(R.id.layoutTopBar)
        layoutAddressBar = findViewById(R.id.layoutAddressBar)
        layoutTopBar.setBackgroundResource(R.drawable.bg_glass_surface)
        ivUrlIcon = findViewById(R.id.ivUrlIcon)
        tvTopSecurityBadge = findViewById(R.id.tvTopSecurityBadge)
        etBrowserUrl = findViewById(R.id.etBrowserUrl)
        btnClearUrl = findViewById(R.id.btnClearUrl)
        btnQuickTranslateChip = findViewById(R.id.btnQuickTranslateChip)
        ivTranslateChipIcon = findViewById(R.id.ivTranslateChipIcon)
        tvTranslateChipText = findViewById(R.id.tvTranslateChipText)
        layoutTranslateProgress = findViewById(R.id.layoutTranslateProgress)
        pbTranslateSpinner = findViewById(R.id.pbTranslateSpinner)
        tvTranslateStatus = findViewById(R.id.tvTranslateStatus)
        btnCloseTranslateProgress = findViewById(R.id.btnCloseTranslateProgress)
        btnCloseTranslateProgress.setOnClickListener {
            translationJobToken++
            layoutTranslateProgress.visibility = View.GONE
            val tab = getCurrentTab()
            tvTranslateChipText.text = if (tab.isTranslated) "원문" else "번역"
            Toast.makeText(this, "번역이 중단되었습니다", Toast.LENGTH_SHORT).show()
        }

        btnQuickTranslateChip.setOnClickListener {
            val curUrl = getCurrentWebView().url ?: ""
            // 예전 프록시 방식으로 저장된 주소가 남아 있으면 원문 주소로 되돌린다
            if (curUrl.contains("translate.google.com/translate")) {
                try {
                    val originalUrl = Uri.parse(curUrl).getQueryParameter("u")
                    if (!originalUrl.isNullOrBlank()) {
                        loadWebQuery(originalUrl)
                        return@setOnClickListener
                    }
                } catch (e: Exception) {}
                getCurrentWebView().goBack()
            } else {
                togglePageTranslation()
            }
        }
        btnQuickTranslateChip.setOnLongClickListener {
            showTranslateLanguagePicker()
            true
        }
        btnTopBack = findViewById(R.id.btnTopBack)
        btnTopForward = findViewById(R.id.btnTopForward)
        btnTopReload = findViewById(R.id.btnTopReload)
        btnMobileReload = findViewById(R.id.btnMobileReload)
        btnTopMenu = findViewById(R.id.btnTopMenu)
        btnTopHome = findViewById(R.id.btnTopHome)
        btnToggleSidebar = findViewById(R.id.btnToggleSidebar)
        tvSidebarBtnText = findViewById(R.id.tvSidebarBtnText)

        // 미디어 저장/PIP 칩은 v2.2.0에서 전면 제거되었습니다

        // 주소창 제안 오버레이
        layoutSearchSuggestions = findViewById(R.id.layoutSearchSuggestions)
        chipClipboardPaste = findViewById(R.id.chipClipboardPaste)
        tvClipboardText = findViewById(R.id.tvClipboardText)
        btnClearSearchHistory = findViewById(R.id.btnClearSearchHistory)
        layoutRecentSearchesContainer = findViewById(R.id.layoutRecentSearchesContainer)
        layoutRecentSitesChips = findViewById(R.id.layoutRecentSitesChips)

        // 하단 바
        layoutBottomBar = findViewById(R.id.layoutBottomBar)
        layoutBottomBar.setBackgroundResource(R.drawable.bg_glass_surface)
        btnNavBack = findViewById(R.id.btnNavBack)
        btnNavForward = findViewById(R.id.btnNavForward)
        btnNavCreamy = findViewById(R.id.btnNavCreamy)
        btnNavTabs = findViewById(R.id.btnNavTabs)
        tvNavTabCount = findViewById(R.id.tvNavTabCount)
        btnNavHome = findViewById(R.id.btnNavHome)

        // 사이드바
        layoutSidebar = findViewById(R.id.layoutSidebar)
        btnCloseSidebar = findViewById(R.id.btnCloseSidebar)
        btnTabAi = findViewById(R.id.btnTabAi)
        btnTabBookmarks = findViewById(R.id.btnTabBookmarks)
        btnTabMenu = findViewById(R.id.btnTabMenu)
        btnTabSettings = findViewById(R.id.btnTabSettings)
        layoutTabMenuContent = findViewById(R.id.layoutTabMenuContent)
        layoutTabAiContent = findViewById(R.id.layoutTabAiContent)
        layoutTabBookmarksContent = findViewById(R.id.layoutTabBookmarksContent)
        layoutTabSettingsContent = findViewById(R.id.layoutTabSettingsContent)
        layoutSidebarSettingsContainer = findViewById(R.id.layoutSidebarSettingsContainer)
        layoutTabListContent = findViewById(R.id.layoutTabListContent)
        tvSidebarListTitle = findViewById(R.id.tvSidebarListTitle)
        layoutSidebarListContainer = findViewById(R.id.layoutSidebarListContainer)
        btnSidebarListAction = findViewById(R.id.btnSidebarListAction)
        btnSidebarListBack = findViewById(R.id.btnSidebarListBack)
        btnSidebarTopNewTab = findViewById(R.id.btnSidebarTopNewTab)
        btnSidebarTopSplit = findViewById(R.id.btnSidebarTopSplit)
        layoutSplitHost = findViewById(R.id.layoutSplitHost)
        webViewContainerSplit = findViewById(R.id.webViewContainerSplit)
        viewSplitDivider = findViewById(R.id.viewSplitDivider)
        layoutResearchCanvas = findViewById(R.id.layoutResearchCanvas)
        canvasBoardHost = findViewById(R.id.canvasBoardHost)
        tvSidebarPageTitle = findViewById(R.id.tvSidebarPageTitle)
        tvSidebarPageUrl = findViewById(R.id.tvSidebarPageUrl)
        tvSidebarAiResult = findViewById(R.id.tvSidebarAiResult)
        btnSidebarQuickSummary = findViewById(R.id.btnSidebarQuickSummary)
        btnSidebarQuickQuestions = findViewById(R.id.btnSidebarQuickQuestions)
        btnSidebarQuickTranslate = findViewById(R.id.btnSidebarQuickTranslate)
        etSidebarQuery = findViewById(R.id.etSidebarQuery)
        btnSidebarSend = findViewById(R.id.btnSidebarSend)

        // 태블릿 상단 가로 탭 스트립
        layoutTabletTabStrip = findViewById(R.id.layoutTabletTabStrip)
        layoutTabletTabsContainer = findViewById(R.id.layoutTabletTabsContainer)

        // 제스쳐로 새로고침 완전 비활성화
        swipeRefresh.isEnabled = false
    }

    private fun setupResponsiveLayout() {
        val screenWidthDp = resources.configuration.screenWidthDp
        val smallestWidthDp = resources.configuration.smallestScreenWidthDp
        val isTablet = screenWidthDp >= 600 || smallestWidthDp >= 600

        if (isTablet) {
            layoutBottomBar.visibility = View.GONE
            btnTopBack.visibility = View.VISIBLE
            btnTopForward.visibility = View.VISIBLE
            btnTopReload.visibility = View.VISIBLE
            btnTopHome.visibility = View.VISIBLE
            btnMobileReload.visibility = View.GONE
            btnToggleSidebar.visibility = View.VISIBLE
            layoutSidebar.visibility = View.VISIBLE
            isSidebarOpen = true
            layoutTabletTabStrip.visibility = View.VISIBLE
            renderTabletTabStrip()
        } else {
            layoutBottomBar.visibility = View.VISIBLE
            btnTopBack.visibility = View.GONE
            btnTopForward.visibility = View.GONE
            btnTopReload.visibility = View.GONE
            btnTopHome.visibility = View.GONE
            btnMobileReload.visibility = View.VISIBLE
            btnToggleSidebar.visibility = View.GONE
            layoutSidebar.visibility = View.GONE
            isSidebarOpen = false
            layoutTabletTabStrip.visibility = View.GONE
        }
    }

    private fun initTabs() {
        swipeRefresh.isEnabled = false
        if (!loadSavedPersistentTabs()) {
            webViewContainer.removeAllViews()
            tabs.clear()
            addNewTab(START_PAGE_URL, makeActive = true, isSecurity = false)
        }
        applyThemeToViews(getAppThemeMode())
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun createWebViewForTab(initialUrl: String, isSecurity: Boolean): WebView {
        val wv = WebView(this)
        wv.layoutParams = FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.MATCH_PARENT
        )

        val cookieManager = CookieManager.getInstance()
        cookieManager.setAcceptCookie(true)
        cookieManager.setAcceptThirdPartyCookies(wv, !isSecurity)

        wv.isFocusable = true
        wv.isFocusableInTouchMode = true
        wv.addJavascriptInterface(WebAppInterface(this, wv), "AndroidCreamApp")

        wv.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = !isSecurity
            useWideViewPort = true
            loadWithOverviewMode = true
            setSupportZoom(true)
            builtInZoomControls = true
            displayZoomControls = false
            cacheMode = if (isSecurity) WebSettings.LOAD_NO_CACHE else WebSettings.LOAD_DEFAULT
            mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
            allowFileAccess = true
            allowContentAccess = true
            mediaPlaybackRequiresUserGesture = false
            loadsImagesAutomatically = !isDataSaverEnabled()
            textZoom = getTextZoom()
            userAgentString = if (isDesktopSitePreferred(initialUrl)) DESKTOP_USER_AGENT else MOBILE_USER_AGENT
        }
        applyWebDarkModeTo(wv)

        // 다운로드 관리자 연동
        wv.setDownloadListener { url, userAgent, contentDisposition, mimetype, contentLength ->
            startDownloadFile(url, contentDisposition, mimetype, contentLength)
        }

        // 이미지 롱클릭 시 Bag에 담기 팝업 연동
        wv.setOnLongClickListener {
            val result = wv.hitTestResult
            if (result.type == WebView.HitTestResult.IMAGE_TYPE || result.type == WebView.HitTestResult.SRC_IMAGE_ANCHOR_TYPE) {
                val imgUrl = result.extra
                if (!imgUrl.isNullOrBlank()) {
                    showImageLongClickMenu(imgUrl, wv.url ?: "")
                    true
                } else false
            } else false
        }

        wv.setOnScrollChangeListener { _, _, scrollY, _, _ ->
            if (wv == getCurrentWebView()) {
                val isStart = wv.url == START_PAGE_URL || wv.url == START_PAGE_SECURITY_URL || wv.url?.startsWith("file:///android_asset/") == true
        swipeRefresh.isEnabled = false
            }
        }

        wv.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView?, request: WebResourceRequest?): WebResourceResponse? {
                if (isAdBlockEnabled() && shouldBlockRequest(request)) {
                    return WebResourceResponse("text/plain", "UTF-8", ByteArrayInputStream(ByteArray(0)))
                }
                return super.shouldInterceptRequest(view, request)
            }

            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                val url = request?.url?.toString() ?: return false
                if (url.startsWith("http://") || url.startsWith("https://") || url.startsWith("file://")) {
                    return false
                }
                return try {
                    val externalIntent = Intent.parseUri(url, Intent.URI_INTENT_SCHEME)
                    startActivity(externalIntent)
                    true
                } catch (e: Exception) {
                    true
                }
            }

            override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
                super.onPageStarted(view, url, favicon)
                findTabByWebView(view)?.mediaUrl = null
                // 사이트별 PC/모바일 버전 기억을 적용한다
                if (view != null && !url.isNullOrBlank() && (url.startsWith("http://") || url.startsWith("https://"))) {
                    val wantDesktop = isDesktopSitePreferred(url)
                    val isDesktopNow = view.settings.userAgentString == DESKTOP_USER_AGENT
                    if (wantDesktop != isDesktopNow) {
                        view.settings.userAgentString = if (wantDesktop) DESKTOP_USER_AGENT else MOBILE_USER_AGENT
                        view.post {
                            if (view.url == url) view.reload()
                        }
                    }
                }
                // 새 페이지가 열리면 해당 탭의 번역 상태를 초기화한다
                findTabByWebView(view)?.isTranslated = false
                translationJobToken++
                layoutTranslateProgress.visibility = View.GONE
                tvTranslateChipText.text = "번역"
                if (view == getCurrentWebView()) {
                    progressBar.visibility = View.VISIBLE
                    updateBrowserBar(url)
                    val isStart = url == START_PAGE_URL || url == START_PAGE_SECURITY_URL || url?.startsWith("file:///android_asset/") == true
        swipeRefresh.isEnabled = false
                }
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                val rawTitle = view?.title ?: ""
                findTabByWebView(view)?.let { t ->
                    t.title = if (url == START_PAGE_URL || url == START_PAGE_SECURITY_URL || rawTitle.isBlank()) {
                        if (t.isSecurity) "보안 탭" else "시작 페이지"
                    } else rawTitle
                    t.url = url ?: START_PAGE_URL
                    t.lastAccessedTime = System.currentTimeMillis()
                }

                if (view == getCurrentWebView()) {
                    progressBar.visibility = View.GONE
                    swipeRefresh.isRefreshing = false
                    updateBrowserBar(url)
                    extractPageTextForSidebar()
                    if (isTabletLayout()) renderTabletTabStrip()
                    val isStart = url == START_PAGE_URL || url == START_PAGE_SECURITY_URL || url?.startsWith("file:///android_asset/") == true
        swipeRefresh.isEnabled = false

                    if (url == START_PAGE_URL) {
                        view?.evaluateJavascript("if (window.setColorFavicons) window.setColorFavicons(${isColorFaviconsEnabled()});", null)
                        view?.evaluateJavascript("if (window.setWidgetColorful) window.setWidgetColorful(${isWidgetColorfulEnabled()});", null)
                        view?.let { startView ->
                            val activeTheme = getAppThemeMode()
                            if (activeTheme.startsWith("theme-custom")) {
                                startView.evaluateJavascript(
                                    "if (window.setCustomTheme) window.setCustomTheme('" + getCustomAccentHex() + "', " + (if (activeTheme.endsWith("-dark")) "true" else "false") + ");",
                                    null
                                )
                            } else {
                                startView.evaluateJavascript("if (window.setTheme) window.setTheme('" + activeTheme + "');", null)
                            }
                            injectCustomStartBackground(startView, customBackgroundDataUrl())
                        }
                    } else if (url == START_PAGE_SECURITY_URL) {
                        view?.let { injectCustomStartBackground(it, customBackgroundDataUrl()) }
                    }

                    // 보안 탭이 아닐 때만 방문 기록 저장
                    val curTab = getCurrentTab()
                    if (!curTab.isSecurity && !isStart && !url.isNullOrBlank()) {
                        addHistoryEntry(rawTitle, url)
                    }

                    // 외국어 사이트 자동 번역
                    maybeAutoTranslate(view, url)
                }

                // 유튜브: 백그라운드 재생 차단 우회 스크립트 주입
                if (!url.isNullOrBlank() && isYoutubeUrl(url)) {
                    view?.let { injectYoutubeBackgroundAudio(it) }
                }

                if (url?.contains("base44.app") == true) {
                    val monitoringScript = """
                        (function() {
                            function syncToken() {
                                try {
                                    var t = localStorage.getItem('base44_access_token');
                                    if (t && window.AndroidCreamApp) {
                                        window.AndroidCreamApp.onTokenReceived(t);
                                    }
                                } catch(e) {}
                            }
                            syncToken();
                            setInterval(syncToken, 2500);
                        })();
                    """.trimIndent()
                    view?.evaluateJavascript(monitoringScript, null)
                }

                pendingScriptToInject?.let { script ->
                    view?.evaluateJavascript(script, null)
                    pendingScriptToInject = null
                }
            }
        }

        wv.webChromeClient = object : WebChromeClient() {
            override fun onProgressChanged(view: WebView?, newProgress: Int) {
                if (view == getCurrentWebView()) {
                    progressBar.progress = newProgress
                }
            }

            override fun onShowFileChooser(
                wv: WebView?,
                filePathCallback: ValueCallback<Array<Uri>>?,
                fileChooserParams: FileChooserParams?
            ): Boolean {
                fileChooserCallback?.onReceiveValue(null)
                fileChooserCallback = filePathCallback
                val intent = Intent(Intent.ACTION_GET_CONTENT).apply {
                    type = "*/*"
                    putExtra(Intent.EXTRA_MIME_TYPES, arrayOf("image/*", "application/pdf", "text/*"))
                    addCategory(Intent.CATEGORY_OPENABLE)
                }
                fileChooserLauncher.launch(Intent.createChooser(intent, "파일 선택"))
                return true
            }

            override fun onShowCustomView(view: View?, callback: CustomViewCallback?) {
                if (customView != null) {
                    onHideCustomView()
                    return
                }
                customView = view
                customViewCallback = callback
                if (view != null) {
                    rootLayout.addView(view, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
                    layoutTopBar.visibility = View.GONE
                    layoutBottomBar.visibility = View.GONE
                    layoutSidebar.visibility = View.GONE
                }
            }

            override fun onHideCustomView() {
                customView?.let { rootLayout.removeView(it) }
                customView = null
                customViewCallback?.onCustomViewHidden()
                customViewCallback = null
                layoutTopBar.visibility = View.VISIBLE
                if (!isTabletLayout()) layoutBottomBar.visibility = View.VISIBLE
            }
        }

        wv.loadUrl(initialUrl)
        return wv
    }

    private fun addNewTab(url: String = START_PAGE_URL, makeActive: Boolean = true, isSecurity: Boolean = false, groupId: String? = null) {
        val targetUrl = if (url == START_PAGE_URL) {
            getHomeUrl(isSecurity)
        } else url
        val initialUrl = if (targetUrl == START_PAGE_URL && isSecurity) START_PAGE_SECURITY_URL else targetUrl
        val newWv = createWebViewForTab(initialUrl, isSecurity)
        val tabId = System.currentTimeMillis().toString()
        val newTab = WebTab(
            id = tabId,
            title = if (isSecurity) "보안 탭" else if (url == START_PAGE_URL || targetUrl == START_PAGE_URL) "시작 페이지" else "새 탭",
            url = initialUrl,
            webView = newWv,
            isSecurity = isSecurity,
            groupId = groupId,
            isInactive = false,
            lastAccessedTime = System.currentTimeMillis()
        )

        webViewContainer.addView(newWv)
        tabs.add(newTab)

        if (makeActive) {
            switchTab(tabs.size - 1)
        } else {
            newWv.visibility = View.GONE
        }
        manageInactiveTabs()
        updateTabBadge()
        saveTabsToPrefs()
        if (splitActive) layoutSplitPanes()
        if (isTabletLayout()) renderTabletTabStrip()
    }

    private fun switchTab(index: Int) {
        if (index !in tabs.indices) return
        if (splitActive && splitTab()?.id == tabs[index].id) {
            exitSplitView(false)
        }

        if (activeTabIndex in tabs.indices) {
            tabs[activeTabIndex].webView.visibility = View.GONE
        }

        activeTabIndex = index
        val activeTab = tabs[activeTabIndex]
        activeTab.lastAccessedTime = System.currentTimeMillis()

        // 비활성 탭 복원 처리 (메모리 절약 해제)
        if (activeTab.isInactive) {
            activeTab.isInactive = false
            activeTab.webView.onResume()
        }

        activeTab.webView.visibility = View.VISIBLE
        activeTab.webView.bringToFront()

        applyTabModeTheme(activeTab.isSecurity)
        updateBrowserBar(activeTab.webView.url ?: activeTab.url)
        updateTabBadge()

        val isStart = activeTab.url == START_PAGE_URL || activeTab.url == START_PAGE_SECURITY_URL || activeTab.url.startsWith("file:///android_asset/")
        swipeRefresh.isEnabled = false

        manageInactiveTabs()
        if (splitActive) layoutSplitPanes()
        if (isTabletLayout()) renderTabletTabStrip()
    }

    private fun closeTab(index: Int) {
        if (index !in tabs.indices) return

        val tabToRemove = tabs[index]
        if (splitActive && tabToRemove.id == splitTabId) exitSplitView(false)
        (tabToRemove.webView.parent as? ViewGroup)?.removeView(tabToRemove.webView)
        tabToRemove.webView.destroy()
        tabs.removeAt(index)

        if (tabs.isEmpty()) {
            addNewTab(START_PAGE_URL, true, isSecurity = false)
        } else {
            if (activeTabIndex >= tabs.size) {
                activeTabIndex = tabs.size - 1
            }
            switchTab(activeTabIndex)
        }
        updateTabBadge()
        if (splitActive) layoutSplitPanes()
        if (isTabletLayout()) renderTabletTabStrip()
    }

    private fun closeAllTabsInMode(isSecurityMode: Boolean) {
        val toRemove = tabs.filter { it.isSecurity == isSecurityMode }
        for (tab in toRemove) {
            (tab.webView.parent as? ViewGroup)?.removeView(tab.webView)
            tab.webView.destroy()
            tabs.remove(tab)
        }

        if (tabs.isEmpty()) {
            addNewTab(START_PAGE_URL, true, isSecurity = false)
        } else {
            if (activeTabIndex >= tabs.size) {
                activeTabIndex = tabs.size - 1
            }
            switchTab(activeTabIndex)
        }
        updateTabBadge()
    }

    // 비활성 탭 메모리 관리: 활성화되지 않은 탭들을 절전 상태로 전환하여 메모리 절약
    private fun manageInactiveTabs() {
        val now = System.currentTimeMillis()
        for (i in tabs.indices) {
            val t = tabs[i]
            if (i != activeTabIndex && !t.isInactive) {
                // 3개 이상 열려 있거나 5분 이상 미사용 시 절전 전환
                if (tabs.size >= 4 || (now - t.lastAccessedTime > 300000)) {
                    t.isInactive = true
                    t.webView.onPause()
                }
            }
        }
    }

    private fun closeAllInactiveTabs(isSecurityMode: Boolean) {
        val toRemove = tabs.filter { it.isSecurity == isSecurityMode && it.isInactive }
        for (tab in toRemove) {
            (tab.webView.parent as? ViewGroup)?.removeView(tab.webView)
            tab.webView.destroy()
            tabs.remove(tab)
        }
        if (activeTabIndex >= tabs.size) {
            activeTabIndex = if (tabs.isNotEmpty()) tabs.size - 1 else 0
        }
        if (tabs.isEmpty()) {
            addNewTab(START_PAGE_URL, true, isSecurity = false)
        } else {
            switchTab(activeTabIndex)
        }
        updateTabBadge()
    }

    private fun applyTabModeTheme(isSecurity: Boolean) {
        if (isSecurity) {
            layoutTopBar.backgroundTintList = glassTint(Color.parseColor("#09090B"))
            layoutAddressBar.backgroundTintList = glassTint(omniboxTint(Color.parseColor("#18181B")), 226)
            etBrowserUrl.setTextColor(Color.WHITE)
            etBrowserUrl.setHintTextColor(Color.parseColor("#71717A"))
            tvTopSecurityBadge.visibility = View.VISIBLE
            ivUrlIcon.setImageResource(R.drawable.ic_shield)
            ivUrlIcon.imageTintList = ColorStateList.valueOf(Color.parseColor("#818CF8"))
            btnTopMenu.imageTintList = ColorStateList.valueOf(Color.WHITE)
            btnMobileReload.imageTintList = ColorStateList.valueOf(Color.WHITE)
            btnTopBack.imageTintList = ColorStateList.valueOf(Color.WHITE)
            btnTopForward.imageTintList = ColorStateList.valueOf(Color.WHITE)
            btnTopReload.imageTintList = ColorStateList.valueOf(Color.WHITE)
            btnTopHome.imageTintList = ColorStateList.valueOf(Color.WHITE)
            layoutBottomBar.backgroundTintList = glassTint(Color.parseColor("#0D0F12"))
            btnNavBack.imageTintList = ColorStateList.valueOf(Color.WHITE)
            btnNavForward.imageTintList = ColorStateList.valueOf(Color.WHITE)
            btnNavHome.imageTintList = ColorStateList.valueOf(Color.WHITE)
            tvNavTabCount.setBackgroundResource(R.drawable.bg_tab_counter_dark)
            tvNavTabCount.setTextColor(Color.WHITE)
        } else {
            tvTopSecurityBadge.visibility = View.GONE
            applyThemeToViews(getAppThemeMode())
        }
        if (isTabletLayout()) renderTabletTabStrip()
    }

    private fun updateTabBadge() {
        val currentTab = getCurrentTab()
        val count = tabs.count { it.isSecurity == currentTab.isSecurity }
        tvNavTabCount.text = count.toString()
    }

    private fun findTabByWebView(wv: WebView?): WebTab? {
        return tabs.find { it.webView == wv }
    }

    private fun getCurrentTab(): WebTab {
        return if (activeTabIndex in tabs.indices) tabs[activeTabIndex] else tabs[0]
    }

    private fun getCurrentWebView(): WebView {
        return getCurrentTab().webView
    }

    private fun setupBrowserControls() {
        // 주소창 엔터 검색
        etBrowserUrl.setOnEditorActionListener { _, actionId, event ->
            if (actionId == EditorInfo.IME_ACTION_GO || actionId == EditorInfo.IME_ACTION_DONE ||
                (event?.keyCode == KeyEvent.KEYCODE_ENTER && event.action == KeyEvent.ACTION_DOWN)
            ) {
                val input = etBrowserUrl.text.toString().trim()
                if (input.isNotEmpty()) {
                    saveSearchQuery(input)
                    loadWebQuery(input)
                    hideSearchSuggestions()
                }
                true
            } else {
                false
            }
        }

        btnClearUrl.setOnClickListener {
            etBrowserUrl.setText("")
        }

        // 보안 아이콘 탭 시 보안 현황 바텀시트 오픈
        ivUrlIcon.setOnClickListener {
            showSecurityInfoDialog()
        }

        // 상단 메뉴 버튼
        btnTopMenu.setOnClickListener {
            showMenuDialog()
        }

        // 상단 내비게이션
        btnTopBack.setOnClickListener { if (getCurrentWebView().canGoBack()) getCurrentWebView().goBack() }
        btnTopForward.setOnClickListener { if (getCurrentWebView().canGoForward()) getCurrentWebView().goForward() }
        btnTopReload.setOnClickListener { getCurrentWebView().reload() }
        btnMobileReload.setOnClickListener { getCurrentWebView().reload() }
        btnTopHome.setOnClickListener {
            val cur = getCurrentTab()
            getCurrentWebView().loadUrl(getHomeUrl(cur.isSecurity))
        }

        // 사이드바 토글 버튼 (태블릿 전용)
        btnToggleSidebar.setOnClickListener {
            toggleSidebar()
        }

        // 하단 모바일 내비게이션
        btnNavBack.setOnClickListener { if (getCurrentWebView().canGoBack()) getCurrentWebView().goBack() }
        btnNavForward.setOnClickListener { if (getCurrentWebView().canGoForward()) getCurrentWebView().goForward() }
        btnNavHome.setOnClickListener {
            val cur = getCurrentTab()
            getCurrentWebView().loadUrl(getHomeUrl(cur.isSecurity))
        }

        btnNavCreamy.setOnClickListener {
            val screenWidthDp = resources.configuration.screenWidthDp
            val smallestWidthDp = resources.configuration.smallestScreenWidthDp
            val isTablet = screenWidthDp >= 600 || smallestWidthDp >= 600

            if (isTablet) {
                toggleSidebar()
            } else {
                showCreamyBottomSheet()
            }
        }

        btnNavTabs.setOnClickListener {
            showTabManagerDialog()
        }
    }

    private fun setupOmniboxSuggestions() {
        etBrowserUrl.setOnFocusChangeListener { _, hasFocus ->
            if (hasFocus) {
                showSearchSuggestions()
                btnClearUrl.visibility = if (etBrowserUrl.text.isNotEmpty()) View.VISIBLE else View.GONE
            } else {
                hideSearchSuggestions()
                btnClearUrl.visibility = View.GONE
            }
        }

        etBrowserUrl.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {
                btnClearUrl.visibility = if (!s.isNullOrEmpty()) View.VISIBLE else View.GONE
                updateLiveSearchSuggestions(s?.toString()?.trim() ?: "")
            }
            override fun afterTextChanged(s: Editable?) {}
        })

        btnClearSearchHistory.setOnClickListener {
            clearSearchQueries()
            populateRecentSearches("")
        }

        chipClipboardPaste.setOnClickListener {
            val clipText = tvClipboardText.tag as? String ?: ""
            if (clipText.isNotBlank()) {
                hideSearchSuggestions()
                loadWebQuery(clipText)
            }
        }
    }

    private fun showSearchSuggestions() {
        layoutSearchSuggestions.visibility = View.VISIBLE
        checkClipboardForOmnibox()
        populateRecentSearches(etBrowserUrl.text.toString().trim())
        populateRecentSitesChips()
    }

    private fun hideSearchSuggestions() {
        layoutSearchSuggestions.visibility = View.GONE
    }

    private fun checkClipboardForOmnibox() {
        try {
            val clipboard = getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager ?: return
            val clip = clipboard.primaryClip
            if (clip != null && clip.itemCount > 0) {
                val text = clip.getItemAt(0).text?.toString()?.trim() ?: ""
                if (text.isNotBlank() && text.length > 2) {
                    chipClipboardPaste.visibility = View.VISIBLE
                    tvClipboardText.text = "붙여넣기: " + text.take(30)
                    tvClipboardText.tag = text
                    return
                }
            }
        } catch (e: Exception) {}
        chipClipboardPaste.visibility = View.GONE
    }

    private fun populateRecentSearches(filterText: String) {
        layoutRecentSearchesContainer.removeAllViews()
        val queries = getSavedSearchQueries()
        val filtered = if (filterText.isBlank()) queries else queries.filter { it.contains(filterText, ignoreCase = true) }

        if (filtered.isEmpty()) {
            val emptyTv = TextView(this).apply {
                text = if (filterText.isBlank()) "최근 검색어가 없습니다." else "'$filterText' 검색하기"
                textSize = 12f
                setTextColor(uiTextSecondary())
                setPadding(6, 12, 6, 12)
            }
            if (filterText.isNotBlank()) {
                emptyTv.setOnClickListener {
                    saveSearchQuery(filterText)
                    loadWebQuery(filterText)
                    hideSearchSuggestions()
                }
            }
            layoutRecentSearchesContainer.addView(emptyTv)
            return
        }

        for (q in filtered.take(6)) {
            val row = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                layoutParams = LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT,
                    resources.getDimensionPixelSize(android.R.dimen.app_icon_size).coerceAtMost(90)
                )
                setPadding(6, 10, 6, 10)
                gravity = android.view.Gravity.CENTER_VERTICAL
                isClickable = true
                isFocusable = true
                setBackgroundResource(R.drawable.bg_result_box)
            }

            val icon = ImageView(this).apply {
                layoutParams = LinearLayout.LayoutParams(40, 40).apply { marginEnd = 16 }
                setImageResource(R.drawable.ic_search)
                imageTintList = ColorStateList.valueOf(getColor(R.color.text_muted))
            }

            val tv = TextView(this).apply {
                layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                text = q
                textSize = 13f
                setTextColor(uiTextPrimary())
            }

            val delBtn = ImageView(this).apply {
                layoutParams = LinearLayout.LayoutParams(40, 40)
                setImageResource(R.drawable.ic_close)
                imageTintList = ColorStateList.valueOf(getColor(R.color.text_muted))
                setPadding(6, 6, 6, 6)
                setOnClickListener {
                    deleteSearchQuery(q)
                    populateRecentSearches(etBrowserUrl.text.toString().trim())
                }
            }

            row.addView(icon)
            row.addView(tv)
            row.addView(delBtn)

            row.setOnClickListener {
                etBrowserUrl.setText(q)
                saveSearchQuery(q)
                loadWebQuery(q)
                hideSearchSuggestions()
            }

            layoutRecentSearchesContainer.addView(row)
        }
    }

    private fun updateLiveSearchSuggestions(query: String) {
        populateRecentSearches(query)
    }

    private fun populateRecentSitesChips() {
        layoutRecentSitesChips.removeAllViews()
        val history = getSavedHistory().take(5)
        for (item in history) {
            val chip = TextView(this).apply {
                text = item.title.take(12)
                textSize = 11.5f
                setTextColor(uiTextPrimary())
                setBackgroundResource(R.drawable.bg_pill_badge)
                setPadding(24, 12, 24, 12)
                layoutParams = LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.WRAP_CONTENT,
                    LinearLayout.LayoutParams.WRAP_CONTENT
                ).apply { marginEnd = 16 }
                setOnClickListener {
                    loadWebQuery(item.url)
                    hideSearchSuggestions()
                }
            }
            layoutRecentSitesChips.addView(chip)
        }
    }

    // 보안 현황 다이얼로그 (SSL 인증서, HTTPS, 쿠키 수, 권한)
    private fun showSecurityInfoDialog() {
        if (isTabletLayout()) {
            switchSidebarTab("menu")
            if (layoutSidebar.visibility != View.VISIBLE) toggleSidebar("menu")
            return
        }
        val dialog = createConfiguredBottomSheetDialog()
        val view = layoutInflater.inflate(R.layout.dialog_security_info, null)
        dialog.setContentView(view)
        applyTouchAnimationToAll(view)

        val ivStatusIcon = view.findViewById<ImageView>(R.id.ivSecurityStatusIcon)
        val tvStatusTitle = view.findViewById<TextView>(R.id.tvSecurityStatusTitle)
        val tvHost = view.findViewById<TextView>(R.id.tvSecurityHost)
        val tvDesc = view.findViewById<TextView>(R.id.tvSecurityDesc)
        val tvCertDetails = view.findViewById<TextView>(R.id.tvCertDetails)
        val tvCookieDetails = view.findViewById<TextView>(R.id.tvCookieDetails)
        val btnClearCookies = view.findViewById<Button>(R.id.btnClearSiteCookies)
        val btnConfirm = view.findViewById<Button>(R.id.btnConfirmSecurity)
        val btnClose = view.findViewById<ImageView>(R.id.btnCloseSecurityDialog)

        val curTab = getCurrentTab()
        val currentUrl = curTab.webView.url ?: START_PAGE_URL
        val host = try { Uri.parse(currentUrl).host ?: currentUrl } catch (e: Exception) { currentUrl }

        tvHost.text = host

        if (curTab.isSecurity) {
            ivStatusIcon.setImageResource(R.drawable.ic_shield)
            ivStatusIcon.imageTintList = ColorStateList.valueOf(Color.parseColor("#6366F1"))
            tvStatusTitle.text = "보안 탭 모드"
            tvDesc.text = "보안 탭에서는 방문 기록, 쿠키, 사이트 데이터가 기기에 저장되지 않습니다."
            tvCertDetails.text = "종료 시 모든 세션 및 임시 데이터 즉시 영구 파기"
            tvCookieDetails.text = "보안 탭 격리 쿠키 (종료 시 삭제)"
        } else if (currentUrl.startsWith("https://")) {
            ivStatusIcon.setImageResource(R.drawable.ic_lock)
            ivStatusIcon.imageTintList = ColorStateList.valueOf(Color.parseColor("#10B981"))
            tvStatusTitle.text = "연결이 안전함"
            tvDesc.text = "이 사이트로 전송하는 정보(예: 비밀번호, 신용카드 번호)는 비공개로 유지되며 256-bit 강력 암호화됩니다."
            tvCertDetails.text = "유효한 SSL/TLS 인증서 발급됨 (TLS 1.3 보안 연결)"
            val cookie = CookieManager.getInstance().getCookie(currentUrl)
            val cookieCount = if (cookie.isNullOrBlank()) 0 else cookie.split(";").size
            tvCookieDetails.text = "현재 사이트 쿠키 $cookieCount 개 사용 중"
        } else if (currentUrl.startsWith("http://")) {
            ivStatusIcon.setImageResource(R.drawable.ic_warning)
            ivStatusIcon.imageTintList = ColorStateList.valueOf(Color.parseColor("#EF4444"))
            tvStatusTitle.text = "주의 요함 (보안되지 않음)"
            tvDesc.text = "이 사이트는 암호화되지 않은 HTTP 연결을 사용합니다. 비밀번호나 카드 번호를 입력하지 마세요."
            tvCertDetails.text = "인증서 없음 (암호화되지 않은 평문 통신)"
            tvCookieDetails.text = "비보안 연결 쿠키"
        } else {
            ivStatusIcon.setImageResource(R.drawable.ic_shield)
            ivStatusIcon.imageTintList = ColorStateList.valueOf(getColor(R.color.primary_black))
            tvStatusTitle.text = "Cream Browser 내부 시스템"
            tvDesc.text = "로컬 안전 샌드박스에서 보호되고 있습니다."
            tvCertDetails.text = "로컬 애플리케이션 보안 영역"
            tvCookieDetails.text = "내부 로컬 저장소"
        }

        btnClearCookies.setOnClickListener {
            CookieManager.getInstance().removeAllCookies(null)
            CookieManager.getInstance().flush()
            Toast.makeText(this, "사이트 쿠키가 삭제되었습니다", Toast.LENGTH_SHORT).show()
            dialog.dismiss()
            getCurrentWebView().reload()
        }

        btnConfirm.setOnClickListener { dialog.dismiss() }
        btnClose.setOnClickListener { dialog.dismiss() }

        dialog.show()
    }

    // 탭 관리자 (일반 탭 vs 보안 탭 세그먼트, 탭 그룹, 비활성 절전 탭 관리)
    private fun showTabManagerDialog() {
        val dialog = createConfiguredBottomSheetDialog()
        val view = layoutInflater.inflate(R.layout.dialog_tab_manager, null)
        dialog.setContentView(view)
        applyTouchAnimationToAll(view)

        var isViewingSecurityMode = getCurrentTab().isSecurity

        val btnSegmentNormal = view.findViewById<TextView>(R.id.btnSegmentNormalTabs)
        val btnSegmentSecurity = view.findViewById<TextView>(R.id.btnSegmentSecurityTabs)
        val tvTabTitle = view.findViewById<TextView>(R.id.tvTabManagerTitle)
        val tvTabCountBadge = view.findViewById<TextView>(R.id.tvTabCountBadge)
        val layoutTabsList = view.findViewById<LinearLayout>(R.id.layoutTabsList)
        val bannerInactive = view.findViewById<LinearLayout>(R.id.bannerInactiveTabs)
        val tvInactiveText = view.findViewById<TextView>(R.id.tvInactiveBannerText)
        val btnCloseInactive = view.findViewById<TextView>(R.id.btnCloseInactiveTabs)
        val btnNewTabTop = view.findViewById<Button>(R.id.btnNewTabTop)
        val btnNewTabBottom = view.findViewById<Button>(R.id.btnNewTabBottom)
        val btnCloseAllTabs = view.findViewById<Button>(R.id.btnCloseAllTabs)
        val btnClose = view.findViewById<ImageView>(R.id.btnCloseTabManager)

        fun updateSegmentUI() {
            if (!isViewingSecurityMode) {
                btnSegmentNormal.setBackgroundResource(R.drawable.bg_pill_badge)
                btnSegmentNormal.backgroundTintList = ColorStateList.valueOf(getColor(R.color.primary_black))
                btnSegmentNormal.setTextColor(Color.WHITE)

                btnSegmentSecurity.background = null
                btnSegmentSecurity.setTextColor(getColor(R.color.text_muted))

                tvTabTitle.text = "열린 탭"
                btnNewTabTop.text = "+ 새 탭"
                btnNewTabBottom.text = "+ 새 탭 열기"
                btnCloseAllTabs.text = "모두 닫기"
            } else {
                btnSegmentSecurity.setBackgroundResource(R.drawable.bg_pill_badge)
                btnSegmentSecurity.backgroundTintList = ColorStateList.valueOf(Color.parseColor("#4F46E5"))
                btnSegmentSecurity.setTextColor(Color.WHITE)

                btnSegmentNormal.background = null
                btnSegmentNormal.setTextColor(getColor(R.color.text_muted))

                tvTabTitle.text = "보안 탭"
                btnNewTabTop.text = "+ 새 보안 탭"
                btnNewTabBottom.text = "+ 새 보안 탭 열기"
                btnCloseAllTabs.text = "보안 탭 모두 닫기"
            }
        }

        fun populateTabs() {
            layoutTabsList.removeAllViews()
            updateSegmentUI()

            val currentTabs = tabs.filter { it.isSecurity == isViewingSecurityMode }
            tvTabCountBadge.text = currentTabs.size.toString()

            // 비활성 탭 배너 처리
            val inactiveCount = currentTabs.count { it.isInactive }
            if (inactiveCount > 0) {
                bannerInactive.visibility = View.VISIBLE
                tvInactiveText.text = "${inactiveCount}개 탭이 절전 모드로 메모리를 절약 중입니다"
                btnCloseInactive.setOnClickListener {
                    closeAllInactiveTabs(isViewingSecurityMode)
                    populateTabs()
                }
            } else {
                bannerInactive.visibility = View.GONE
            }

            // 탭 그룹별 렌더링
    
            val renderedGroups = mutableSetOf<String>()

            for (i in tabs.indices) {
                val tab = tabs[i]
                if (tab.isSecurity != isViewingSecurityMode) continue

                // 탭 그룹에 속한 경우 그룹 헤더 렌더링
                if (!tab.groupId.isNullOrBlank()) {
                    val gId = tab.groupId!!
                    val group = tabGroups.find { it.id == gId }
                    if (group != null && !renderedGroups.contains(gId)) {
                        renderedGroups.add(gId)
                        val groupHeader = createGroupHeaderView(group, isViewingSecurityMode) {
                            populateTabs()
                        }
                        layoutTabsList.addView(groupHeader)
                    }

                    // 그룹이 접혀 있는 경우 탭 숨김
                    if (group?.isCollapsed == true) continue
                }

                val cardView = layoutInflater.inflate(R.layout.item_tab_card, layoutTabsList, false)
                val tvTitle = cardView.findViewById<TextView>(R.id.tvTabTitle)
                val tvUrl = cardView.findViewById<TextView>(R.id.tvTabUrl)
                val tvActiveBadge = cardView.findViewById<TextView>(R.id.tvActiveBadge)
                val tvInactiveBadge = cardView.findViewById<TextView>(R.id.tvInactiveBadge)
                val tvGroupTag = cardView.findViewById<TextView>(R.id.tvGroupTag)
                val tvSecurityBadge = cardView.findViewById<TextView>(R.id.tvSecurityTabBadge)
                val btnGroupAction = cardView.findViewById<ImageView>(R.id.btnTabGroupAction)
                val btnTabClose = cardView.findViewById<ImageView>(R.id.btnTabClose)

                val displayTitle = if (tab.url == START_PAGE_URL || tab.url == START_PAGE_SECURITY_URL || tab.title.isBlank()) {
                    if (tab.isSecurity) "보안 탭" else "시작 페이지"
                } else tab.title

                val displayUrl = if (tab.url == START_PAGE_URL || tab.url == START_PAGE_SECURITY_URL) "Cream Browser (Home)" else tab.url

                tvTitle.text = displayTitle
                tvUrl.text = displayUrl

                tvActiveBadge.visibility = if (i == activeTabIndex) View.VISIBLE else View.GONE
                tvInactiveBadge.visibility = if (tab.isInactive) View.VISIBLE else View.GONE
                tvSecurityBadge.visibility = if (tab.isSecurity) View.VISIBLE else View.GONE

                if (!tab.groupId.isNullOrBlank()) {
                    val g = tabGroups.find { it.id == tab.groupId }
                    if (g != null) {
                        tvGroupTag.visibility = View.VISIBLE
                        tvGroupTag.text = g.title
                        tvGroupTag.backgroundTintList = ColorStateList.valueOf(Color.parseColor(g.colorHex))
                    }
                } else {
                    tvGroupTag.visibility = View.GONE
                }

                cardView.setOnClickListener {
                    switchTab(i)
                    dialog.dismiss()
                }

                btnGroupAction.setOnClickListener {
                    showGroupPickerDialog(tab) {
                        populateTabs()
                    }
                }

                btnTabClose.setOnClickListener {
                    closeTab(i)
                    populateTabs()
                }

                layoutTabsList.addView(cardView)
            }
        }

        btnSegmentNormal.setOnClickListener {
            isViewingSecurityMode = false
            populateTabs()
        }

        btnSegmentSecurity.setOnClickListener {
            isViewingSecurityMode = true
            populateTabs()
        }

        populateTabs()

        btnNewTabTop.setOnClickListener {
            addNewTab(START_PAGE_URL, true, isSecurity = isViewingSecurityMode)
            dialog.dismiss()
        }

        btnNewTabBottom.setOnClickListener {
            addNewTab(START_PAGE_URL, true, isSecurity = isViewingSecurityMode)
            dialog.dismiss()
        }

        btnCloseAllTabs.setOnClickListener {
            closeAllTabsInMode(isViewingSecurityMode)
            dialog.dismiss()
        }

        btnClose.setOnClickListener {
            dialog.dismiss()
        }

        dialog.show()
    }

    private fun createGroupHeaderView(group: TabGroup, isSecurityMode: Boolean, onRefresh: () -> Unit): View {
        val header = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = android.view.Gravity.CENTER_VERTICAL
            setPadding(8, 12, 8, 8)
        }

        val dot = View(this).apply {
            layoutParams = LinearLayout.LayoutParams(24, 24).apply { marginEnd = 12 }
            setBackgroundResource(R.drawable.bg_tab_counter)
            backgroundTintList = ColorStateList.valueOf(Color.parseColor(group.colorHex))
        }

        val title = TextView(this).apply {
            text = group.title
            textSize = 13f
            setTypeface(null, android.graphics.Typeface.BOLD)
            setTextColor(getColor(R.color.primary_black))
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        }

        val countBadge = TextView(this).apply {
            val c = tabs.count { it.groupId == group.id && it.isSecurity == isSecurityMode }
            text = "${c}개 탭"
            textSize = 10.5f
            setTextColor(getColor(R.color.text_muted))
            setPadding(12, 4, 12, 4)
            setBackgroundResource(R.drawable.bg_pill_badge)
        }

        val toggleBtn = TextView(this).apply {
            text = if (group.isCollapsed) " [펼치기]" else " [접기]"
            textSize = 11f
            setTextColor(getColor(R.color.text_muted))
            setPadding(8, 4, 8, 4)
            setOnClickListener {
                group.isCollapsed = !group.isCollapsed
                onRefresh()
            }
        }

        header.addView(dot)
        header.addView(title)
        header.addView(countBadge)
        header.addView(toggleBtn)
        return header
    }

    private fun showGroupPickerDialog(tab: WebTab, forNewGroup: Boolean = false, onComplete: () -> Unit) {
        val dialog = createConfiguredBottomSheetDialog()
        val view = layoutInflater.inflate(R.layout.dialog_group_picker, null)
        dialog.setContentView(view)
        applyTouchAnimationToAll(view)

        val etGroupName = view.findViewById<EditText>(R.id.etGroupName)
        val btnApply = view.findViewById<Button>(R.id.btnApplyGroup)
        val btnRemove = view.findViewById<Button>(R.id.btnRemoveFromGroup)
        val btnClose = view.findViewById<ImageView>(R.id.btnCloseGroupPicker)
        val presetRow = view.findViewById<LinearLayout>(R.id.layoutGroupNamePresets)

        var selectedColor = "#3B82F6"

        val colorViews = listOf(
            view.findViewById<View>(R.id.colorBlue) to "#3B82F6",
            view.findViewById<View>(R.id.colorPurple) to "#8B5CF6",
            view.findViewById<View>(R.id.colorGreen) to "#10B981",
            view.findViewById<View>(R.id.colorOrange) to "#F59E0B",
            view.findViewById<View>(R.id.colorPink) to "#EC4899",
            view.findViewById<View>(R.id.colorGray) to "#71717A"
        )

        fun renderColorSelection() {
            for ((colorView, hex) in colorViews) {
                val picked = hex == selectedColor
                colorView.alpha = if (picked) 1f else 0.35f
                colorView.scaleX = if (picked) 1.15f else 1f
                colorView.scaleY = if (picked) 1.15f else 1f
            }
        }

        for ((colorView, hex) in colorViews) {
            colorView.setOnClickListener {
                selectedColor = hex
                renderColorSelection()
            }
        }

        // 빠른 이름 프리셋 (업무, 쇼핑, 뉴스, 리서치, 공부)
        val palette = sidebarPalette(getAppThemeMode())
        for (preset in listOf("업무", "쇼핑", "뉴스", "리서치", "공부")) {
            val chip = TextView(this).apply {
                text = preset
                textSize = 11f
                gravity = android.view.Gravity.CENTER
                setPadding(dpToPx(12), dpToPx(6), dpToPx(12), dpToPx(6))
                layoutParams = LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.WRAP_CONTENT,
                    LinearLayout.LayoutParams.WRAP_CONTENT
                ).apply { marginEnd = dpToPx(6) }
                setBackgroundResource(R.drawable.bg_pill_badge)
                backgroundTintList = ColorStateList.valueOf(Color.parseColor("#F4F4F5"))
                setTextColor(Color.parseColor("#111111"))
                setOnClickListener { etGroupName.setText(preset) }
            }
            presetRow.addView(chip)
        }

        // 기존 그룹이 있으면 표시
        if (!forNewGroup && !tab.groupId.isNullOrBlank()) {
            val curG = tabGroups.find { it.id == tab.groupId }
            if (curG != null) {
                etGroupName.setText(curG.title)
                selectedColor = curG.colorHex
            }
        }
        renderColorSelection()

        btnApply.setOnClickListener {
            val name = etGroupName.text.toString().trim()
            if (name.isEmpty()) {
                Toast.makeText(this, "그룹 이름을 입력하세요", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }
            var group = tabGroups.find { it.title == name }
            if (group == null) {
                group = TabGroup("g" + System.currentTimeMillis(), name, selectedColor)
                tabGroups.add(group)
            } else {
                group.colorHex = selectedColor
            }
            saveTabGroups()
            tab.groupId = group.id
            tab.groupName = group.title
            tab.groupColor = group.colorHex
            saveTabsToPrefs()
            Toast.makeText(this, "'" + group.title + "' 그룹에 지정되었습니다", Toast.LENGTH_SHORT).show()
            dialog.dismiss()
            if (isTabletLayout()) renderTabletTabStrip()
            onComplete()
        }

        btnRemove.setOnClickListener {
            tab.groupId = null
            tab.groupName = null
            tab.groupColor = null
            saveTabsToPrefs()
            Toast.makeText(this, "그룹이 해제되었습니다", Toast.LENGTH_SHORT).show()
            dialog.dismiss()
            if (isTabletLayout()) renderTabletTabStrip()
            onComplete()
        }

        btnClose.setOnClickListener { dialog.dismiss() }
        dialog.show()
    }

    // 태블릿 탭 롱클릭: 새 그룹 / 그룹 변경 / 그룹 해제
    private fun showTabGroupActionDialog(tabIndex: Int) {
        if (tabIndex !in tabs.indices) return
        val tab = tabs[tabIndex]
        val dialog = createConfiguredBottomSheetDialog()
        val view = layoutInflater.inflate(R.layout.dialog_tab_group_action, null)
        dialog.setContentView(view)
        applyTouchAnimationToAll(view)

        view.findViewById<TextView>(R.id.tvGroupActionTabTitle)?.text = when {
            tab.title.isBlank() -> if (tab.isSecurity) "보안 탭" else "새 탭"
            else -> tab.title
        }
        val currentGroup = tabGroups.find { it.id == tab.groupId }
        view.findViewById<LinearLayout>(R.id.btnActionRemoveGroup)?.apply {
            isEnabled = currentGroup != null
            alpha = if (currentGroup != null) 1f else 0.4f
        }

        view.findViewById<LinearLayout>(R.id.btnActionNewGroup)?.setOnClickListener {
            dialog.dismiss()
            showGroupPickerDialog(tab, forNewGroup = true) { renderTabletTabStrip() }
        }
        view.findViewById<LinearLayout>(R.id.btnActionChangeGroup)?.setOnClickListener {
            dialog.dismiss()
            showGroupChangePicker(tab)
        }
        view.findViewById<LinearLayout>(R.id.btnActionRemoveGroup)?.setOnClickListener {
            tab.groupId = null
            tab.groupName = null
            tab.groupColor = null
            saveTabsToPrefs()
            renderTabletTabStrip()
            dialog.dismiss()
            Toast.makeText(this, "그룹이 해제되었습니다", Toast.LENGTH_SHORT).show()
        }
        view.findViewById<Button>(R.id.btnCancelGroupAction)?.setOnClickListener { dialog.dismiss() }
        view.findViewById<ImageView>(R.id.btnCloseGroupAction)?.setOnClickListener { dialog.dismiss() }
        dialog.show()
    }

    private fun showGroupChangePicker(tab: WebTab) {
        if (tabGroups.isEmpty()) {
            showGroupPickerDialog(tab, forNewGroup = true) { renderTabletTabStrip() }
            return
        }
        val names = tabGroups.map { it.title }.toTypedArray()
        val currentIndex = tabGroups.indexOfFirst { it.id == tab.groupId }
        val options = names + "+ 새 그룹 만들기"
        AlertDialog.Builder(this)
            .setTitle("그룹 변경")
            .setSingleChoiceItems(options, currentIndex) { d, which ->
                if (which == options.size - 1) {
                    d.dismiss()
                    showGroupPickerDialog(tab, forNewGroup = true) { renderTabletTabStrip() }
                    return@setSingleChoiceItems
                }
                val group = tabGroups[which]
                tab.groupId = group.id
                tab.groupName = group.title
                tab.groupColor = group.colorHex
                saveTabsToPrefs()
                renderTabletTabStrip()
                d.dismiss()
                Toast.makeText(this, "'" + group.title + "' 그룹으로 변경되었습니다", Toast.LENGTH_SHORT).show()
            }
            .setNegativeButton("닫기", null)
            .show()
    }


    // Bag 보관함 기능 (링크, 이미지, 텍스트 스크랩)
    private fun showBagDialog() {
        val dialog = createConfiguredBottomSheetDialog()
        val view = layoutInflater.inflate(R.layout.dialog_bag, null)
        dialog.setContentView(view)
        applyTouchAnimationToAll(view)

        val tvBagCount = view.findViewById<TextView>(R.id.tvBagCountBadge)
        val layoutBagItems = view.findViewById<LinearLayout>(R.id.layoutBagItemsList)
        val btnFilterAll = view.findViewById<TextView>(R.id.btnBagFilterAll)
        val btnFilterLinks = view.findViewById<TextView>(R.id.btnBagFilterLinks)
        val btnFilterImages = view.findViewById<TextView>(R.id.btnBagFilterImages)
        val btnFilterTexts = view.findViewById<TextView>(R.id.btnBagFilterTexts)
        val btnAddCurrent = view.findViewById<Button>(R.id.btnAddCurrentToBag)
        val btnAddCustomImage = view.findViewById<Button>(R.id.btnAddCustomImageToBag)
        val btnClear = view.findViewById<Button>(R.id.btnClearBag)
        val btnClose = view.findViewById<ImageView>(R.id.btnCloseBagDialog)

        var currentFilter = "all"

        fun populateBag() {
            layoutBagItems.removeAllViews()
            val items = getSavedBagItems()
            val filtered = when (currentFilter) {
                "link" -> items.filter { it.type == "link" }
                "image" -> items.filter { it.type == "image" }
                "text" -> items.filter { it.type == "text" }
                else -> items
            }

            tvBagCount.text = items.size.toString()

            if (filtered.isEmpty()) {
                val emptyTv = TextView(this).apply {
                    text = "My Bag에 보관된 항목이 없습니다.\n웹서핑 중 원하는 링크나 이미지를 My Bag에 담아보세요!"
                    setTextColor(getColor(R.color.text_muted))
                    setPadding(12, 30, 12, 30)
                    gravity = android.view.Gravity.CENTER
                }
                layoutBagItems.addView(emptyTv)
                return
            }

            val dateFormat = SimpleDateFormat("MM.dd HH:mm", Locale.KOREA)

            for (item in filtered) {
                val itemCard = layoutInflater.inflate(R.layout.item_tab_card, layoutBagItems, false)
                val tvTitle = itemCard.findViewById<TextView>(R.id.tvTabTitle)
                val tvUrl = itemCard.findViewById<TextView>(R.id.tvTabUrl)
                val tvBadge = itemCard.findViewById<TextView>(R.id.tvActiveBadge)
                val ivIcon = itemCard.findViewById<ImageView>(R.id.ivTabFavicon)
                val btnDel = itemCard.findViewById<ImageView>(R.id.btnTabClose)
                val btnGroup = itemCard.findViewById<ImageView>(R.id.btnTabGroupAction)
                btnGroup.visibility = View.GONE

                tvTitle.text = item.title
                tvUrl.text = "${dateFormat.format(Date(item.timestamp))} · ${item.content.take(45)}"

                tvBadge.visibility = View.VISIBLE
                tvBadge.text = when (item.type) {
                    "image" -> "이미지"
                    "link" -> "링크"
                    "pdf" -> "PDF"
                    else -> "텍스트"
                }

                ivIcon.setImageResource(R.drawable.ic_bag)

                itemCard.setOnClickListener {
                    if (item.type == "pdf") {
                        openLocalPdf(item.content)
                    } else if (item.type == "link" || item.content.startsWith("http")) {
                        dialog.dismiss()
                        loadWebQuery(item.content)
                    } else {
                        val clip = getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager
                        clip?.setPrimaryClip(android.content.ClipData.newPlainText("Bag", item.content))
                        Toast.makeText(this@MainActivity, "내용이 클립보드에 복사되었습니다", Toast.LENGTH_SHORT).show()
                    }
                }

                btnDel.setOnClickListener {
                    deleteBagItem(item.id)
                    populateBag()
                }

                layoutBagItems.addView(itemCard)
            }
        }

        fun updateFilterTabs() {
            val normalBg: View? = null
            btnFilterAll.setTextColor(if (currentFilter == "all") Color.WHITE else getColor(R.color.text_muted))
            btnFilterAll.backgroundTintList = if (currentFilter == "all") ColorStateList.valueOf(getColor(R.color.primary_black)) else null

            btnFilterLinks.setTextColor(if (currentFilter == "link") Color.WHITE else getColor(R.color.text_muted))
            btnFilterLinks.backgroundTintList = if (currentFilter == "link") ColorStateList.valueOf(getColor(R.color.primary_black)) else null

            btnFilterImages.setTextColor(if (currentFilter == "image") Color.WHITE else getColor(R.color.text_muted))
            btnFilterImages.backgroundTintList = if (currentFilter == "image") ColorStateList.valueOf(getColor(R.color.primary_black)) else null

            btnFilterTexts.setTextColor(if (currentFilter == "text") Color.WHITE else getColor(R.color.text_muted))
            btnFilterTexts.backgroundTintList = if (currentFilter == "text") ColorStateList.valueOf(getColor(R.color.primary_black)) else null
        }

        btnFilterAll.setOnClickListener { currentFilter = "all"; updateFilterTabs(); populateBag() }
        btnFilterLinks.setOnClickListener { currentFilter = "link"; updateFilterTabs(); populateBag() }
        btnFilterImages.setOnClickListener { currentFilter = "image"; updateFilterTabs(); populateBag() }
        btnFilterTexts.setOnClickListener { currentFilter = "text"; updateFilterTabs(); populateBag() }

        btnAddCurrent.setOnClickListener {
            addCurrentPageToBag()
            populateBag()
        }

        btnAddCustomImage.setOnClickListener {
            val input = EditText(this).apply { hint = "https://example.com/photo.jpg" }
            AlertDialog.Builder(this)
                .setTitle("이미지 URL 담기")
                .setView(input)
                .setPositiveButton("담기") { _, _ ->
                    val url = input.text.toString().trim()
                    if (url.isNotEmpty()) {
                        saveBagItem(BagItem(System.currentTimeMillis().toString(), "image", "스크랩 이미지", url, getCurrentWebView().url ?: "", System.currentTimeMillis()))
                        populateBag()
                    }
                }
                .setNegativeButton("취소", null)
                .show()
        }

        btnClear.setOnClickListener {
            clearBagItems()
            populateBag()
            Toast.makeText(this, "Bag이 비워졌습니다", Toast.LENGTH_SHORT).show()
        }

        btnClose.setOnClickListener { dialog.dismiss() }

        populateBag()
        dialog.show()
    }

    private fun addCurrentPageToBag() {
        val curTab = getCurrentTab()
        val title = curTab.webView.title ?: "스크랩 페이지"
        val url = curTab.webView.url ?: START_PAGE_URL
        if (url == START_PAGE_URL || url.startsWith("file:///android_asset/")) {
            Toast.makeText(this, "시작 페이지는 My Bag에 담을 수 없습니다", Toast.LENGTH_SHORT).show()
            return
        }
        val item = BagItem(
            id = System.currentTimeMillis().toString(),
            type = "link",
            title = title,
            content = url,
            sourceUrl = url,
            timestamp = System.currentTimeMillis()
        )
        saveBagItem(item)
        Toast.makeText(this, "'$title'이(가) My Bag에 담겼습니다.", Toast.LENGTH_SHORT).show()
    }

    private fun showImageLongClickMenu(imageUrl: String, sourceUrl: String) {
        val options = arrayOf("My Bag에 이 이미지 담기", "이미지 링크 복사", "이미지 다운로드")
        AlertDialog.Builder(this)
            .setTitle("이미지 옵션")
            .setItems(options) { _, which ->
                when (which) {
                    0 -> {
                        val item = BagItem(
                            id = System.currentTimeMillis().toString(),
                            type = "image",
                            title = "웹 스크랩 이미지",
                            content = imageUrl,
                            sourceUrl = sourceUrl,
                            timestamp = System.currentTimeMillis()
                        )
                        saveBagItem(item)
                        Toast.makeText(this, "이미지가 My Bag에 저장되었습니다.", Toast.LENGTH_SHORT).show()
                    }
                    1 -> {
                        val clip = getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager
                        clip?.setPrimaryClip(android.content.ClipData.newPlainText("Image URL", imageUrl))
                        Toast.makeText(this, "이미지 URL이 복사되었습니다", Toast.LENGTH_SHORT).show()
                    }
                    2 -> {
                        startDownloadFile(imageUrl, "", "image/*", 0)
                    }
                }
            }
            .show()
    }

    // 다운로드 관리자 기능
    private fun startDownloadFile(url: String, contentDisposition: String, mimetype: String, contentLength: Long) {
        try {
            val filename = URLUtil.guessFileName(url, contentDisposition, mimetype)
            val request = DownloadManager.Request(Uri.parse(url)).apply {
                setMimeType(mimetype)
                setTitle(filename)
                setDescription("Cream Browser에서 다운로드 중...")
                setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, filename)
            }
            val dm = getSystemService(Context.DOWNLOAD_SERVICE) as? DownloadManager
            dm?.enqueue(request)

            saveDownloadItem(DownloadedFileItem(filename, url, Environment.DIRECTORY_DOWNLOADS + "/" + filename, contentLength, System.currentTimeMillis()))
            Toast.makeText(this, "다운로드를 시작합니다: $filename", Toast.LENGTH_SHORT).show()
        } catch (e: Exception) {
            Toast.makeText(this, "다운로드 요청 실패: ${e.message}", Toast.LENGTH_SHORT).show()
        }
    }

    private fun showDownloadsDialog() {
        val dialog = createConfiguredBottomSheetDialog()
        val view = layoutInflater.inflate(R.layout.dialog_downloads, null)
        dialog.setContentView(view)
        applyTouchAnimationToAll(view)

        val tvCount = view.findViewById<TextView>(R.id.tvDownloadCount)
        val layoutList = view.findViewById<LinearLayout>(R.id.layoutDownloadsList)
        val btnClear = view.findViewById<Button>(R.id.btnClearDownloads)
        val btnOpenSystem = view.findViewById<Button>(R.id.btnOpenSystemDownloads)
        val btnClose = view.findViewById<ImageView>(R.id.btnCloseDownloads)

        fun populate() {
            layoutList.removeAllViews()
            val downloads = getSavedDownloads()
            tvCount.text = downloads.size.toString()

            if (downloads.isEmpty()) {
                val emptyTv = TextView(this).apply {
                    text = "다운로드된 파일이 없습니다."
                    textSize = 12f
                    setTextColor(getColor(R.color.text_muted))
                    setPadding(10, 24, 10, 24)
                }
                layoutList.addView(emptyTv)
                return
            }

            val dateFormat = SimpleDateFormat("MM.dd HH:mm", Locale.KOREA)
            for (d in downloads) {
                val itemView = layoutInflater.inflate(R.layout.item_tab_card, layoutList, false)
                val tvTitle = itemView.findViewById<TextView>(R.id.tvTabTitle)
                val tvUrl = itemView.findViewById<TextView>(R.id.tvTabUrl)
                val ivIcon = itemView.findViewById<ImageView>(R.id.ivTabFavicon)
                val btnDel = itemView.findViewById<ImageView>(R.id.btnTabClose)
                itemView.findViewById<ImageView>(R.id.btnTabGroupAction).visibility = View.GONE

                ivIcon.setImageResource(R.drawable.ic_download)
                tvTitle.text = d.filename
                tvUrl.text = "${dateFormat.format(Date(d.timestamp))} · ${d.path}"

                itemView.setOnClickListener {
                    try {
                        startActivity(Intent(DownloadManager.ACTION_VIEW_DOWNLOADS))
                    } catch (e: Exception) {
                        Toast.makeText(this, "파일을 열 수 없습니다", Toast.LENGTH_SHORT).show()
                    }
                }

                btnDel.setOnClickListener {
                    deleteDownloadItem(d.filename)
                    populate()
                }

                layoutList.addView(itemView)
            }
        }

        btnClear.setOnClickListener {
            clearDownloads()
            populate()
            Toast.makeText(this, "다운로드 목록이 삭제되었습니다", Toast.LENGTH_SHORT).show()
        }

        btnOpenSystem.setOnClickListener {
            try {
                startActivity(Intent(DownloadManager.ACTION_VIEW_DOWNLOADS))
            } catch (e: Exception) {
                Toast.makeText(this, "다운로드 폴더를 열 수 없습니다", Toast.LENGTH_SHORT).show()
            }
        }

        btnClose.setOnClickListener { dialog.dismiss() }

        populate()
        dialog.show()
    }

    // 클린 리더 모드
    private fun showReaderModeDialog() {
        val currentWv = getCurrentWebView()
        val extractScript = """
            (function() {
                var title = (document.querySelector('h1') ? document.querySelector('h1').innerText : '') || document.title || '';
                var paragraphs = Array.from(document.querySelectorAll('article p, main p, .article-body p, .content p, p'))
                    .map(function(p) { return p.innerText.trim(); })
                    .filter(function(t) { return t.length > 20; });
                return JSON.stringify({
                    title: title,
                    content: paragraphs.join('\n\n')
                });
            })();
        """.trimIndent()

        currentWv.evaluateJavascript(extractScript) { resultJson ->
            try {
                val cleanJson = if (resultJson.isNullOrBlank()) "{}" else {
                    try {
                        val tok = org.json.JSONTokener(resultJson).nextValue()
                        tok.toString()
                    } catch (e: Exception) { resultJson ?: "{}" }
                }
                val obj = JSONObject(cleanJson)
                val title = obj.optString("title", currentWv.title ?: "문서")
                val content = obj.optString("content", "본문 내용을 추출할 수 없습니다.")

                val dialog = createConfiguredBottomSheetDialog()
                val view = layoutInflater.inflate(R.layout.dialog_reader_mode, null)
                dialog.setContentView(view)
                applyTouchAnimationToAll(view)

                view.findViewById<TextView>(R.id.tvReaderTitle).text = title
                view.findViewById<TextView>(R.id.tvReaderSource).text = "출처: ${currentWv.url ?: ""}"
                val tvContent = view.findViewById<TextView>(R.id.tvReaderContent)
                tvContent.text = content

                val btnReaderTranslate = view.findViewById<Button>(R.id.btnReaderTranslate)
                var isReaderTranslated = false
                val origTitle = title
                val origContent = content
                var cachedTranslatedTitle: String? = null
                var cachedTranslatedContent: String? = null

                btnReaderTranslate?.setOnClickListener {
                    if (isReaderTranslated) {
                        view.findViewById<TextView>(R.id.tvReaderTitle).text = origTitle
                        tvContent.text = origContent
                        btnReaderTranslate.text = "한국어 번역"
                        isReaderTranslated = false
                        Toast.makeText(this@MainActivity, "원문으로 복원되었습니다", Toast.LENGTH_SHORT).show()
                    } else {
                        if (cachedTranslatedTitle != null && cachedTranslatedContent != null) {
                            view.findViewById<TextView>(R.id.tvReaderTitle).text = cachedTranslatedTitle
                            tvContent.text = cachedTranslatedContent
                            btnReaderTranslate.text = "원문 보기"
                            isReaderTranslated = true
                            Toast.makeText(this@MainActivity, "한국어로 번역되었습니다", Toast.LENGTH_SHORT).show()
                        } else {
                            btnReaderTranslate.text = "번역 중..."
                            btnReaderTranslate.isEnabled = false
                            Thread {
                                val trTitle = translateTextWithDictChromeEx(origTitle) ?: origTitle
                                val trContent = translateLongTextWithDictChromeEx(origContent) ?: origContent
                                runOnUiThread {
                                    if (!isFinishing && !isDestroyed) {
                                        cachedTranslatedTitle = trTitle
                                        cachedTranslatedContent = trContent
                                        view.findViewById<TextView>(R.id.tvReaderTitle).text = trTitle
                                        tvContent.text = trContent
                                        btnReaderTranslate.text = "원문 보기"
                                        btnReaderTranslate.isEnabled = true
                                        isReaderTranslated = true
                                        Toast.makeText(this@MainActivity, "한국어로 번역되었습니다", Toast.LENGTH_SHORT).show()
                                    }
                                }
                            }.start()
                        }
                    }
                }

                view.findViewById<Button>(R.id.btnReaderCopy).setOnClickListener {
                    val clip = getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager
                    clip?.setPrimaryClip(android.content.ClipData.newPlainText("Reader Content", "$title\n\n$content"))
                    Toast.makeText(this, "클린 리더 본문이 복사되었습니다", Toast.LENGTH_SHORT).show()
                }

                view.findViewById<ImageView>(R.id.btnCloseReaderMode).setOnClickListener {
                    dialog.dismiss()
                }

                dialog.show()
            } catch (e: Exception) {
                Toast.makeText(this, "리더 모드 로딩 중 오류가 발생했습니다", Toast.LENGTH_SHORT).show()
            }
        }
    }

    private fun createConfiguredBottomSheetDialog(): BottomSheetDialog {
        val dialog = BottomSheetDialog(this)
        dialog.setOnShowListener {
            val bottomSheet = dialog.findViewById<FrameLayout>(com.google.android.material.R.id.design_bottom_sheet)
            if (bottomSheet != null) {
                val behavior = BottomSheetBehavior.from(bottomSheet)
                behavior.state = BottomSheetBehavior.STATE_EXPANDED
                behavior.skipCollapsed = true
                behavior.isHideable = true
                applyTabletDialogWidth(bottomSheet)
            }
        }
        return dialog
    }

    // 태블릿 넓은 화면에서 다이얼로그를 480dp 폭으로 가운데 정렬해 읽기 좋게 유지한다
    private fun applyTabletDialogWidth(bottomSheet: View) {
        if (!isTabletLayout()) return
        val screenWidthDp = resources.configuration.screenWidthDp
        val targetWidth = dpToPx(minOf(480, screenWidthDp - 32))
        val lp = bottomSheet.layoutParams
        if (lp is FrameLayout.LayoutParams) {
            lp.width = targetWidth
            lp.gravity = android.view.Gravity.BOTTOM or android.view.Gravity.CENTER_HORIZONTAL
            bottomSheet.layoutParams = lp
        } else if (lp is android.view.ViewGroup.MarginLayoutParams) {
            lp.width = targetWidth
            bottomSheet.layoutParams = lp
        }
    }

    // ===== 웹페이지 번역: 고속 배치 번역 및 상단 닫기 가능한 프로그레스바 =====
    private var translationJobToken = 0

    private fun isTranslatableUrl(url: String?): Boolean {
        if (url.isNullOrBlank()) return false
        if (url == START_PAGE_URL || url == START_PAGE_SECURITY_URL) return false
        if (url.startsWith("file://") || url.startsWith("about:") || url.startsWith("data:") ||
            url.startsWith("javascript:") || url.startsWith("blob:") || url.startsWith("chrome:")
        ) return false
        return url.startsWith("http://") || url.startsWith("https://")
    }

    private fun togglePageTranslation() {
        if (getCurrentTab().isTranslated) restoreOriginalPage() else translateCurrentPage()
    }

    private fun translateCurrentPage() {
        val curTab = getCurrentTab()
        val wv = curTab.webView
        val curUrl = wv.url ?: ""
        if (!isTranslatableUrl(curUrl)) {
            Toast.makeText(this, "번역할 수 없는 페이지입니다", Toast.LENGTH_SHORT).show()
            return
        }
        if (curTab.isTranslated) {
            restoreOriginalPage()
            return
        }

        translationJobToken++
        val token = translationJobToken

        layoutTranslateProgress.visibility = View.VISIBLE
        pbTranslateSpinner.visibility = View.VISIBLE
        val targetLang = getTranslateLang()
        val targetLabel = translateLangLabel()
        tvTranslateStatus.text = "페이지 " + targetLabel + "로 번역 준비 중..."
        tvTranslateChipText.text = "번역 중"

        wv.evaluateJavascript(buildTranslateExtractScript(targetLang)) { raw ->
            if (token != translationJobToken) return@evaluateJavascript
            val texts = parseStringArray(decodeJavascriptString(raw))
            if (texts.isEmpty()) {
                layoutTranslateProgress.visibility = View.GONE
                tvTranslateChipText.text = "번역"
                Toast.makeText(this@MainActivity, "번역할 외국어 텍스트가 없습니다", Toast.LENGTH_SHORT).show()
                return@evaluateJavascript
            }

            tvTranslateStatus.text = "페이지 " + targetLabel + "로 번역 중 (0 / ${texts.size})..."
            Thread {
                runHighSpeedBatchTranslation(wv, token, texts, targetLang, targetLabel)
            }.start()
        }
    }

    // ---------- 외국어 사이트 자동 번역 ----------
    private fun maybeAutoTranslate(view: WebView?, url: String?) {
        if (!isAutoTranslateEnabled()) return
        if (view == null || url == null) return
        if (!isTranslatableUrl(url)) return
        if (url.contains("youtube.com")) return
        val tab = findTabByWebView(view) ?: return
        if (tab.isSecurity || tab.isTranslated) return
        if (tab.autoTranslatedUrl == url) return
        if (view != getCurrentWebView()) return
        tab.autoTranslatedUrl = url
        val detectScript = """
            (function(){
              try {
                var l = (document.documentElement.getAttribute('lang') || '').toLowerCase();
                var b = document.body ? document.body.innerText : '';
                b = b.replace(/\s+/g, ' ').slice(0, 800);
                return JSON.stringify({lang: l, text: b});
              } catch (e) { return JSON.stringify({lang: '', text: ''}); }
            })();
        """.trimIndent()
        view.evaluateJavascript(detectScript) { raw ->
            try {
                val obj = JSONObject(decodeJavascriptString(raw))
                val lang = obj.optString("lang", "")
                val sample = obj.optString("text", "")
                if (shouldAutoTranslate(lang, sample) && !getCurrentTab().isTranslated) {
                    translateCurrentPage()
                }
            } catch (e: Exception) {}
        }
    }

    private fun shouldAutoTranslate(lang: String, sample: String): Boolean {
        val target = getTranslateLang()
        val targetBase = target.substringBefore('-').lowercase(Locale.ROOT)
        if (sample.trim().length < 40) return false
        if (lang.length >= 2) {
            val detected = lang.substring(0, 2).lowercase(Locale.ROOT)
            return detected != targetBase
        }
        val total = sample.length.toFloat()
        if (total <= 0f) return false
        fun ratio(pattern: String): Float =
            Regex(pattern).findAll(sample).count().toFloat() / total
        val hangul = ratio("[\uAC00-\uD7AF]")
        val kana = ratio("[\u3040-\u30FF]")
        val cjk = ratio("[\u4E00-\u9FFF]")
        val latin = ratio("[A-Za-z]")
        return when (targetBase) {
            "ko" -> hangul < 0.05f && (latin > 0.20f || cjk > 0.20f || kana > 0.10f)
            "ja" -> hangul < 0.02f && kana < 0.03f && (latin > 0.20f || cjk > 0.10f)
            "zh" -> hangul < 0.02f && cjk < 0.05f && (latin > 0.20f || kana > 0.10f)
            else -> hangul > 0.10f || kana > 0.10f || cjk > 0.20f
        }
    }

    private fun runHighSpeedBatchTranslation(wv: WebView, token: Int, texts: List<String>, targetLang: String, targetLabel: String) {
        val total = texts.size
        val batchSize = 30
        var processed = 0
        var applied = 0
        for (start in 0 until total step batchSize) {
            if (token != translationJobToken) return
            val end = minOf(start + batchSize, total)
            val chunkTexts = texts.subList(start, end)
            val chunkTr = translateBatchWithDictChromeEx(chunkTexts, targetLang)
            if (token != translationJobToken) return

            processed = end
            val batchMap = JSONObject()
            for (i in chunkTr.indices) {
                if (start + i >= total) break
                val trText = chunkTr[i]
                if (trText.isNotBlank()) {
                    batchMap.put((start + i).toString(), trText)
                    applied++
                }
            }
            val payload = if (batchMap.length() > 0) sanitizeForJavascript(batchMap.toString()) else ""
            val progress = processed
            runOnUiThread {
                if (!isFinishing && !isDestroyed && token == translationJobToken) {
                    if (payload.isNotBlank()) {
                        wv.evaluateJavascript(
                            "if (window.__creamApplyBatch) window.__creamApplyBatch(" + payload + ");",
                            null
                        )
                    }
                    tvTranslateStatus.text = "페이지 " + targetLabel + "로 번역 중 (" + progress + " / " + total + ")"
                }
            }
        }

        val appliedTotal = applied
        runOnUiThread {
            if (!isFinishing && !isDestroyed && token == translationJobToken) {
                val tab = getCurrentTab()
                if (tab.webView === wv) {
                    tab.isTranslated = true
                    tvTranslateChipText.text = "원문"
                }
                pbTranslateSpinner.visibility = View.GONE
                tvTranslateStatus.text = "번역 완료 (" + appliedTotal + " / " + total + ")"
                Toast.makeText(this@MainActivity, "페이지를 " + targetLabel + "로 번역했습니다 (" + appliedTotal + "개 문단)", Toast.LENGTH_SHORT).show()
                layoutTranslateProgress.postDelayed({
                    if (token == translationJobToken) {
                        layoutTranslateProgress.visibility = View.GONE
                    }
                }, 1500L)
            }
        }
    }

    private fun restoreOriginalPage() {
        val curTab = getCurrentTab()
        val wv = curTab.webView
        translationJobToken++
        curTab.isTranslated = false
        tvTranslateChipText.text = "번역"
        layoutTranslateProgress.visibility = View.GONE
        wv.evaluateJavascript(
            "if (window.__creamRestoreOriginal) window.__creamRestoreOriginal();",
            null
        )
        Toast.makeText(this, "원문으로 복원되었습니다", Toast.LENGTH_SHORT).show()
    }

    private fun buildTranslateExtractScript(targetLang: String): String {
        val targetPat = when (targetLang) {
            "ko" -> "[\\uAC00-\\uD7AF]"
            "ja" -> "[\\u3040-\\u30FF]"
            "zh-CN" -> "[\\u4E00-\\u9FFF]"
            else -> "(?!)  "
        }
        val hasTargetScript = targetLang == "ko" || targetLang == "ja" || targetLang == "zh-CN"
        val otherPat = when (targetLang) {
            "ko" -> "[A-Za-z\\u00C0-\\u024F\\u0370-\\u03FF\\u3040-\\u30FF\\u4E00-\\u9FFF]"
            "ja" -> "[A-Za-z\\u00C0-\\u024F\\uAC00-\\uD7AF]"
            "zh-CN" -> "[A-Za-z\\u00C0-\\u024F\\uAC00-\\uD7AF\\u3040-\\u30FF]"
            else -> "[A-Za-z\\u00C0-\\u024F\\uAC00-\\uD7AF\\u3040-\\u30FF\\u4E00-\\u9FFF\\u0370-\\u03FF]"
        }
        val hasTargetScriptValue = hasTargetScript
        return """
(function () {
  try {
    window.__creamApplyBatch = function (map) {
      var nodes = window.__creamTextNodes || [];
      for (var k in map) {
        var idx = parseInt(k, 10);
        var n = nodes[idx];
        if (!n || !n.parentNode) continue;
        var tr = map[k];
        if (!tr) continue;
        if (n.__creamOrig === undefined) {
          n.__creamOrig = n.nodeValue;
        }
        var orig = n.__creamOrig || '';
        var lead = orig.match(/^\s*/)[0];
        var trail = orig.match(/\s*$/)[0];
        n.nodeValue = lead + tr + trail;
      }
    };
    window.__creamRestoreOriginal = function () {
      var nodes = window.__creamTextNodes || [];
      for (var i = 0; i < nodes.length; i++) {
        var n = nodes[i];
        if (n && n.__creamOrig !== undefined) {
          n.nodeValue = n.__creamOrig;
        }
      }
    };
    if (!document.body) return '[]';
    var skipTags = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEXTAREA: 1, INPUT: 1, SELECT: 1, OPTION: 1, CODE: 1, PRE: 1, KBD: 1, SAMP: 1, SVG: 1, AUDIO: 1, VIDEO: 1 };
    var skipSelector = '#cream_translate_host, .skiptranslate, [contenteditable="true"], [translate="no"], .notranslate';
    var targetPattern = /${targetPat}/;
    var otherPattern = /${otherPat}/;
    var hasTargetScript = $hasTargetScriptValue;
    var nodes = [];
    var nodeLimit = 2000;

    // 이전 번역에서 표시해 둔 수집 마커를 초기화한다
    if (window.__creamTextNodes) {
      for (var ci = 0; ci < window.__creamTextNodes.length; ci++) {
        var oldNode = window.__creamTextNodes[ci];
        if (oldNode) oldNode.__creamPicked = false;
      }
    }

    function acceptable(n) {
      var t = n.nodeValue;
      if (!t) return false;
      var trimmed = t.trim();
      if (trimmed.length < 2 || trimmed.length > 1000) return false;
      if (hasTargetScript && targetPattern.test(trimmed) && !otherPattern.test(trimmed)) return false;
      if (!otherPattern.test(trimmed)) return false;
      var p = n.parentNode;
      if (!p || !p.nodeName) return false;
      if (skipTags[p.nodeName.toUpperCase()]) return false;
      if (p.closest && p.closest(skipSelector)) return false;
      if (n.__creamPicked) return false;
      return true;
    }

    function collectWithin(root) {
      if (!root || nodes.length >= nodeLimit) return;
      var walker;
      try {
        walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null, false);
      } catch (e) {
        return;
      }
      var node;
      while ((node = walker.nextNode())) {
        if (nodes.length >= nodeLimit) break;
        if (!acceptable(node)) continue;
        node.__creamPicked = true;
        nodes.push(node);
      }
    }

    var primarySelectors = ['main', 'article', '[role="main"]', '.article-body', '.article-content', '.post-content', '.entry-content', '#content', '.content'];
    var primaryRoots = [];
    for (var si = 0; si < primarySelectors.length; si++) {
      var found;
      try {
        found = document.querySelectorAll(primarySelectors[si]);
      } catch (e) {
        found = [];
      }
      for (var fi = 0; fi < found.length; fi++) {
        var el = found[fi];
        var isNested = false;
        for (var ri = 0; ri < primaryRoots.length; ri++) {
          if (primaryRoots[ri] === el || (primaryRoots[ri].contains && primaryRoots[ri].contains(el))) {
            isNested = true;
            break;
          }
        }
        if (!isNested) primaryRoots.push(el);
      }
    }

    // 1순위: 기사 본문과 제목 영역의 텍스트를 먼저 수집한다
    for (var pi = 0; pi < primaryRoots.length; pi++) {
      if (nodes.length >= nodeLimit) break;
      collectWithin(primaryRoots[pi]);
    }
    // 2순위: 남은 문서 전체 텍스트를 이어서 수집한다
    collectWithin(document.body);

    if (nodes.length === 0) return '[]';
    window.__creamTextNodes = nodes;
    var items = [];
    for (var i = 0; i < nodes.length; i++) items.push(nodes[i].nodeValue);
    return JSON.stringify(items);
  } catch (e) {
    return '[]';
  }
})();
""".trimIndent()
    }

    private fun decodeJavascriptString(raw: String?): String {
        if (raw.isNullOrBlank() || raw == "null") return ""
        return try {
            org.json.JSONTokener(raw).nextValue().toString()
        } catch (e: Exception) {
            raw
        }
    }

    private fun parseStringArray(jsonText: String): List<String> {
        val out = mutableListOf<String>()
        if (jsonText.isBlank()) return out
        try {
            val arr = JSONArray(jsonText)
            for (i in 0 until arr.length()) {
                out.add(arr.optString(i, ""))
            }
        } catch (e: Exception) {
            out.clear()
        }
        return out
    }

    private fun sanitizeForJavascript(json: String): String {
        return json.replace("\u2028", " ").replace("\u2029", " ")
    }

    private fun translateBatchWithDictChromeEx(texts: List<String>, targetLang: String = "ko"): List<String> {
        if (texts.isEmpty()) return emptyList()
        var conn: HttpURLConnection? = null
        return try {
            val pairs = mutableListOf<String>()
            for (t in texts) {
                val trimmed = t.trim()
                val valToEncode = if (trimmed.isNotBlank()) trimmed else " "
                pairs.add("q=" + URLEncoder.encode(valToEncode, "UTF-8"))
            }
            val postData = pairs.joinToString("&").toByteArray(Charsets.UTF_8)
            val url = URL("https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=auto&tl=" + URLEncoder.encode(targetLang, "UTF-8"))
            conn = url.openConnection() as HttpURLConnection
            conn.connectTimeout = 6000
            conn.readTimeout = 9000
            conn.requestMethod = "POST"
            conn.doOutput = true
            conn.setRequestProperty("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64)")
            conn.setRequestProperty("Content-Type", "application/x-www-form-urlencoded;charset=utf-8")
            conn.setRequestProperty("Content-Length", postData.size.toString())
            conn.outputStream.use { it.write(postData) }

            if (conn.responseCode == 200) {
                val responseText = conn.inputStream.bufferedReader(Charsets.UTF_8).use { it.readText() }
                val arr = JSONArray(responseText)
                val result = mutableListOf<String>()
                for (i in 0 until arr.length()) {
                    val item = arr.optJSONArray(i)
                    val tr = item?.optString(0, "") ?: ""
                    result.add(tr)
                }
                result
            } else {
                emptyList()
            }
        } catch (e: Exception) {
            emptyList()
        } finally {
            try {
                conn?.disconnect()
            } catch (e: Exception) {}
        }
    }

    private fun translateTextWithDictChromeEx(text: String): String? {
        val list = translateBatchWithDictChromeEx(listOf(text))
        return list.firstOrNull()
    }

    private fun translateLongTextWithDictChromeEx(content: String): String? {
        val paragraphs = content.split("\n\n").map { it.trim() }.filter { it.isNotBlank() }
        if (paragraphs.isEmpty()) return translateTextWithDictChromeEx(content)
        val translated = mutableListOf<String>()
        val batchSize = 15
        for (i in 0 until paragraphs.size step batchSize) {
            val chunk = paragraphs.subList(i, minOf(i + batchSize, paragraphs.size))
            val chunkTr = translateBatchWithDictChromeEx(chunk)
            if (chunkTr.size == chunk.size) {
                translated.addAll(chunkTr)
            } else {
                translated.addAll(chunk)
            }
        }
        return translated.joinToString("\n\n")
    }

    // 메뉴 바텀시트
    private fun showMenuDialog() {
        if (resources.configuration.screenWidthDp >= 600) {
            toggleSidebar("menu")
            return
        }
        val dialog = createConfiguredBottomSheetDialog()
        val view = layoutInflater.inflate(R.layout.dialog_menu_bottom_sheet, null)
        dialog.setContentView(view)
        applyTouchAnimationToAll(view)

        val menuQuickNewTab = view.findViewById<LinearLayout>(R.id.menuQuickNewTab)
        val menuQuickSecurityTab = view.findViewById<LinearLayout>(R.id.menuQuickSecurityTab)
        val menuQuickReload = view.findViewById<LinearLayout>(R.id.menuQuickReload)
        val menuQuickShare = view.findViewById<LinearLayout>(R.id.menuQuickShare)

        val menuItemBag = view.findViewById<LinearLayout>(R.id.menuItemBag)
        val menuItemAddToBag = view.findViewById<LinearLayout>(R.id.menuItemAddToBag)
        val menuItemBookmarksList = view.findViewById<LinearLayout>(R.id.menuItemBookmarksList)
        val menuItemDownloads = view.findViewById<LinearLayout>(R.id.menuItemDownloads)
        val menuItemReaderMode = view.findViewById<LinearLayout>(R.id.menuItemReaderMode)
        val menuItemTranslate = view.findViewById<LinearLayout>(R.id.menuItemTranslate)
        val menuItemDesktop = view.findViewById<LinearLayout>(R.id.menuItemDesktop)
        val tvDesktopModeStatus = view.findViewById<TextView>(R.id.tvDesktopModeStatus)
        val menuItemMacro = view.findViewById<LinearLayout>(R.id.menuItemMacro)
        val menuItemCapture = view.findViewById<LinearLayout>(R.id.menuItemCapture)
        val menuItemFindInPage = view.findViewById<LinearLayout>(R.id.menuItemFindInPage)
        val menuItemPrint = view.findViewById<LinearLayout>(R.id.menuItemPrint)
        val menuItemSavePdf = view.findViewById<LinearLayout>(R.id.menuItemSavePdf)
        val menuItemQrCode = view.findViewById<LinearLayout>(R.id.menuItemQrCode)
        val menuItemHistory = view.findViewById<LinearLayout>(R.id.menuItemHistory)
        val menuItemSettings = view.findViewById<LinearLayout>(R.id.menuItemSettings)

        val desktopPreferred = isDesktopSitePreferred(getCurrentWebView().url)
        tvDesktopModeStatus.text = if (desktopPreferred) "PC 웹 고정" else "모바일 웹"

        menuQuickNewTab.setOnClickListener {
            dialog.dismiss()
            addNewTab(START_PAGE_URL, makeActive = true, isSecurity = false)
        }

        menuQuickSecurityTab.setOnClickListener {
            dialog.dismiss()
            addNewTab(START_PAGE_URL, makeActive = true, isSecurity = true)
        }

        menuQuickReload.setOnClickListener {
            dialog.dismiss()
            getCurrentWebView().reload()
        }

        menuQuickShare.setOnClickListener {
            dialog.dismiss()
            shareCurrentPage()
        }

        menuItemBag.setOnClickListener {
            dialog.dismiss()
            showBagDialog()
        }

        menuItemAddToBag.setOnClickListener {
            dialog.dismiss()
            addCurrentPageToBag()
        }

        menuItemBookmarksList.setOnClickListener {
            dialog.dismiss()
            showBookmarksDialog()
        }

        menuItemDownloads.setOnClickListener {
            dialog.dismiss()
            showDownloadsDialog()
        }

        menuItemReaderMode.setOnClickListener {
            dialog.dismiss()
            showReaderModeDialog()
        }

        menuItemTranslate.setOnClickListener {
            dialog.dismiss()
            togglePageTranslation()
        }

        menuItemDesktop.setOnClickListener {
            dialog.dismiss()
            toggleDesktopMode()
        }

        menuItemMacro?.setOnClickListener {
            dialog.dismiss()
            showMacroDialog()
        }

        menuItemCapture?.setOnClickListener {
            dialog.dismiss()
            captureFullPageScreenshot()
        }

        menuItemFindInPage.setOnClickListener {
            dialog.dismiss()
            showFindInPageDialog()
        }

        menuItemPrint.setOnClickListener {
            dialog.dismiss()
            printCurrentPage()
        }

        menuItemSavePdf?.setOnClickListener {
            dialog.dismiss()
            saveWebPageAsPdf()
        }

        menuItemQrCode?.setOnClickListener {
            dialog.dismiss()
            showQrCodeDialog()
        }

        menuItemHistory.setOnClickListener {
            dialog.dismiss()
            showHistoryDialog()
        }

        menuItemSettings.setOnClickListener {
            dialog.dismiss()
            showSettingsDialog()
        }

        dialog.show()
    }

    private fun shareCurrentPage() {
        val currentTab = getCurrentTab()
        val currentUrl = currentTab.webView.url ?: START_PAGE_URL
        val currentTitle = currentTab.webView.title ?: "Cream Browser"
        val shareIntent = Intent(Intent.ACTION_SEND).apply {
            type = "text/plain"
            putExtra(Intent.EXTRA_SUBJECT, currentTitle)
            putExtra(Intent.EXTRA_TEXT, currentUrl)
        }
        startActivity(Intent.createChooser(shareIntent, "페이지 공유"))
    }

    private fun toggleDesktopMode() {
        val view = getCurrentWebView()
        val url = view.url ?: ""
        val domain = normalizeSiteDomain(url)
        if (domain.isBlank()) {
            Toast.makeText(this, "사이트 주소가 없어 모드를 기억할 수 없습니다", Toast.LENGTH_SHORT).show()
            return
        }
        val enableDesktop = !isDesktopSitePreferred(url)
        setDesktopPreferenceForUrl(url, enableDesktop)
        isDesktopMode = enableDesktop
        view.settings.userAgentString = if (enableDesktop) DESKTOP_USER_AGENT else MOBILE_USER_AGENT
        val message = if (enableDesktop) {
            "$domain 사이트를 데스크탑 PC 버전으로 기억했습니다"
        } else {
            "$domain 사이트를 모바일 버전으로 기억했습니다"
        }
        Toast.makeText(this, message, Toast.LENGTH_SHORT).show()
        updateDesktopMenuLabels()
        view.reload()
    }

    // ---------- 사이트별 PC / 모바일 버전 기억 ----------
    private fun normalizeSiteDomain(url: String?): String {
        if (url.isNullOrBlank()) return ""
        return try {
            var host = Uri.parse(url).host ?: return ""
            host = host.lowercase(Locale.ROOT)
            if (host.startsWith("www.")) host = host.substring(4)
            host
        } catch (e: Exception) {
            ""
        }
    }

    private fun getDesktopDomains(): MutableSet<String> {
        val stored = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .getStringSet("desktop_mode_domains", emptySet<String>()) ?: emptySet<String>()
        return mutableSetOf<String>().apply { addAll(stored) }
    }

    private fun isDesktopSitePreferred(url: String?): Boolean {
        val domain = normalizeSiteDomain(url)
        if (domain.isBlank()) return false
        return getDesktopDomains().contains(domain)
    }

    private fun setDesktopPreferenceForUrl(url: String?, preferred: Boolean) {
        val domain = normalizeSiteDomain(url)
        if (domain.isBlank()) return
        val domains = getDesktopDomains()
        if (preferred) domains.add(domain) else domains.remove(domain)
        getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putStringSet("desktop_mode_domains", domains)
            .apply()
    }

    private fun updateDesktopMenuLabels() {
        if (tabs.isEmpty()) return
        val url = getCurrentWebView().url ?: ""
        val preferred = isDesktopSitePreferred(url)
        findViewById<TextView>(R.id.btnSidebarMenuDesktop)?.text = if (preferred) {
            "데스크탑 PC 모드 해제 (이 사이트 고정됨)"
        } else {
            "데스크탑 PC 모드로 보기 (사이트별 기억)"
        }
    }

    // ---------- 웹 스마트 다크모드 ----------
    private fun isWebDarkModeEnabled(): Boolean {
        return getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .getBoolean("web_smart_dark_enabled", true)
    }

    private fun setWebDarkModeEnabled(enabled: Boolean) {
        getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putBoolean("web_smart_dark_enabled", enabled)
            .apply()
    }

    private fun isDarkThemeActive(): Boolean {
        return getAppThemeMode().endsWith("-dark")
    }

    private fun applyWebDarkModeTo(wv: WebView) {
        val enable = isWebDarkModeEnabled() && isDarkThemeActive()
        try {
            val settings = wv.settings
            if (WebViewFeature.isFeatureSupported(WebViewFeature.ALGORITHMIC_DARKENING)) {
                WebSettingsCompat.setAlgorithmicDarkeningAllowed(settings, enable)
            } else if (WebViewFeature.isFeatureSupported(WebViewFeature.FORCE_DARK)) {
                val mode = if (enable) WebSettingsCompat.FORCE_DARK_ON else WebSettingsCompat.FORCE_DARK_OFF
                WebSettingsCompat.setForceDark(settings, mode)
            }
        } catch (e: Exception) {
        }
    }

    private fun applyWebDarkModeToAllTabs() {
        for (tab in tabs) {
            applyWebDarkModeTo(tab.webView)
        }
    }

    // ---------- 광고 및 트래커 필터 ----------
    private fun shouldBlockRequest(request: WebResourceRequest?): Boolean {
        if (request == null) return false
        if (request.isForMainFrame) return false
        val uri = request.url
        val host = uri.host?.lowercase(Locale.ROOT) ?: return false
        if (host.isBlank()) return false
        val path = uri.path ?: ""
        // 다음/네이버 광고 지면은 호스트가 CDN과 같아 경로까지 확인한다
        if (host.endsWith("daumcdn.net") && path.contains("/adfit")) return true
        for (ad in adDomains) {
            if (host.contains(ad)) return true
        }
        // 데이터 절약 모드: 이미지 자동 로딩을 끄고 무거운 미디어·폰트를 건너뛴다
        if (isDataSaverEnabled()) {
            val lower = path.lowercase(Locale.ROOT)
            val heavy = listOf(".mp4", ".webm", ".m3u8", ".woff2", ".woff", ".ttf", ".otf")
            if (heavy.any { lower.endsWith(it) }) return true
        }
        return false
    }

    // ---------- 백그라운드 미디어 재생 ----------
    private fun isBackgroundAudioEnabled(): Boolean {
        return getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .getBoolean("background_audio_enabled", true)
    }

    // ---------- 태블릿 크롬형 상단 탭 스트립 ----------
    private fun dpToPx(dp: Int): Int {
        return (dp * resources.displayMetrics.density).roundToInt()
    }

    // ---------- 글래스모피즘(프로스티드 글래스) 색상 유틸 ----------
    private fun glass(color: Int, alpha: Int = 236): Int {
        return Color.argb(alpha, Color.red(color), Color.green(color), Color.blue(color))
    }

    private fun glassTint(color: Int, alpha: Int = 236): ColorStateList {
        return ColorStateList.valueOf(glass(color, alpha))
    }

    private fun omniboxTint(color: Int): Int {
        return if (Color.luminance(color) < 0.35f) mixColor(color, Color.WHITE, 0.08f)
        else mixColor(color, Color.BLACK, 0.02f)
    }

    private data class TabStripColors(
        val stripBg: String,
        val activeBg: String,
        val inactiveBg: String,
        val activeText: String,
        val inactiveText: String
    )

    private fun hexColor(color: Int): String = String.format("#%06X", 0xFFFFFF and color)

    private fun tabStripColors(theme: String): TabStripColors {
        if (theme.startsWith("theme-custom")) {
            val accent = getCustomAccentColor()
            val dark = theme.endsWith("-dark")
            return if (dark) TabStripColors(
                hexColor(mixColor(accent, Color.BLACK, 0.96f)),
                hexColor(mixColor(accent, Color.BLACK, 0.80f)),
                hexColor(mixColor(accent, Color.BLACK, 0.90f)),
                "#FFFFFF",
                hexColor(mixColor(accent, Color.WHITE, 0.55f))
            ) else TabStripColors(
                hexColor(mixColor(accent, Color.WHITE, 0.72f)),
                hexColor(mixColor(accent, Color.WHITE, 0.86f)),
                hexColor(mixColor(accent, Color.WHITE, 0.94f)),
                "#111111",
                "#52525B"
            )
        }
        return when (theme) {
            "theme-default-light" -> TabStripColors("#DCDFE4", "#E5E7EB", "#F2F3F5", "#111111", "#52525B")
            "theme-pink-dark" -> TabStripColors("#1B0D10", "#261316", "#301A1F", "#FFFFFF", "#D9A5AF")
            "theme-pink-light" -> TabStripColors("#F0BFC8", "#FAD2D9", "#FFF0F3", "#6E343D", "#8E4C56")
            else -> TabStripColors("#0B0C0E", "#000000", "#15181C", "#FFFFFF", "#A1A1AA")
        }
    }

    private fun renderTabletTabStrip() {
        if (!::layoutTabletTabStrip.isInitialized) return
        if (!isTabletLayout()) {
            layoutTabletTabStrip.visibility = View.GONE
            return
        }
        layoutTabletTabStrip.visibility = View.VISIBLE
        if (tabs.isEmpty()) {
            layoutTabletTabsContainer.removeAllViews()
            return
        }

        val savedScroll = layoutTabletTabStrip.scrollX
        val isSecurityView = getCurrentTab().isSecurity
        val theme = if (isSecurityView) "theme-default-dark" else getAppThemeMode()
        val colors = tabStripColors(theme)
        val activeBg = Color.parseColor(colors.activeBg)
        val inactiveBg = Color.parseColor(colors.inactiveBg)
        val activeText = Color.parseColor(colors.activeText)
        val inactiveText = Color.parseColor(colors.inactiveText)

        layoutTabletTabStrip.setBackgroundColor(Color.parseColor(colors.stripBg))
        layoutTabletTabsContainer.removeAllViews()

        // [+ 그룹] 버튼은 탭들의 가장 앞(왼쪽)에 배치합니다
        val groupItem = layoutInflater.inflate(R.layout.item_tablet_new_group, layoutTabletTabsContainer, false)
        groupItem.findViewById<ImageView>(R.id.ivTabletNewGroupIcon)?.imageTintList = ColorStateList.valueOf(inactiveText)
        groupItem.findViewById<TextView>(R.id.tvTabletNewGroupLabel)?.setTextColor(inactiveText)
        groupItem.backgroundTintList = ColorStateList.valueOf(activeBg)
        val groupParams = groupItem.layoutParams as LinearLayout.LayoutParams
        groupParams.height = dpToPx(28)
        groupParams.bottomMargin = dpToPx(7)
        groupParams.marginEnd = dpToPx(6)
        groupItem.layoutParams = groupParams
        groupItem.setOnClickListener {
            if (tabs.isNotEmpty()) {
                showGroupPickerDialog(getCurrentTab(), forNewGroup = true) { renderTabletTabStrip() }
            }
        }
        btnTabletNewGroup = groupItem
        layoutTabletTabsContainer.addView(groupItem)

        val renderedGroups = mutableSetOf<String>()

        for (i in tabs.indices) {
            val tab = tabs[i]
            var tabGroup: TabGroup? = null
            if (!tab.groupId.isNullOrBlank()) {
                val group = tabGroups.find { it.id == tab.groupId }
                if (group != null) {
                    tabGroup = group
                    tab.groupName = group.title
                    tab.groupColor = group.colorHex
                    if (!renderedGroups.contains(group.id)) {
                        renderedGroups.add(group.id)
                        layoutTabletTabsContainer.addView(buildTabStripGroupChip(group, inactiveText, inactiveBg))
                    }
                    if (group.isCollapsed) continue
                }
            }

            val item = layoutInflater.inflate(R.layout.item_tablet_tab, layoutTabletTabsContainer, false)
            val root = item.findViewById<LinearLayout>(R.id.layoutTabletTabItem)
            val ivIcon = item.findViewById<ImageView>(R.id.ivTabletTabIcon)
            val tvTitle = item.findViewById<TextView>(R.id.tvTabletTabTitle)
            val btnClose = item.findViewById<ImageView>(R.id.btnTabletTabClose)
            val isActive = i == activeTabIndex
            val textColor = if (isActive) activeText else inactiveText

            val params = root.layoutParams as LinearLayout.LayoutParams
            params.height = dpToPx(if (isActive) 42 else 30)
            params.width = dpToPx(if (isActive) 184 else 156)
            root.layoutParams = params
            root.backgroundTintList = ColorStateList.valueOf(if (isActive) activeBg else inactiveBg)
            root.elevation = if (isActive) dpToPx(2).toFloat() else 0f

            tvTitle.text = when {
                tab.title.isBlank() -> if (tab.isSecurity) "보안 탭" else "새 탭"
                else -> tab.title
            }
            tvTitle.setTextColor(textColor)
            tvTitle.setTypeface(null, if (isActive) android.graphics.Typeface.BOLD else android.graphics.Typeface.NORMAL)

            val favicon = tab.webView.favicon
            if (favicon != null) {
                ivIcon.setImageBitmap(Bitmap.createScaledBitmap(favicon, dpToPx(14), dpToPx(14), true))
                ivIcon.imageTintList = null
            } else {
                ivIcon.setImageResource(if (tab.isSecurity) R.drawable.ic_shield else R.drawable.ic_globe)
                ivIcon.imageTintList = ColorStateList.valueOf(textColor)
            }

            // 그룹 컬러 태그 점
            val group = tabGroup
            if (group != null) {
                val dot = View(this)
                dot.layoutParams = LinearLayout.LayoutParams(dpToPx(6), dpToPx(6)).apply { marginEnd = dpToPx(5) }
                val shape = android.graphics.drawable.GradientDrawable()
                shape.shape = android.graphics.drawable.GradientDrawable.OVAL
                shape.setColor(try { Color.parseColor(group.colorHex) } catch (e: Exception) { textColor })
                dot.background = shape
                root.addView(dot, 0)
            }

            btnClose.imageTintList = ColorStateList.valueOf(textColor)
            btnClose.visibility = if (tabs.size > 1) View.VISIBLE else View.GONE
            root.setOnClickListener { switchTab(i) }
            root.setOnLongClickListener {
                showTabGroupActionDialog(i)
                true
            }
            btnClose.setOnClickListener { closeTab(i) }
            layoutTabletTabsContainer.addView(item)
        }

        val addItem = layoutInflater.inflate(R.layout.item_tablet_new_tab, layoutTabletTabsContainer, false)
        val addParams = addItem.layoutParams as LinearLayout.LayoutParams
        addParams.height = dpToPx(28)
        addParams.width = dpToPx(28)
        addParams.bottomMargin = dpToPx(7)
        addItem.layoutParams = addParams
        addItem.backgroundTintList = ColorStateList.valueOf(inactiveBg)
        addItem.findViewById<ImageView>(R.id.ivTabletAddIcon)?.imageTintList = ColorStateList.valueOf(inactiveText)
        addItem.setOnClickListener { addNewTab() }
        btnTabletNewTab = addItem
        layoutTabletTabsContainer.addView(addItem)


        layoutTabletTabStrip.post { layoutTabletTabStrip.scrollTo(savedScroll, 0) }
    }

    private fun buildTabStripGroupChip(group: TabGroup, textColor: Int, bgColor: Int): TextView {
        val count = tabs.count { it.groupId == group.id }
        val groupColor = try {
            Color.parseColor(group.colorHex)
        } catch (e: Exception) {
            bgColor
        }
        val label = group.title + " " + count + "개" + if (group.isCollapsed) " (접힘)" else ""
        val chip = TextView(this)
        chip.text = label
        chip.textSize = 10.5f
        chip.gravity = android.view.Gravity.CENTER
        chip.setPadding(dpToPx(8), 0, dpToPx(8), 0)
        val params = LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, dpToPx(24))
        params.marginEnd = dpToPx(6)
        params.bottomMargin = dpToPx(4)
        chip.layoutParams = params
        chip.setBackgroundResource(R.drawable.bg_tablet_new_tab_square)
        chip.backgroundTintList = ColorStateList.valueOf(groupColor)
        chip.setTextColor(if (Color.luminance(groupColor) > 0.55f) Color.parseColor("#111111") else Color.WHITE)
        chip.setOnClickListener {
            group.isCollapsed = !group.isCollapsed
            saveTabGroups()
            renderTabletTabStrip()
        }
        return chip
    }

    // ---------- 사이드바 테마 ----------
    private data class SidebarPalette(
        val bg: Int,
        val headerBg: Int,
        val textPrimary: Int,
        val textSecondary: Int,
        val accentBg: Int,
        val accentFg: Int,
        val divider: Int,
        val cardDrawable: Int,
        val inputDrawable: Int,
        val pageCardDrawable: Int
    )

    private fun sidebarPalette(theme: String): SidebarPalette {
        if (theme.startsWith("theme-custom")) {
            val accent = getCustomAccentColor()
            val dark = theme.endsWith("-dark")
            return if (dark) SidebarPalette(
                bg = mixColor(accent, Color.BLACK, 0.92f),
                headerBg = mixColor(accent, Color.BLACK, 0.85f),
                textPrimary = Color.parseColor("#F4F4F5"),
                textSecondary = Color.parseColor("#A1A1AA"),
                accentBg = accent,
                accentFg = contrastOn(accent),
                divider = mixColor(accent, Color.WHITE, 0.18f),
                cardDrawable = R.drawable.bg_result_box_dark,
                inputDrawable = R.drawable.bg_input_box_dark,
                pageCardDrawable = R.drawable.bg_page_card_dark
            ) else SidebarPalette(
                bg = mixColor(accent, Color.WHITE, 0.95f),
                headerBg = Color.WHITE,
                textPrimary = Color.parseColor("#111111"),
                textSecondary = Color.parseColor("#71717A"),
                accentBg = accent,
                accentFg = contrastOn(accent),
                divider = mixColor(accent, Color.WHITE, 0.78f),
                cardDrawable = R.drawable.bg_result_box,
                inputDrawable = R.drawable.bg_input_box,
                pageCardDrawable = R.drawable.bg_bottom_sheet
            )
        }
        return when (theme) {
            "theme-default-light" -> SidebarPalette(
                Color.parseColor("#F9FAFB"),
                Color.parseColor("#FFFFFF"),
                Color.parseColor("#111111"),
                Color.parseColor("#71717A"),
                Color.parseColor("#09090B"),
                Color.WHITE,
                Color.parseColor("#E4E4E7"),
                R.drawable.bg_result_box,
                R.drawable.bg_input_box,
                R.drawable.bg_bottom_sheet
            )
            "theme-pink-dark" -> SidebarPalette(
                Color.parseColor("#221013"),
                Color.parseColor("#261316"),
                Color.WHITE,
                Color.parseColor("#D9A5AF"),
                Color.parseColor("#F4B8C4"),
                Color.parseColor("#2B1216"),
                Color.parseColor("#3D2228"),
                R.drawable.bg_result_box_pink_dark,
                R.drawable.bg_input_box_pink_dark,
                R.drawable.bg_page_card_pink_dark
            )
            "theme-pink-light" -> SidebarPalette(
                Color.parseColor("#FFF5F7"),
                Color.parseColor("#FFFFFF"),
                Color.parseColor("#6E343D"),
                Color.parseColor("#9C5D66"),
                Color.parseColor("#6E343D"),
                Color.WHITE,
                Color.parseColor("#F3D6DC"),
                R.drawable.bg_result_box,
                R.drawable.bg_input_box,
                R.drawable.bg_bottom_sheet
            )
            else -> SidebarPalette(
                Color.parseColor("#121418"),
                Color.parseColor("#101114"),
                Color.parseColor("#F4F4F5"),
                Color.parseColor("#A1A1AA"),
                Color.WHITE,
                Color.parseColor("#0B0C0E"),
                Color.parseColor("#22252A"),
                R.drawable.bg_result_box_dark,
                R.drawable.bg_input_box_dark,
                R.drawable.bg_page_card_dark
            )
        }
    }

    private fun uiTextPrimary(): Int = sidebarPalette(getAppThemeMode()).textPrimary

    private fun uiTextSecondary(): Int = sidebarPalette(getAppThemeMode()).textSecondary

    private fun applySidebarTheme(theme: String) {
        val palette = sidebarPalette(theme)
        layoutSidebar.setBackgroundColor(palette.bg)

        findViewById<View>(R.id.layoutSidebarHeader)?.setBackgroundColor(palette.headerBg)
        findViewById<View>(R.id.viewSidebarHeaderDivider)?.setBackgroundColor(palette.divider)
        findViewById<TextView>(R.id.tvSidebarTitle)?.setTextColor(palette.textPrimary)
        findViewById<ImageView>(R.id.btnCloseSidebar)?.imageTintList = ColorStateList.valueOf(palette.textSecondary)

        findViewById<View>(R.id.layoutSidebarPageCard)?.setBackgroundResource(palette.pageCardDrawable)
        findViewById<TextView>(R.id.tvSidebarPageLabel)?.setTextColor(palette.textSecondary)
        findViewById<TextView>(R.id.tvSidebarPageTitle)?.setTextColor(palette.textPrimary)
        findViewById<TextView>(R.id.tvSidebarPageUrl)?.setTextColor(palette.textSecondary)

        findViewById<View>(R.id.scrollSidebarChat)?.setBackgroundResource(palette.cardDrawable)
        tvSidebarAiResult.setTextColor(palette.textPrimary)

        (btnSidebarQuickSummary as? MaterialButton)?.apply {
            backgroundTintList = ColorStateList.valueOf(palette.accentBg)
            setTextColor(palette.accentFg)
        }
        for (chipId in intArrayOf(R.id.btnSidebarQuickQuestions, R.id.btnSidebarQuickTranslate)) {
            (findViewById<View>(chipId) as? MaterialButton)?.apply {
                setTextColor(palette.textPrimary)
                strokeColor = ColorStateList.valueOf(palette.divider)
                backgroundTintList = ColorStateList.valueOf(Color.TRANSPARENT)
            }
        }

        etSidebarQuery.setTextColor(palette.textPrimary)
        etSidebarQuery.setHintTextColor(palette.textSecondary)
        etSidebarQuery.setBackgroundResource(palette.inputDrawable)
        btnSidebarSend.backgroundTintList = ColorStateList.valueOf(palette.accentBg)
        btnSidebarSend.setTextColor(palette.accentFg)

        findViewById<View>(R.id.viewSidebarMenuDividerTop)?.setBackgroundColor(palette.divider)
        findViewById<View>(R.id.viewSidebarMenuDividerBottom)?.setBackgroundColor(palette.divider)
        findViewById<TextView>(R.id.tvSidebarQuickActionsLabel)?.setTextColor(palette.textSecondary)

        (findViewById<View>(R.id.btnSidebarQuickNewTab) as? MaterialButton)?.apply {
            backgroundTintList = ColorStateList.valueOf(palette.accentBg)
            setTextColor(palette.accentFg)
        }
        for (outlineId in intArrayOf(R.id.btnSidebarQuickReload, R.id.btnSidebarQuickShare, R.id.btnSidebarQuickBookmark)) {
            (findViewById<View>(outlineId) as? MaterialButton)?.apply {
                setTextColor(palette.textPrimary)
                strokeColor = ColorStateList.valueOf(palette.divider)
                backgroundTintList = ColorStateList.valueOf(Color.TRANSPARENT)
            }
        }

        val menuIds = intArrayOf(
            R.id.btnSidebarMenuBag, R.id.btnSidebarMenuDownloads, R.id.btnSidebarMenuHistory,
            R.id.btnSidebarMenuSecurity, R.id.btnSidebarMenuFind, R.id.btnSidebarMenuReader,
            R.id.btnSidebarMenuTranslate, R.id.btnSidebarMenuDesktop, R.id.btnSidebarMenuPrint,
            R.id.btnSidebarMenuSavePdf, R.id.btnSidebarMenuCapture, R.id.btnSidebarMenuQrCode,
            R.id.btnSidebarMenuMacro, R.id.btnSidebarMenuCanvas, R.id.btnSidebarMenuSplit,
            R.id.btnSidebarMenuSettings
        )
        for (menuId in menuIds) {
            findViewById<TextView>(menuId)?.apply {
                setTextColor(palette.textPrimary)
                setCompoundDrawableTintList(ColorStateList.valueOf(palette.textPrimary))
            }
        }

        findViewById<TextView>(R.id.tvSidebarBookmarksHeader)?.setTextColor(palette.textPrimary)
        (findViewById<View>(R.id.btnSidebarAddBookmark) as? MaterialButton)?.apply {
            backgroundTintList = ColorStateList.valueOf(palette.accentBg)
            setTextColor(palette.accentFg)
        }

        switchSidebarTab(currentSidebarTab)
        populateSidebarBookmarks()
        if (::layoutSidebarSettingsContainer.isInitialized) renderSidebarSettingsPanel()
    }

    // ---------- 태블릿 일체형 설정 패널 ----------
    private fun sidebarSectionLabel(text: String): TextView {
        val palette = sidebarPalette(getAppThemeMode())
        return TextView(this).apply {
            this.text = text
            textSize = 10.5f
            setTextColor(palette.textSecondary)
            setTypeface(null, android.graphics.Typeface.BOLD)
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply {
                topMargin = dpToPx(12)
                bottomMargin = dpToPx(2)
            }
        }
    }

    private fun sidebarSwitchRow(
        title: String,
        subtitle: String,
        checked: Boolean,
        onChange: (Boolean) -> Unit
    ): LinearLayout {
        val palette = sidebarPalette(getAppThemeMode())
        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = android.view.Gravity.CENTER_VERTICAL
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            )
            setPadding(0, dpToPx(7), 0, dpToPx(7))
        }
        val texts = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        }
        texts.addView(TextView(this).apply {
            text = title
            textSize = 12.5f
            setTextColor(palette.textPrimary)
            setTypeface(null, android.graphics.Typeface.BOLD)
        })
        texts.addView(TextView(this).apply {
            text = subtitle
            textSize = 10.5f
            setTextColor(palette.textSecondary)
        })
        val toggle = SwitchMaterial(this).apply {
            isChecked = checked
            thumbTintList = ColorStateList.valueOf(Color.BLACK)
            trackTintList = ColorStateList.valueOf(Color.parseColor("#555555"))
            setOnCheckedChangeListener { _, value ->
                onChange(value)
                post { renderSidebarSettingsPanel() }
            }
        }
        row.addView(texts)
        row.addView(toggle)
        return row
    }

    private fun sidebarChoiceRow(
        options: List<Pair<String, String>>,
        selectedKey: String,
        onSelect: (String) -> Unit
    ): LinearLayout {
        val palette = sidebarPalette(getAppThemeMode())
        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply { topMargin = dpToPx(4) }
        }
        for ((label, key) in options) {
            val chip = TextView(this).apply {
                text = label
                textSize = 10.5f
                gravity = android.view.Gravity.CENTER
                setPadding(dpToPx(4), dpToPx(7), dpToPx(4), dpToPx(7))
                layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                    .apply { marginEnd = dpToPx(4) }
                setBackgroundResource(R.drawable.bg_pill_badge)
                if (key == selectedKey) {
                    backgroundTintList = ColorStateList.valueOf(palette.accentBg)
                    setTextColor(palette.accentFg)
                } else {
                    setTextColor(palette.textSecondary)
                }
                setOnClickListener {
                    onSelect(key)
                    post { renderSidebarSettingsPanel() }
                }
            }
            row.addView(chip)
        }
        return row
    }

    private fun sidebarChipScrollRow(
        options: List<Pair<String, String>>,
        selectedKey: String,
        onSelect: (String) -> Unit
    ): HorizontalScrollView {
        val palette = sidebarPalette(getAppThemeMode())
        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            )
        }
        for ((label, key) in options) {
            val chip = TextView(this).apply {
                text = label
                textSize = 10.5f
                gravity = android.view.Gravity.CENTER
                setPadding(dpToPx(11), dpToPx(7), dpToPx(11), dpToPx(7))
                layoutParams = LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.WRAP_CONTENT,
                    LinearLayout.LayoutParams.WRAP_CONTENT
                ).apply { marginEnd = dpToPx(5) }
                setBackgroundResource(R.drawable.bg_pill_badge)
                if (key == selectedKey) {
                    backgroundTintList = ColorStateList.valueOf(palette.accentBg)
                    setTextColor(palette.accentFg)
                } else {
                    backgroundTintList = ColorStateList.valueOf(palette.headerBg)
                    setTextColor(palette.textSecondary)
                }
                setOnClickListener {
                    onSelect(key)
                    post { renderSidebarSettingsPanel() }
                }
            }
            row.addView(chip)
        }
        return HorizontalScrollView(this).apply {
            isHorizontalScrollBarEnabled = false
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            )
            addView(row)
        }
    }

    private fun sidebarTextRow(
        title: String,
        subtitle: String,
        hint: String,
        value: String,
        isPassword: Boolean = false,
        onSave: (String) -> Unit
    ): LinearLayout {
        val palette = sidebarPalette(getAppThemeMode())
        val box = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply { topMargin = dpToPx(6) }
        }
        box.addView(TextView(this).apply {
            text = title
            textSize = 12.5f
            setTextColor(palette.textPrimary)
            setTypeface(null, android.graphics.Typeface.BOLD)
        })
        box.addView(TextView(this).apply {
            text = subtitle
            textSize = 10.5f
            setTextColor(palette.textSecondary)
            setPadding(0, dpToPx(1), 0, dpToPx(5))
        })
        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = android.view.Gravity.CENTER_VERTICAL
        }
        val input = EditText(this).apply {
            this.hint = hint
            setText(value)
            textSize = 12f
            setSingleLine(true)
            setTextColor(palette.textPrimary)
            setHintTextColor(palette.textSecondary)
            setPadding(dpToPx(10), dpToPx(8), dpToPx(10), dpToPx(8))
            setBackgroundResource(palette.inputDrawable)
            inputType = if (isPassword) android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_VARIATION_PASSWORD
            else android.text.InputType.TYPE_CLASS_TEXT
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        }
        val save = TextView(this).apply {
            text = "저장"
            textSize = 11f
            setPadding(dpToPx(10), dpToPx(8), dpToPx(10), dpToPx(8))
            setBackgroundResource(R.drawable.bg_pill_badge)
            backgroundTintList = ColorStateList.valueOf(palette.accentBg)
            setTextColor(palette.accentFg)
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply { marginStart = dpToPx(5) }
            setOnClickListener {
                onSave(input.text.toString().trim())
                hideKeyboard(input)
                Toast.makeText(this@MainActivity, "저장했습니다", Toast.LENGTH_SHORT).show()
            }
        }
        row.addView(input)
        row.addView(save)
        box.addView(row)
        return box
    }

    private fun sidebarButtonRow(buttons: List<Pair<String, () -> Unit>>): LinearLayout {
        val palette = sidebarPalette(getAppThemeMode())
        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply { topMargin = dpToPx(6) }
        }
        for ((index, pair) in buttons.withIndex()) {
            val (label, action) = pair
            val btn = Button(this).apply {
                text = label
                textSize = 11f
                isAllCaps = false
                setTextColor(if (index == 0) palette.accentFg else palette.textPrimary)
                backgroundTintList = ColorStateList.valueOf(if (index == 0) palette.accentBg else palette.headerBg)
                layoutParams = LinearLayout.LayoutParams(0, dpToPx(38), 1f).apply { marginEnd = dpToPx(5) }
                setOnClickListener { action() }
            }
            row.addView(btn)
        }
        return row
    }

    private fun renderSidebarSettingsPanel() {
        if (!::layoutSidebarSettingsContainer.isInitialized) return
        val palette = sidebarPalette(getAppThemeMode())
        val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val container = layoutSidebarSettingsContainer
        container.removeAllViews()

        // 1. 사용자 이름
        container.addView(sidebarSectionLabel("사용자 이름"))
        container.addView(
            sidebarTextRow(
                "홈 인사말에 표시될 이름",
                "시작 페이지의 인사말과 브리핑에 사용됩니다.",
                "이름 입력",
                getUserNickname()
            ) { name ->
                if (name.isNotBlank()) {
                    setUserNickname(name)
                    for (tab in tabs) {
                        if (tab.webView.url == START_PAGE_URL) {
                            tab.webView.evaluateJavascript("if (window.setUserName) window.setUserName('" + name.replace("'", " ") + "');", null)
                        }
                    }
                }
            }
        )

        // 2. 디자인 테마
        container.addView(sidebarSectionLabel("디자인 테마"))
        container.addView(
            sidebarChoiceRow(
                listOf(
                    "기본 다크" to "theme-default-dark",
                    "기본 라이트" to "theme-default-light",
                    "핑크 다크" to "theme-pink-dark",
                    "핑크 라이트" to "theme-pink-light"
                ),
                getAppThemeMode()
            ) { key -> setAppThemeMode(key) }
        )

        // 3. 커스텀 테마
        container.addView(sidebarSectionLabel("커스텀 테마 색상"))
        container.addView(
            sidebarChipScrollRow(
                CUSTOM_ACCENTS,
                getCustomAccentHex()
            ) { hex ->
                setCustomTheme(hex, prefs.getBoolean("custom_theme_is_dark", true))
            }
        )
        container.addView(
            sidebarChoiceRow(
                listOf("라이트" to "light", "다크" to "dark"),
                if (prefs.getBoolean("custom_theme_is_dark", true)) "dark" else "light"
            ) { key -> setCustomTheme(getCustomAccentHex(), key == "dark") }
        )

        // 4. 시작 페이지
        container.addView(sidebarSectionLabel("홈 시작 페이지"))
        container.addView(
            sidebarChoiceRow(
                listOf(
                    "Creamy 홈" to "home",
                    "네이버" to "naver",
                    "구글" to "google",
                    "사용자 지정" to "custom"
                ),
                getStartPageType()
            ) { key ->
                setStartPageSettings(key, getCustomStartPageUrl())
                renderSidebarSettingsPanel()
            }
        )
        container.addView(
            sidebarTextRow(
                "사용자 지정 주소",
                "시작 페이지를 '사용자 지정'으로 선택했을 때 열립니다.",
                "https://...",
                getCustomStartPageUrl()
            ) { url -> setStartPageSettings(getStartPageType(), url) }
        )
        container.addView(
            sidebarSwitchRow(
                "컬러풀 위젯 스타일",
                "홈 위젯을 테마별 그라데이션 컬러로 표시합니다",
                isWidgetColorfulEnabled()
            ) { enabled -> setWidgetColorfulEnabled(enabled) }
        )

        // 5. 검색 엔진
        container.addView(sidebarSectionLabel("기본 검색 엔진"))
        container.addView(
            sidebarChipScrollRow(
                listOf(
                    "Google" to "google",
                    "Naver" to "naver",
                    "Daum" to "daum",
                    "Bing" to "bing",
                    "DuckDuckGo" to "duckduckgo"
                ),
                getSearchEngine()
            ) { key -> setSearchEngine(key) }
        )

        // 6. 번역
        container.addView(sidebarSectionLabel("번역"))
        container.addView(
            sidebarChipScrollRow(
                translateLanguages.map { it.label to it.code },
                getTranslateLang()
            ) { code -> setTranslateLang(code) }
        )
        container.addView(
            sidebarSwitchRow(
                "외국어 사이트 자동 번역",
                "외국어 페이지를 열면 선택한 언어로 자동 번역",
                isAutoTranslateEnabled()
            ) { enabled -> setAutoTranslateEnabled(enabled) }
        )

        // 7. 브라우징
        container.addView(sidebarSectionLabel("브라우징"))
        container.addView(
            sidebarSwitchRow(
                "웹페이지 스마트 다크모드",
                "흰색 웹사이트 본문을 다크로 자동 변환",
                isWebDarkModeEnabled()
            ) { enabled ->
                setWebDarkModeEnabled(enabled)
                applyWebDarkModeToAllTabs()
                getCurrentWebView().reload()
            }
        )
        container.addView(
            sidebarSwitchRow(
                "광고 및 트래커 차단",
                "광고 스크립트와 추적기 요청 차단",
                isAdBlockEnabled()
            ) { enabled ->
                setAdBlockEnabled(enabled)
                getCurrentWebView().reload()
            }
        )
        container.addView(
            sidebarSwitchRow(
                "백그라운드 미디어 재생",
                "다른 앱을 써도 소리 유지",
                isBackgroundAudioEnabled()
            ) { enabled ->
                prefs.edit().putBoolean("background_audio_enabled", enabled).apply()
            }
        )
        container.addView(
            sidebarSwitchRow(
                "초고속 데이터 절약 모드",
                "이미지를 건너뛰고 텍스트 우선 로딩",
                isDataSaverEnabled()
            ) { enabled -> setDataSaverEnabled(enabled) }
        )
        container.addView(
            sidebarSwitchRow(
                "버튼 누름 반응 효과",
                "버튼과 항목을 터치할 때 바운스 애니메이션 표시",
                isTouchAnimationEnabled()
            ) { enabled ->
                prefs.edit().putBoolean("touch_animation_enabled", enabled).apply()
                if (enabled) applyTouchAnimationToAll(findViewById(android.R.id.content))
            }
        )
        container.addView(
            sidebarSwitchRow(
                "새 탭 컬러 아이콘",
                "사이트 공식 컬러 로고 표시",
                isColorFaviconsEnabled()
            ) { enabled ->
                prefs.edit().putBoolean("use_color_favicons", enabled).apply()
                for (tab in tabs) {
                    if (tab.url == START_PAGE_URL) {
                        tab.webView.evaluateJavascript(
                            "if (window.setColorFavicons) window.setColorFavicons(" + enabled + ");",
                            null
                        )
                    }
                }
            }
        )
        container.addView(
            sidebarSwitchRow(
                "Material You 다이내믹 컬러",
                "시스템 배경화면 색상을 앱 테마에 적용",
                isMaterialYouEnabled()
            ) { enabled ->
                setMaterialYouEnabled(enabled)
                recreate()
            }
        )

        // 8. 글자 크기
        container.addView(sidebarSectionLabel("웹페이지 글자 크기"))
        container.addView(
            sidebarChoiceRow(
                listOf("85%" to "85", "100%" to "100", "115%" to "115", "130%" to "130"),
                getTextZoom().toString()
            ) { key ->
                val zoom = key.toIntOrNull() ?: 100
                setTextZoom(zoom)
                for (tab in tabs) tab.webView.settings.textZoom = zoom
            }
        )

        // 9. 시작페이지 배경 이미지
        container.addView(sidebarSectionLabel("시작페이지 배경 이미지"))
        container.addView(TextView(this).apply {
            text = if (hasCustomStartBackground()) "현재 배경 이미지가 적용되어 있습니다." else "갤러리 이미지를 홈 화면 배경으로 사용합니다."
            textSize = 10.5f
            setTextColor(palette.textSecondary)
            setPadding(0, dpToPx(2), 0, dpToPx(2))
        })
        container.addView(
            sidebarButtonRow(
                listOf(
                    "배경 이미지 변경" to { pickCustomBackgroundImage() },
                    "배경 초기화" to {
                        clearCustomStartBackground()
                        layoutSidebar.post { renderSidebarSettingsPanel() }
                    }
                )
            )
        )

        // 10. 알림 카테고리
        container.addView(sidebarSectionLabel("알림 카테고리"))
        container.addView(
            sidebarSwitchRow(
                "다운로드 완료 알림",
                "파일 다운로드가 끝나면 알림",
                prefs.getBoolean("notif_download", true)
            ) { on -> prefs.edit().putBoolean("notif_download", on).apply() }
        )
        container.addView(
            sidebarSwitchRow(
                "보안 연결 경고 알림",
                "안전하지 않은 연결을 감지하면 알림",
                prefs.getBoolean("notif_security", true)
            ) { on -> prefs.edit().putBoolean("notif_security", on).apply() }
        )
        container.addView(
            sidebarSwitchRow(
                "백그라운드 탭 절전 알림",
                "절전 전환된 탭을 알려줍니다",
                prefs.getBoolean("notif_tabs", false)
            ) { on -> prefs.edit().putBoolean("notif_tabs", on).apply() }
        )
        container.addView(
            sidebarSwitchRow(
                "브라우징 팁 및 공지 알림",
                "새 기능과 사용 팁 안내",
                prefs.getBoolean("notif_tips", true)
            ) { on -> prefs.edit().putBoolean("notif_tips", on).apply() }
        )

        // 11. AI 엔진
        container.addView(sidebarSectionLabel("AI 엔진"))
        container.addView(
            sidebarTextRow(
                "DeepSeek API Key",
                "키가 없어도 내장 Creamy AI가 기본 처리합니다.",
                "sk-...",
                prefs.getString("deepseek_api_key", "") ?: "",
                isPassword = true
            ) { key -> prefs.edit().putString("deepseek_api_key", key).apply() }
        )

        val openAllButton = Button(this).apply {
            text = "전체 설정 열기"
            textSize = 12f
            isAllCaps = false
            setTextColor(palette.accentFg)
            backgroundTintList = ColorStateList.valueOf(palette.accentBg)
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                dpToPx(42)
            ).apply { topMargin = dpToPx(16) }
        }
        openAllButton.setOnClickListener { showSettingsDialog(forceDialog = true) }
        container.addView(openAllButton)
    }

    // ---------- 웹페이지 벡터 PDF 저장 ----------
    private fun saveWebPageAsPdf() {
        val wv = getCurrentWebView()
        val url = wv.url ?: ""
        if (url.isBlank() || url.startsWith("file:///android_asset/")) {
            Toast.makeText(this, "시작 페이지는 PDF로 저장할 수 없습니다", Toast.LENGTH_SHORT).show()
            return
        }
        val pageTitle = (wv.title ?: "웹페이지").ifBlank { "웹페이지" }
        val safeTitle = pageTitle.replace(Regex("[\\\\/:*?\"<>|]"), "_").trim().take(40).ifBlank { "webpage" }
        val stamp = SimpleDateFormat("yyyyMMdd_HHmmss", Locale.KOREA).format(Date())
        val dir = File(getExternalFilesDir(null) ?: filesDir, "pdf")
        if (!dir.exists()) dir.mkdirs()
        val target = File(dir, safeTitle + "_" + stamp + ".pdf")

        val contentWidth = wv.width.coerceAtLeast(1)
        val contentHeight = (wv.contentHeight * wv.scale).toInt().coerceIn(1, 60000)

        Toast.makeText(this, "페이지를 벡터 PDF로 저장하는 중입니다", Toast.LENGTH_SHORT).show()

        val attributes = PrintAttributes.Builder()
            .setMediaSize(PrintAttributes.MediaSize.ISO_A4)
            .setResolution(PrintAttributes.Resolution("pdf", "pdf", 200, 200))
            .setMinMargins(PrintAttributes.Margins.NO_MARGINS)
            .build()

        var document: PrintedPdfDocument? = null
        try {
            val pdf = PrintedPdfDocument(this, attributes)
            document = pdf
            val pageWidth = pdf.pageWidth
            val pageHeight = pdf.pageHeight
            val scale = pageWidth.toFloat() / contentWidth.toFloat()
            val contentPerPage = (pageHeight.toFloat() / scale).toInt().coerceAtLeast(1)
            val pageCount = ((contentHeight + contentPerPage - 1) / contentPerPage).coerceIn(1, 120)

            for (index in 0 until pageCount) {
                val page = pdf.startPage(index)
                val canvas = page.canvas
                canvas.save()
                canvas.scale(scale, scale)
                canvas.translate(0f, -(index * contentPerPage).toFloat())
                wv.draw(canvas)
                canvas.restore()
                pdf.finishPage(page)
            }

            FileOutputStream(target).use { output ->
                pdf.writeTo(output)
            }
            pdf.close()
            document = null
            handlePdfSaved(target, pageTitle, url)
        } catch (oom: OutOfMemoryError) {
            Toast.makeText(this, "페이지가 너무 커서 PDF로 만들지 못했습니다", Toast.LENGTH_SHORT).show()
            if (target.exists()) target.delete()
        } catch (e: Exception) {
            Toast.makeText(this, "PDF 저장 중 오류: " + (e.message ?: ""), Toast.LENGTH_SHORT).show()
            if (target.exists()) target.delete()
        } finally {
            try {
                document?.close()
            } catch (e: Exception) {
            }
        }
    }

    private fun handlePdfSaved(file: File, pageTitle: String, sourceUrl: String) {
        if (!file.exists() || file.length() <= 0L) {
            Toast.makeText(this, "PDF 파일이 만들어지지 않았습니다", Toast.LENGTH_SHORT).show()
            return
        }
        val sizeKb = (file.length() / 1024L).coerceAtLeast(1L)
        saveBagItem(
            BagItem(
                id = System.currentTimeMillis().toString(),
                type = "pdf",
                title = pageTitle,
                content = file.absolutePath,
                sourceUrl = sourceUrl,
                timestamp = System.currentTimeMillis()
            )
        )
        AlertDialog.Builder(this)
            .setTitle("PDF 저장 완료")
            .setMessage(pageTitle + "\n" + sizeKb + "KB 벡터 PDF로 저장했고 My Bag에 보관했습니다.\n\n" + file.absolutePath)
            .setPositiveButton("공유하기") { _, _ -> sharePdfFile(file) }
            .setNeutralButton("열기") { _, _ -> openLocalPdf(file.absolutePath) }
            .setNegativeButton("닫기", null)
            .show()
    }

    private fun sharePdfFile(file: File) {
        try {
            val uri = FileProvider.getUriForFile(this, "com.cream.browser.fileprovider", file)
            val intent = Intent(Intent.ACTION_SEND).apply {
                type = "application/pdf"
                putExtra(Intent.EXTRA_STREAM, uri)
                putExtra(Intent.EXTRA_SUBJECT, file.name)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            startActivity(Intent.createChooser(intent, "PDF 공유"))
        } catch (e: Exception) {
            Toast.makeText(this, "PDF 공유 실패: " + (e.message ?: ""), Toast.LENGTH_SHORT).show()
        }
    }

    private fun openLocalPdf(path: String) {
        val file = File(path)
        if (!file.exists()) {
            Toast.makeText(this, "PDF 파일을 찾을 수 없습니다", Toast.LENGTH_SHORT).show()
            return
        }
        try {
            val uri = FileProvider.getUriForFile(this, "com.cream.browser.fileprovider", file)
            val intent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, "application/pdf")
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            startActivity(Intent.createChooser(intent, "PDF 열기"))
        } catch (e: Exception) {
            Toast.makeText(this, "PDF를 열 수 있는 앱이 없습니다: " + (e.message ?: ""), Toast.LENGTH_SHORT).show()
        }
    }


    // ---------- 유튜브 백그라운드 오디오 ----------
    private fun isYoutubeUrl(url: String?): Boolean {
        if (url.isNullOrBlank()) return false
        return try {
            val host = Uri.parse(url).host?.lowercase(Locale.ROOT) ?: return false
            host == "youtube.com" || host.endsWith(".youtube.com") || host == "youtu.be" || host.endsWith(".youtu.be")
        } catch (e: Exception) {
            false
        }
    }

    private fun injectYoutubeBackgroundAudio(wv: WebView) {
        if (!isBackgroundAudioEnabled()) return
        val script = """
            (function() {
              try {
                Object.defineProperty(document, 'hidden', { get: function() { return false; }, configurable: true });
                Object.defineProperty(document, 'visibilityState', { get: function() { return 'visible'; }, configurable: true });
                document.hasFocus = function() { return true; };
                window.addEventListener('visibilitychange', function(e) { e.stopImmediatePropagation(); }, true);
                window.addEventListener('webkitvisibilitychange', function(e) { e.stopImmediatePropagation(); }, true);
                window.addEventListener('blur', function(e) { e.stopImmediatePropagation(); }, true);
                window.__creamBackgroundAudio = true;
              } catch (e) {}
            })();
        """.trimIndent()
        wv.evaluateJavascript(script, null)
    }

    private fun isDataSaverEnabled(): Boolean {
        return getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .getBoolean("data_saver_enabled", false)
    }

    private fun setDataSaverEnabled(enabled: Boolean) {
        getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putBoolean("data_saver_enabled", enabled)
            .apply()
        for (tab in tabs) {
            tab.webView.settings.loadsImagesAutomatically = !enabled
        }
        val current = getCurrentWebView()
        current.reload()
        Toast.makeText(
            this,
            if (enabled) "데이터 절약 모드를 켰습니다. 텍스트 우선으로 로딩합니다" else "데이터 절약 모드를 껐습니다",
            Toast.LENGTH_SHORT
        ).show()
    }

    // ---------- QR코드 생성 ----------
    private fun showQrCodeDialog() {
        if (tabs.isEmpty()) return
        val tab = getCurrentTab()
        val url = tab.webView.url ?: tab.url
        if (url.isBlank() || url.startsWith("file:///android_asset/")) {
            Toast.makeText(this, "시작 페이지는 QR코드로 만들 수 없습니다", Toast.LENGTH_SHORT).show()
            return
        }
        val bitmap = createQrBitmap(url, 900)
        if (bitmap == null) {
            Toast.makeText(this, "QR코드를 만들지 못했습니다", Toast.LENGTH_SHORT).show()
            return
        }
        val dialog = createConfiguredBottomSheetDialog()
        val view = layoutInflater.inflate(R.layout.dialog_qr_code, null)
        dialog.setContentView(view)
        applyTouchAnimationToAll(view)

        val ivQrCode = view.findViewById<ImageView>(R.id.ivQrCode)
        val tvQrPageTitle = view.findViewById<TextView>(R.id.tvQrPageTitle)
        val tvQrUrl = view.findViewById<TextView>(R.id.tvQrUrl)
        ivQrCode.setImageBitmap(bitmap)
        tvQrPageTitle.text = tab.webView.title ?: "현재 페이지"
        tvQrUrl.text = url

        view.findViewById<Button>(R.id.btnCloseQr).setOnClickListener { dialog.dismiss() }
        view.findViewById<Button>(R.id.btnShareQr).setOnClickListener { shareBitmap(bitmap) }
        view.findViewById<Button>(R.id.btnSaveQrGallery).setOnClickListener {
            saveBitmapToGallery(bitmap, tvQrPageTitle.text.toString(), "CreamQR")
            dialog.dismiss()
        }
        dialog.show()
    }

    private fun createQrBitmap(content: String, size: Int): Bitmap? {
        return try {
            val hints = HashMap<EncodeHintType, Any>()
            hints[EncodeHintType.MARGIN] = 1
            hints[EncodeHintType.CHARACTER_SET] = "UTF-8"
            val matrix = QRCodeWriter().encode(content, BarcodeFormat.QR_CODE, size, size, hints)
            val pixels = IntArray(size * size)
            for (y in 0 until size) {
                for (x in 0 until size) {
                    pixels[y * size + x] = if (matrix.get(x, y)) Color.BLACK else Color.WHITE
                }
            }
            val bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
            bitmap.setPixels(pixels, 0, size, 0, 0, size, size)
            bitmap
        } catch (e: Exception) {
            null
        }
    }

    // ---------- QR코드 스캐너 ----------
    fun openQrScanner() {
        try {
            val options = ScanOptions()
            options.setDesiredBarcodeFormats(ScanOptions.QR_CODE)
            options.setPrompt("QR 코드를 사각형 안에 맞춰주세요")
            options.setBeepEnabled(false)
            options.setOrientationLocked(false)
            qrScanLauncher.launch(options)
        } catch (e: Exception) {
            Toast.makeText(this, "QR 스캐너를 열 수 없습니다: " + (e.message ?: ""), Toast.LENGTH_SHORT).show()
        }
    }

    private fun handleScannedCode(raw: String) {
        val text = raw.trim()
        if (text.isBlank()) return
        loadWebQuery(text)
    }

    private fun showFindInPageDialog() {
        val dialog = createConfiguredBottomSheetDialog()
        val view = layoutInflater.inflate(R.layout.dialog_find_in_page, null)
        dialog.setContentView(view)
        applyTouchAnimationToAll(view)

        val etFindQuery = view.findViewById<EditText>(R.id.etFindQuery)
        val btnFindPrev = view.findViewById<ImageView>(R.id.btnFindPrev)
        val btnFindNext = view.findViewById<ImageView>(R.id.btnFindNext)
        val btnFindClose = view.findViewById<ImageView>(R.id.btnFindClose)

        val currentWv = getCurrentWebView()

        etFindQuery.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {
                val q = s?.toString()?.trim() ?: ""
                if (q.isNotEmpty()) {
                    currentWv.findAllAsync(q)
                } else {
                    currentWv.clearMatches()
                }
            }
            override fun afterTextChanged(s: Editable?) {}
        })

        btnFindPrev.setOnClickListener { currentWv.findNext(false) }
        btnFindNext.setOnClickListener { currentWv.findNext(true) }
        btnFindClose.setOnClickListener {
            currentWv.clearMatches()
            dialog.dismiss()
        }
        dialog.setOnDismissListener { currentWv.clearMatches() }
        dialog.show()
    }

    private fun printCurrentPage() {
        val currentWv = getCurrentWebView()
        val printManager = getSystemService(Context.PRINT_SERVICE) as? PrintManager
        if (printManager != null) {
            val jobName = "Cream Browser - ${currentWv.title ?: "문서"}"
            val printAdapter = currentWv.createPrintDocumentAdapter(jobName)
            printManager.print(jobName, printAdapter, PrintAttributes.Builder().build())
        } else {
            Toast.makeText(this, "인쇄 서비스를 사용할 수 없습니다", Toast.LENGTH_SHORT).show()
        }
    }

    private fun showHistoryDialog() {
        val dialog = createConfiguredBottomSheetDialog()
        val view = layoutInflater.inflate(R.layout.dialog_history, null)
        dialog.setContentView(view)
        applyTouchAnimationToAll(view)

        val layoutHistoryList = view.findViewById<LinearLayout>(R.id.layoutHistoryList)
        val btnClearHistory = view.findViewById<Button>(R.id.btnClearHistory)
        val btnCloseHistory = view.findViewById<ImageView>(R.id.btnCloseHistory)

        fun populateHistory() {
            layoutHistoryList.removeAllViews()
            val history = getSavedHistory()

            if (history.isEmpty()) {
                val emptyTv = TextView(this).apply {
                    text = "최근 방문 기록이 없습니다."
                    textSize = 12.5f
                    setTextColor(getColor(R.color.text_muted))
                    setPadding(10, 20, 10, 20)
                }
                layoutHistoryList.addView(emptyTv)
                return
            }

            val dateFormat = SimpleDateFormat("MM.dd HH:mm", Locale.KOREA)
            for (item in history) {
                val itemView = layoutInflater.inflate(R.layout.item_tab_card, layoutHistoryList, false)
                val tvTitle = itemView.findViewById<TextView>(R.id.tvTabTitle)
                val tvUrl = itemView.findViewById<TextView>(R.id.tvTabUrl)
                val btnClose = itemView.findViewById<ImageView>(R.id.btnTabClose)
                itemView.findViewById<ImageView>(R.id.btnTabGroupAction).visibility = View.GONE

                tvTitle.text = item.title
                tvUrl.text = "${dateFormat.format(Date(item.timestamp))} · ${item.url}"
                btnClose.visibility = View.GONE

                itemView.setOnClickListener {
                    dialog.dismiss()
                    loadWebQuery(item.url)
                }
                layoutHistoryList.addView(itemView)
            }
        }

        populateHistory()

        btnClearHistory.setOnClickListener {
            getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                .edit()
                .putString("saved_history_json", "[]")
                .apply()
            populateHistory()
            Toast.makeText(this, "방문 기록이 삭제되었습니다", Toast.LENGTH_SHORT).show()
        }

        btnCloseHistory.setOnClickListener { dialog.dismiss() }
        dialog.show()
    }

    // 북마크 & 즐겨찾기 폴더
    private fun showBookmarksDialog() {
        val dialog = createConfiguredBottomSheetDialog()
        val view = layoutInflater.inflate(R.layout.dialog_bookmarks, null)
        dialog.setContentView(view)
        applyTouchAnimationToAll(view)

        val layoutFoldersBar = view.findViewById<LinearLayout>(R.id.layoutBookmarkFoldersBar)
        val layoutBookmarksList = view.findViewById<LinearLayout>(R.id.layoutBookmarksList)
        val btnAddCurrentBookmark = view.findViewById<Button>(R.id.btnAddCurrentBookmark)
        val btnAddFolder = view.findViewById<TextView>(R.id.btnAddNewBookmarkFolder)
        val btnClose = view.findViewById<ImageView>(R.id.btnCloseBookmarks)

        var selectedFolder = "전체"

        fun populateFolders() {
            layoutFoldersBar.removeAllViews()
            val folders = mutableListOf("전체")
            folders.addAll(getBookmarkFolders())
            for (f in getSavedBookmarks().map { it.folder }) {
                if (!folders.contains(f)) folders.add(f)
            }

            for (f in folders) {
                val chip = TextView(this).apply {
                    text = f
                    textSize = 11f
                    setPadding(30, 14, 30, 14)
                    layoutParams = LinearLayout.LayoutParams(
                        LinearLayout.LayoutParams.WRAP_CONTENT,
                        LinearLayout.LayoutParams.WRAP_CONTENT
                    ).apply { marginEnd = 16 }
                    if (f == selectedFolder) {
                        setBackgroundResource(R.drawable.bg_pill_badge)
                        backgroundTintList = ColorStateList.valueOf(getColor(R.color.primary_black))
                        setTextColor(Color.WHITE)
                    } else {
                        setBackgroundResource(R.drawable.bg_pill_badge)
                        backgroundTintList = null
                        setTextColor(getColor(R.color.text_muted))
                    }
                    setOnClickListener {
                        selectedFolder = f
                        populateFolders()
                    }
                }
                layoutFoldersBar.addView(chip)
            }

            layoutFoldersBar.addView(btnAddFolder)
        }

        fun populateBookmarks() {
            layoutBookmarksList.removeAllViews()
            val allBookmarks = getSavedBookmarks()
            val filtered = if (selectedFolder == "전체") allBookmarks else allBookmarks.filter { it.folder == selectedFolder }

            if (filtered.isEmpty()) {
                val emptyTv = TextView(this).apply {
                    text = "'$selectedFolder' 폴더에 저장된 북마크가 없습니다."
                    textSize = 12f
                    setTextColor(getColor(R.color.text_muted))
                    setPadding(10, 20, 10, 20)
                }
                layoutBookmarksList.addView(emptyTv)
                return
            }

            for (b in filtered) {
                val item = layoutInflater.inflate(R.layout.item_tab_card, layoutBookmarksList, false)
                val tvTitle = item.findViewById<TextView>(R.id.tvTabTitle)
                val tvUrl = item.findViewById<TextView>(R.id.tvTabUrl)
                val btnClose = item.findViewById<ImageView>(R.id.btnTabClose)
                val tvFolderTag = item.findViewById<TextView>(R.id.tvGroupTag)
                item.findViewById<ImageView>(R.id.btnTabGroupAction).visibility = View.GONE

                tvTitle.text = b.title
                tvUrl.text = b.url

                if (b.folder != "기본") {
                    tvFolderTag.visibility = View.VISIBLE
                    tvFolderTag.text = b.folder
                    tvFolderTag.backgroundTintList = ColorStateList.valueOf(Color.parseColor("#4B5563"))
                } else {
                    tvFolderTag.visibility = View.GONE
                }

                item.setOnClickListener {
                    dialog.dismiss()
                    loadWebQuery(b.url)
                }

                btnClose.setOnClickListener {
                    deleteBookmark(b.url)
                    populateBookmarks()
                }

                layoutBookmarksList.addView(item)
            }
        }

        btnAddFolder.setOnClickListener {
            val input = EditText(this).apply { hint = "폴더 이름 (예: 업무, 쇼핑, AI)" }
            AlertDialog.Builder(this)
                .setTitle("새 즐겨찾기 폴더")
                .setView(input)
                .setPositiveButton("생성") { _, _ ->
                    val folderName = input.text.toString().trim()
                    if (folderName.isNotEmpty()) {
                        addBookmarkFolder(folderName)
                        selectedFolder = folderName
                        populateFolders()
                        populateBookmarks()
                    }
                }
                .setNegativeButton("취소", null)
                .show()
        }

        btnAddCurrentBookmark.setOnClickListener {
            val currentTab = getCurrentTab()
            val title = currentTab.webView.title ?: "북마크"
            val url = currentTab.webView.url ?: START_PAGE_URL
            val targetFolder = if (selectedFolder == "전체") "기본" else selectedFolder
            saveCustomBookmark(title, url, targetFolder)
            Toast.makeText(this, "'$title'이(가) '$targetFolder' 폴더에 저장되었습니다.", Toast.LENGTH_SHORT).show()
            populateBookmarks()
        }

        btnClose.setOnClickListener { dialog.dismiss() }

        populateFolders()
        populateBookmarks()
        dialog.show()
    }

    // 설정 & 개인화 다이얼로그 (Material You, 검색엔진, 광고 차단, 텍스트 크기)
    private fun showSettingsDialog(forceDialog: Boolean = false) {
        if (isTabletLayout() && !forceDialog && ::layoutSidebar.isInitialized) {
            switchSidebarTab("settings")
            if (layoutSidebar.visibility != View.VISIBLE) toggleSidebar("settings")
            return
        }
        val dialog = createConfiguredBottomSheetDialog()
        val view = layoutInflater.inflate(R.layout.dialog_settings, null)
        dialog.setContentView(view)
        applyTouchAnimationToAll(view)

                val btnThemeDefaultDark = view.findViewById<TextView>(R.id.btnThemeDefaultDark)
        val btnThemeDefaultLight = view.findViewById<TextView>(R.id.btnThemeDefaultLight)
        val btnThemePinkDark = view.findViewById<TextView>(R.id.btnThemePinkDark)
        val btnThemePinkLight = view.findViewById<TextView>(R.id.btnThemePinkLight)

        var selectedTheme = getAppThemeMode()

        fun updateThemeChips() {
            val chips = listOf(
                btnThemeDefaultDark to "theme-default-dark",
                btnThemeDefaultLight to "theme-default-light",
                btnThemePinkDark to "theme-pink-dark",
                btnThemePinkLight to "theme-pink-light"
            )
            for ((chip, thm) in chips) {
                if (thm == selectedTheme) {
                    chip.setBackgroundResource(R.drawable.bg_pill_badge)
                    chip.backgroundTintList = ColorStateList.valueOf(getColor(R.color.primary_black))
                    chip.setTextColor(Color.WHITE)
                } else {
                    chip.setBackgroundResource(R.drawable.bg_pill_badge)
                    chip.backgroundTintList = null
                    chip.setTextColor(getColor(R.color.text_muted))
                }
            }
        }

        btnThemeDefaultDark.setOnClickListener {
            selectedTheme = "theme-default-dark"
            setAppThemeMode(selectedTheme)
            updateThemeChips()
        }
        btnThemeDefaultLight.setOnClickListener {
            selectedTheme = "theme-default-light"
            setAppThemeMode(selectedTheme)
            updateThemeChips()
        }
        btnThemePinkDark.setOnClickListener {
            selectedTheme = "theme-pink-dark"
            setAppThemeMode(selectedTheme)
            updateThemeChips()
        }
        btnThemePinkLight.setOnClickListener {
            selectedTheme = "theme-pink-light"
            setAppThemeMode(selectedTheme)
            updateThemeChips()
        }
        updateThemeChips()

        // ---------- 커스텀 테마 색상 + 라이트/다크 ----------
        val accentRow = view.findViewById<LinearLayout>(R.id.layoutCustomAccentRow)
        val btnCustomModeLight = view.findViewById<TextView>(R.id.btnCustomModeLight)
        val btnCustomModeDark = view.findViewById<TextView>(R.id.btnCustomModeDark)
        var selectedAccent = getCustomAccentHex()

        fun renderModeChips() {
            val isDark = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                .getBoolean("custom_theme_is_dark", true)
            val active = isCustomThemeActive()
            for ((chip, dark) in listOf(btnCustomModeLight to false, btnCustomModeDark to true)) {
                val selected = active && dark == isDark
                chip.setBackgroundResource(R.drawable.bg_pill_badge)
                if (selected) {
                    chip.backgroundTintList = ColorStateList.valueOf(getColor(R.color.primary_black))
                    chip.setTextColor(Color.WHITE)
                } else {
                    chip.backgroundTintList = ColorStateList.valueOf(getColor(R.color.bg_light))
                    chip.setTextColor(getColor(R.color.text_muted))
                }
            }
        }

        fun renderAccentChips() {
            accentRow.removeAllViews()
            for ((hex, label) in CUSTOM_ACCENTS) {
                accentRow.addView(buildAccentChip(hex, label, hex.equals(selectedAccent, true)) {
                    selectedAccent = hex
                    setCustomTheme(
                        hex,
                        getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                            .getBoolean("custom_theme_is_dark", true)
                    )
                    selectedTheme = getAppThemeMode()
                    renderAccentChips()
                    renderModeChips()
                    updateThemeChips()
                })
            }
        }

        renderAccentChips()
        renderModeChips()
        btnCustomModeLight.setOnClickListener {
            setCustomTheme(selectedAccent, false)
            selectedTheme = getAppThemeMode()
            renderModeChips()
            updateThemeChips()
        }
        btnCustomModeDark.setOnClickListener {
            setCustomTheme(selectedAccent, true)
            selectedTheme = getAppThemeMode()
            renderModeChips()
            updateThemeChips()
        }

        // ---------- 시작페이지 배경 이미지 ----------
        val tvBgStatus = view.findViewById<TextView>(R.id.tvStartBackgroundStatus)
        fun updateBgStatus() {
            tvBgStatus.text = if (hasCustomStartBackground())
                "현재 배경 이미지가 적용되어 있습니다."
            else
                "갤러리 이미지를 홈 화면 배경으로 사용합니다."
        }
        updateBgStatus()
        view.findViewById<Button>(R.id.btnPickStartBackground)?.setOnClickListener {
            pickCustomBackgroundImage()
        }
        view.findViewById<Button>(R.id.btnResetStartBackground)?.setOnClickListener {
            clearCustomStartBackground()
            updateBgStatus()
            Toast.makeText(this, "배경 이미지가 초기화되었습니다", Toast.LENGTH_SHORT).show()
        }

        // ---------- 번역 언어 + 자동 번역 ----------
        val langRow = view.findViewById<LinearLayout>(R.id.layoutTranslateLangChips)
        var selectedLang = getTranslateLang()
        fun renderLangChips() {
            langRow.removeAllViews()
            for (lang in translateLanguages) {
                val chip = TextView(this).apply {
                    text = lang.label
                    textSize = 11.5f
                    gravity = android.view.Gravity.CENTER
                    setPadding(dpToPx(14), 0, dpToPx(14), 0)
                    layoutParams = LinearLayout.LayoutParams(
                        LinearLayout.LayoutParams.WRAP_CONTENT,
                        dpToPx(32)
                    ).apply { marginEnd = dpToPx(6) }
                    setBackgroundResource(R.drawable.bg_pill_badge)
                    if (lang.code == selectedLang) {
                        backgroundTintList = ColorStateList.valueOf(getColor(R.color.primary_black))
                        setTextColor(Color.WHITE)
                    } else {
                        backgroundTintList = ColorStateList.valueOf(getColor(R.color.bg_light))
                        setTextColor(getColor(R.color.text_muted))
                    }
                    setOnClickListener {
                        selectedLang = lang.code
                        setTranslateLang(lang.code)
                        tvTranslateChipText.text = "번역"
                        renderLangChips()
                    }
                }
                langRow.addView(chip)
            }
        }
        renderLangChips()

        val switchAutoTranslate = view.findViewById<SwitchMaterial>(R.id.switchAutoTranslate)
        switchAutoTranslate?.isChecked = isAutoTranslateEnabled()
        switchAutoTranslate?.setOnCheckedChangeListener { _, checked ->
            setAutoTranslateEnabled(checked)
        }

        // 사용자 이름 설정 뷰
        val etSettingUserName = view.findViewById<EditText>(R.id.etSettingUserName)
        etSettingUserName?.setText(getUserNickname())

        // 시작 페이지 설정 칩들
        val btnStartPageHome = view.findViewById<TextView>(R.id.btnStartPageHome)
        val btnStartPageNaver = view.findViewById<TextView>(R.id.btnStartPageNaver)
        val btnStartPageGoogle = view.findViewById<TextView>(R.id.btnStartPageGoogle)
        val btnStartPageCustom = view.findViewById<TextView>(R.id.btnStartPageCustom)
        val etCustomStartPageUrl = view.findViewById<EditText>(R.id.etCustomStartPageUrl)

        var selectedStartPage = getStartPageType()
        etCustomStartPageUrl?.setText(getCustomStartPageUrl())
        etCustomStartPageUrl?.visibility = if (selectedStartPage == "custom") View.VISIBLE else View.GONE

        fun updateStartPageChips() {
            val chips = listOf(
                btnStartPageHome to "home",
                btnStartPageNaver to "naver",
                btnStartPageGoogle to "google",
                btnStartPageCustom to "custom"
            )
            for ((chip, typ) in chips) {
                if (chip == null) continue
                if (typ == selectedStartPage) {
                    chip.setBackgroundResource(R.drawable.bg_pill_badge)
                    chip.backgroundTintList = ColorStateList.valueOf(getColor(R.color.primary_black))
                    chip.setTextColor(Color.WHITE)
                } else {
                    chip.setBackgroundResource(R.drawable.bg_pill_badge)
                    chip.backgroundTintList = null
                    chip.setTextColor(getColor(R.color.text_muted))
                }
            }
            etCustomStartPageUrl?.visibility = if (selectedStartPage == "custom") View.VISIBLE else View.GONE
        }

        btnStartPageHome?.setOnClickListener { selectedStartPage = "home"; updateStartPageChips() }
        btnStartPageNaver?.setOnClickListener { selectedStartPage = "naver"; updateStartPageChips() }
        btnStartPageGoogle?.setOnClickListener { selectedStartPage = "google"; updateStartPageChips() }
        btnStartPageCustom?.setOnClickListener { selectedStartPage = "custom"; updateStartPageChips() }
        updateStartPageChips()

        // 알림 카테고리 스위치들
        val switchNotifDownload = view.findViewById<SwitchMaterial>(R.id.switchNotifDownload)
        val switchNotifSecurity = view.findViewById<SwitchMaterial>(R.id.switchNotifSecurity)
        val switchNotifTabs = view.findViewById<SwitchMaterial>(R.id.switchNotifTabs)
        val switchNotifTips = view.findViewById<SwitchMaterial>(R.id.switchNotifTips)

        val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        switchNotifDownload?.isChecked = prefs.getBoolean("notif_download", true)
        switchNotifSecurity?.isChecked = prefs.getBoolean("notif_security", true)
        switchNotifTabs?.isChecked = prefs.getBoolean("notif_tabs", false)
        switchNotifTips?.isChecked = prefs.getBoolean("notif_tips", true)

        val switchMaterialYou = view.findViewById<SwitchMaterial>(R.id.switchMaterialYou)
        val switchAdBlock = view.findViewById<SwitchMaterial>(R.id.switchAdBlock)
        val switchColorFavicons = view.findViewById<SwitchMaterial>(R.id.switchColorFavicons)
        val switchWidgetColorful = view.findViewById<SwitchMaterial>(R.id.switchWidgetColorful)
        val tvZoomDisplay = view.findViewById<TextView>(R.id.tvZoomDisplay)
        val btnZoom80 = view.findViewById<Button>(R.id.btnZoom80)
        val btnZoom100 = view.findViewById<Button>(R.id.btnZoom100)
        val btnZoom120 = view.findViewById<Button>(R.id.btnZoom120)
        val btnZoom140 = view.findViewById<Button>(R.id.btnZoom140)
        val etApiKey = view.findViewById<EditText>(R.id.etApiKey)
        val btnSave = view.findViewById<Button>(R.id.btnSaveSettings)
        val btnClose = view.findViewById<ImageView>(R.id.btnCloseSettingsIcon)

        // 검색엔진 칩들
        val engineGoogle = view.findViewById<TextView>(R.id.btnEngineGoogle)
        val engineNaver = view.findViewById<TextView>(R.id.btnEngineNaver)
        val engineDaum = view.findViewById<TextView>(R.id.btnEngineDaum)
        val engineBing = view.findViewById<TextView>(R.id.btnEngineBing)
        val engineDuck = view.findViewById<TextView>(R.id.btnEngineDuck)

        var selectedEngine = getSearchEngine()
        var selectedZoom = getTextZoom()

        fun updateEngineChips() {
            val engines = listOf(
                engineGoogle to "google",
                engineNaver to "naver",
                engineDaum to "daum",
                engineBing to "bing",
                engineDuck to "duckduckgo"
            )
            for ((viewChip, eng) in engines) {
                if (eng == selectedEngine) {
                    viewChip.setBackgroundResource(R.drawable.bg_pill_badge)
                    viewChip.backgroundTintList = ColorStateList.valueOf(getColor(R.color.primary_black))
                    viewChip.setTextColor(Color.WHITE)
                } else {
                    viewChip.setBackgroundResource(R.drawable.bg_pill_badge)
                    viewChip.backgroundTintList = null
                    viewChip.setTextColor(getColor(R.color.text_muted))
                }
            }
        }

        engineGoogle.setOnClickListener { selectedEngine = "google"; updateEngineChips() }
        engineNaver.setOnClickListener { selectedEngine = "naver"; updateEngineChips() }
        engineDaum.setOnClickListener { selectedEngine = "daum"; updateEngineChips() }
        engineBing.setOnClickListener { selectedEngine = "bing"; updateEngineChips() }
        engineDuck.setOnClickListener { selectedEngine = "duckduckgo"; updateEngineChips() }

        updateEngineChips()

        switchMaterialYou.isChecked = isMaterialYouEnabled()
        switchAdBlock.isChecked = isAdBlockEnabled()
        switchColorFavicons?.isChecked = isColorFaviconsEnabled()
        switchWidgetColorful?.isChecked = isWidgetColorfulEnabled()

        val switchWebDarkMode = view.findViewById<SwitchMaterial>(R.id.switchWebDarkMode)
        val switchBackgroundAudio = view.findViewById<SwitchMaterial>(R.id.switchBackgroundAudio)
        val switchDataSaver = view.findViewById<SwitchMaterial>(R.id.switchDataSaver)
        switchWebDarkMode?.isChecked = isWebDarkModeEnabled()
        switchBackgroundAudio?.isChecked = isBackgroundAudioEnabled()
        switchDataSaver?.isChecked = isDataSaverEnabled()

        val switchTouchAnimation = view.findViewById<SwitchMaterial>(R.id.switchTouchAnimation)
        val isTouchAnimEnabled = isTouchAnimationEnabled()
        switchTouchAnimation?.isChecked = isTouchAnimEnabled
        switchTouchAnimation?.setOnCheckedChangeListener { _, isChecked ->
            prefs.edit().putBoolean("touch_animation_enabled", isChecked).apply()
            if (isChecked) {
                applyTouchAnimationToAll(findViewById(android.R.id.content))
                applyTouchAnimationToAll(view)
            }
        }

        tvZoomDisplay.text = "${selectedZoom}% 설정됨"

        etApiKey.setText(prefs.getString("deepseek_api_key", ""))

        btnZoom80.setOnClickListener { selectedZoom = 85; tvZoomDisplay.text = "85% (작게)" }
        btnZoom100.setOnClickListener { selectedZoom = 100; tvZoomDisplay.text = "100% (기본)" }
        btnZoom120.setOnClickListener { selectedZoom = 115; tvZoomDisplay.text = "115% (크게)" }
        btnZoom140.setOnClickListener { selectedZoom = 130; tvZoomDisplay.text = "130% (매우 크게)" }

        btnSave.setOnClickListener {
            // 사용자 이름 저장 및 갱신
            val newName = etSettingUserName?.text?.toString()?.trim() ?: ""
            if (newName.isNotBlank()) {
                setUserNickname(newName)
            }

            // 시작 페이지 저장
            val customUrl = etCustomStartPageUrl?.text?.toString()?.trim() ?: ""
            setStartPageSettings(selectedStartPage, customUrl)

            // 알림 카테고리 저장
            prefs.edit().apply {
                putBoolean("notif_download", switchNotifDownload?.isChecked ?: true)
                putBoolean("notif_security", switchNotifSecurity?.isChecked ?: true)
                putBoolean("notif_tabs", switchNotifTabs?.isChecked ?: false)
                putBoolean("notif_tips", switchNotifTips?.isChecked ?: true)
            }.apply()

            setSearchEngine(selectedEngine)
            setAdBlockEnabled(switchAdBlock.isChecked)
            setWebDarkModeEnabled(switchWebDarkMode?.isChecked ?: true)
            applyWebDarkModeToAllTabs()
            prefs.edit().putBoolean("background_audio_enabled", switchBackgroundAudio?.isChecked ?: true).apply()
            setDataSaverEnabled(switchDataSaver?.isChecked ?: false)
            setTextZoom(selectedZoom)
            val matYouChanged = isMaterialYouEnabled() != switchMaterialYou.isChecked
            setMaterialYouEnabled(switchMaterialYou.isChecked)

            val colorFavChanged = isColorFaviconsEnabled() != (switchColorFavicons?.isChecked ?: true)
            prefs.edit().putBoolean("use_color_favicons", switchColorFavicons?.isChecked ?: true).apply()
            if (colorFavChanged) {
                for (t in tabs) {
                    if (t.url == START_PAGE_URL) {
                        t.webView.evaluateJavascript("if (window.setColorFavicons) window.setColorFavicons(${switchColorFavicons?.isChecked ?: true});", null)
                    }
                }
            }

            if (isWidgetColorfulEnabled() != (switchWidgetColorful?.isChecked ?: true)) {
                setWidgetColorfulEnabled(switchWidgetColorful?.isChecked ?: true)
            }

            val newTouchAnimState = switchTouchAnimation?.isChecked ?: false
            prefs.edit().putBoolean("touch_animation_enabled", newTouchAnimState).apply()
            if (newTouchAnimState) {
                applyTouchAnimationToAll(findViewById(android.R.id.content))
            }

            val key = etApiKey.text.toString().trim()
            prefs.edit().putString("deepseek_api_key", key).apply()

            // 현재 웹뷰 줌 즉시 적용
            getCurrentWebView().settings.textZoom = selectedZoom

            Toast.makeText(this, "설정이 안전하게 저장되었습니다", Toast.LENGTH_SHORT).show()
            dialog.dismiss()

            if (matYouChanged) {
                recreate()
            }
        }

        btnClose.setOnClickListener { dialog.dismiss() }
        dialog.show()
    }

    private fun addHistoryEntry(title: String, url: String) {
        if (url.isBlank() || url == START_PAGE_URL || url == START_PAGE_SECURITY_URL || url.startsWith("file:///android_asset/")) return
        val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val rawJson = prefs.getString("saved_history_json", "[]") ?: "[]"
        val arr = try { JSONArray(rawJson) } catch (e: Exception) { JSONArray() }

        val newArr = JSONArray()
        val newObj = JSONObject().apply {
            put("title", if (title.isBlank()) url else title)
            put("url", url)
            put("time", System.currentTimeMillis())
        }
        newArr.put(newObj)
        for (i in 0 until minOf(arr.length(), 50)) {
            val item = arr.getJSONObject(i)
            if (item.getString("url") != url) {
                newArr.put(item)
            }
        }
        prefs.edit().putString("saved_history_json", newArr.toString()).apply()
    }

    private fun getSavedHistory(): List<HistoryItem> {
        val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val rawJson = prefs.getString("saved_history_json", "[]") ?: "[]"
        val result = mutableListOf<HistoryItem>()

        try {
            val arr = JSONArray(rawJson)
            for (i in 0 until arr.length()) {
                val obj = arr.getJSONObject(i)
                result.add(
                    HistoryItem(
                        title = obj.getString("title"),
                        url = obj.getString("url"),
                        timestamp = obj.optLong("time", System.currentTimeMillis())
                    )
                )
            }
        } catch (e: Exception) {}
        return result
    }

    private fun getSavedBookmarks(): List<BookmarkItem> {
        val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val rawJson = prefs.getString("saved_bookmarks_json", "[]") ?: "[]"
        val result = mutableListOf<BookmarkItem>()

        result.add(BookmarkItem("Creamy Hub", BASE_URL, "기본", false))
        result.add(BookmarkItem("Creamy AI 채팅", CREAMY_URL, "기본", false))
        result.add(BookmarkItem("Google", "https://www.google.com", "기본", false))
        result.add(BookmarkItem("Naver", "https://www.naver.com", "기본", false))
        result.add(BookmarkItem("GitHub", "https://github.com", "개발", false))

        try {
            val arr = JSONArray(rawJson)
            for (i in 0 until arr.length()) {
                val obj = arr.getJSONObject(i)
                result.add(
                    BookmarkItem(
                        title = obj.getString("title"),
                        url = obj.getString("url"),
                        folder = obj.optString("folder", "기본"),
                        isCustom = true
                    )
                )
            }
        } catch (e: Exception) {}
        return result
    }

    private fun saveCustomBookmark(title: String, url: String, folder: String) {
        val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val rawJson = prefs.getString("saved_bookmarks_json", "[]") ?: "[]"
        val arr = try { JSONArray(rawJson) } catch (e: Exception) { JSONArray() }
        val newObj = JSONObject().apply {
            put("title", title)
            put("url", url)
            put("folder", folder)
        }
        arr.put(newObj)
        prefs.edit().putString("saved_bookmarks_json", arr.toString()).apply()
        if (::layoutSidebar.isInitialized && layoutSidebar.visibility == View.VISIBLE) {
            populateSidebarBookmarks()
        }
    }

    private fun deleteBookmark(url: String) {
        val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val rawJson = prefs.getString("saved_bookmarks_json", "[]") ?: "[]"
        val arr = try { JSONArray(rawJson) } catch (e: Exception) { JSONArray() }
        val newArr = JSONArray()
        for (i in 0 until arr.length()) {
            val obj = arr.getJSONObject(i)
            if (obj.getString("url") != url) {
                newArr.put(obj)
            }
        }
        prefs.edit().putString("saved_bookmarks_json", newArr.toString()).apply()
        if (::layoutSidebar.isInitialized && layoutSidebar.visibility == View.VISIBLE) {
            populateSidebarBookmarks()
        }
    }

    private fun getBookmarkFolders(): List<String> {
        val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val raw = prefs.getString("saved_bookmark_folders", "[\"기본\", \"업무\", \"쇼핑\", \"AI/기술\"]") ?: "[]"
        val list = mutableListOf<String>()
        try {
            val arr = JSONArray(raw)
            for (i in 0 until arr.length()) {
                list.add(arr.getString(i))
            }
        } catch (e: Exception) {}
        return list
    }

    private fun addBookmarkFolder(folderName: String) {
        val folders = getBookmarkFolders().toMutableList()
        if (!folders.contains(folderName)) {
            folders.add(folderName)
            val arr = JSONArray(folders)
            getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                .edit()
                .putString("saved_bookmark_folders", arr.toString())
                .apply()
        }
    }

    // 탭 그룹 영구 저장 및 복원
    private fun loadSavedTabGroups() {
        val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val raw = prefs.getString("saved_tab_groups_json", "[]") ?: "[]"
        tabGroups.clear()
        try {
            val arr = JSONArray(raw)
            for (i in 0 until arr.length()) {
                val obj = arr.getJSONObject(i)
                tabGroups.add(
                    TabGroup(
                        id = obj.getString("id"),
                        title = obj.getString("title"),
                        colorHex = obj.getString("colorHex"),
                        isCollapsed = obj.optBoolean("isCollapsed", false)
                    )
                )
            }
        } catch (e: Exception) {}
    }

    private fun saveTabGroups() {
        val arr = JSONArray()
        for (g in tabGroups) {
            val obj = JSONObject().apply {
                put("id", g.id)
                put("title", g.title)
                put("colorHex", g.colorHex)
                put("isCollapsed", g.isCollapsed)
            }
            arr.put(obj)
        }
        getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putString("saved_tab_groups_json", arr.toString())
            .apply()
    }

    // Bag 항목 입출력
    private fun getSavedBagItems(): List<BagItem> {
        val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val raw = prefs.getString("saved_bag_items_json", "[]") ?: "[]"
        val list = mutableListOf<BagItem>()
        try {
            val arr = JSONArray(raw)
            for (i in 0 until arr.length()) {
                val obj = arr.getJSONObject(i)
                list.add(
                    BagItem(
                        id = obj.getString("id"),
                        type = obj.getString("type"),
                        title = obj.getString("title"),
                        content = obj.getString("content"),
                        sourceUrl = obj.optString("sourceUrl", ""),
                        timestamp = obj.optLong("timestamp", System.currentTimeMillis())
                    )
                )
            }
        } catch (e: Exception) {}
        return list
    }

    private fun saveBagItem(item: BagItem) {
        val items = getSavedBagItems().toMutableList()
        items.add(0, item)
        val arr = JSONArray()
        for (it in items.take(100)) {
            val obj = JSONObject().apply {
                put("id", it.id)
                put("type", it.type)
                put("title", it.title)
                put("content", it.content)
                put("sourceUrl", it.sourceUrl)
                put("timestamp", it.timestamp)
            }
            arr.put(obj)
        }
        getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putString("saved_bag_items_json", arr.toString())
            .apply()
    }

    private fun deleteBagItem(id: String) {
        val items = getSavedBagItems().filter { it.id != id }
        val arr = JSONArray()
        for (it in items) {
            val obj = JSONObject().apply {
                put("id", it.id)
                put("type", it.type)
                put("title", it.title)
                put("content", it.content)
                put("sourceUrl", it.sourceUrl)
                put("timestamp", it.timestamp)
            }
            arr.put(obj)
        }
        getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putString("saved_bag_items_json", arr.toString())
            .apply()
    }

    private fun clearBagItems() {
        getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putString("saved_bag_items_json", "[]")
            .apply()
    }

    // 다운로드 항목 입출력
    private fun getSavedDownloads(): List<DownloadedFileItem> {
        val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val raw = prefs.getString("saved_downloads_json", "[]") ?: "[]"
        val list = mutableListOf<DownloadedFileItem>()
        try {
            val arr = JSONArray(raw)
            for (i in 0 until arr.length()) {
                val obj = arr.getJSONObject(i)
                list.add(
                    DownloadedFileItem(
                        filename = obj.getString("filename"),
                        url = obj.getString("url"),
                        path = obj.getString("path"),
                        size = obj.optLong("size", 0),
                        timestamp = obj.optLong("timestamp", System.currentTimeMillis())
                    )
                )
            }
        } catch (e: Exception) {}
        return list
    }

    private fun saveDownloadItem(item: DownloadedFileItem) {
        val list = getSavedDownloads().toMutableList()
        list.add(0, item)
        val arr = JSONArray()
        for (d in list.take(60)) {
            val obj = JSONObject().apply {
                put("filename", d.filename)
                put("url", d.url)
                put("path", d.path)
                put("size", d.size)
                put("timestamp", d.timestamp)
            }
            arr.put(obj)
        }
        getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putString("saved_downloads_json", arr.toString())
            .apply()
    }

    private fun deleteDownloadItem(filename: String) {
        val list = getSavedDownloads().filter { it.filename != filename }
        val arr = JSONArray()
        for (d in list) {
            val obj = JSONObject().apply {
                put("filename", d.filename)
                put("url", d.url)
                put("path", d.path)
                put("size", d.size)
                put("timestamp", d.timestamp)
            }
            arr.put(obj)
        }
        getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putString("saved_downloads_json", arr.toString())
            .apply()
    }

    private fun clearDownloads() {
        getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putString("saved_downloads_json", "[]")
            .apply()
    }

    // 주소창 검색어 입출력
    private fun getSavedSearchQueries(): List<String> {
        val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val raw = prefs.getString("saved_search_queries_json", "[]") ?: "[]"
        val list = mutableListOf<String>()
        try {
            val arr = JSONArray(raw)
            for (i in 0 until arr.length()) {
                list.add(arr.getString(i))
            }
        } catch (e: Exception) {}
        return list
    }

    private fun saveSearchQuery(query: String) {
        if (query.isBlank() || query.startsWith("http://") || query.startsWith("https://")) return
        val list = getSavedSearchQueries().toMutableList()
        list.remove(query)
        list.add(0, query)
        val arr = JSONArray(list.take(30))
        getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putString("saved_search_queries_json", arr.toString())
            .apply()
    }

    private fun deleteSearchQuery(query: String) {
        val list = getSavedSearchQueries().filter { it != query }
        val arr = JSONArray(list)
        getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putString("saved_search_queries_json", arr.toString())
            .apply()
    }

    private fun clearSearchQueries() {
        getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putString("saved_search_queries_json", "[]")
            .apply()
    }

    // 검색 엔진 & 환경 설정
    private fun getSearchEngine(): String {
        return getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .getString("search_engine_pref", "google") ?: "google"
    }

    private fun setSearchEngine(engine: String) {
        getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putString("search_engine_pref", engine)
            .apply()
    }

    private fun isAdBlockEnabled(): Boolean {
        return getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .getBoolean("ad_block_enabled", true)
    }

    private fun setAdBlockEnabled(enabled: Boolean) {
        getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putBoolean("ad_block_enabled", enabled)
            .apply()
    }

    private fun getTextZoom(): Int {
        return getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .getInt("text_zoom_pref", 100)
    }

    private fun setTextZoom(zoom: Int) {
        getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putInt("text_zoom_pref", zoom)
            .apply()
    }

    private fun isMaterialYouEnabled(): Boolean {
        return getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .getBoolean("material_you_enabled", true)
    }

    private fun setMaterialYouEnabled(enabled: Boolean) {
        getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putBoolean("material_you_enabled", enabled)
            .apply()
    }

    private fun isColorFaviconsEnabled(): Boolean {
        return getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .getBoolean("use_color_favicons", true)
    }

    // 컬러풀 위젯 스타일 (v2.2.1)
    private fun isWidgetColorfulEnabled(): Boolean {
        return getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .getBoolean("widget_colorful", true)
    }

    private fun setWidgetColorfulEnabled(enabled: Boolean) {
        getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putBoolean("widget_colorful", enabled)
            .apply()
        for (t in tabs) {
            if (t.url == START_PAGE_URL) {
                t.webView.evaluateJavascript(
                    "if (window.setWidgetColorful) window.setWidgetColorful(" + enabled + ");",
                    null
                )
            }
        }
    }

    // 사용자 이름 설정
    fun getUserNickname(): String {
        return getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .getString("user_nickname", "민중") ?: "민중"
    }

    fun setUserNickname(name: String) {
        val validName = if (name.isBlank()) "민중" else name.trim()
        getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putString("user_nickname", validName)
            .apply()
        for (t in tabs) {
            t.webView.evaluateJavascript("if (window.setUserName) { window.setUserName('$validName'); }", null)
        }
    }

    // 시작 페이지 설정
    fun getStartPageType(): String {
        return getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .getString("start_page_type", "home") ?: "home"
    }

    fun getCustomStartPageUrl(): String {
        return getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .getString("start_page_custom_url", "") ?: ""
    }

    fun setStartPageSettings(type: String, customUrl: String) {
        getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putString("start_page_type", type)
            .putString("start_page_custom_url", customUrl)
            .apply()
    }

    fun getHomeUrl(isSecurity: Boolean = false): String {
        if (isSecurity) return START_PAGE_SECURITY_URL
        return when (getStartPageType()) {
            "naver" -> "https://www.naver.com"
            "google" -> "https://www.google.com"
            "custom" -> {
                val c = getCustomStartPageUrl()
                if (c.isNotBlank()) c else START_PAGE_URL
            }
            else -> START_PAGE_URL
        }
    }

    private fun isTouchAnimationEnabled(): Boolean {
        val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        return prefs.getBoolean("touch_animation_enabled", false)
    }

    // 어떤 버튼이든, 항목이든 누를 때의 바운스 애니메이션
    private fun applyTouchAnimation(v: View) {
        if (!isTouchAnimationEnabled()) {
            v.setOnTouchListener(null)
            return
        }
        v.setOnTouchListener { view, event ->
            when (event.action) {
                MotionEvent.ACTION_DOWN -> {
                    view.animate().scaleX(0.93f).scaleY(0.93f).alpha(0.85f).setDuration(80).start()
                }
                MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                    view.animate().scaleX(1.0f).scaleY(1.0f).alpha(1.0f).setDuration(100).start()
                }
            }
            false
        }
    }

    private fun applyTouchAnimationToAll(rootView: View) {
        if (!isTouchAnimationEnabled()) return
        if (rootView is ViewGroup) {
            for (i in 0 until rootView.childCount) {
                applyTouchAnimationToAll(rootView.getChildAt(i))
            }
        }
        if (rootView.isClickable || rootView is Button || rootView is ImageButton || rootView.id == R.id.btnNavTabs || rootView.id == R.id.btnNavCreamy) {
            rootView.setOnTouchListener { v, event ->
                when (event.action) {
                    MotionEvent.ACTION_DOWN -> {
                        v.animate().scaleX(0.93f).scaleY(0.93f).alpha(0.85f).setDuration(80).start()
                    }
                    MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                        v.animate().scaleX(1.0f).scaleY(1.0f).alpha(1.0f).setDuration(100).start()
                    }
                }
                false
            }
        }
    }

    // 첫 실행 온보딩 캐러셀 및 사용자 이름 설정
    private fun checkAndShowOnboarding() {
        val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val hasCompleted = prefs.getBoolean("has_completed_onboarding", false)
        val layoutOnboarding = findViewById<View>(R.id.layoutOnboarding) ?: return
        if (hasCompleted) {
            layoutOnboarding.visibility = View.GONE
            return
        }

        layoutOnboarding.visibility = View.VISIBLE
        val scrollOnboarding = findViewById<HorizontalScrollView>(R.id.scrollOnboarding)
        val btnSkip = findViewById<TextView>(R.id.btnOnboardingSkip)
        val btnNext = findViewById<Button>(R.id.btnOnboardingNext)
        val btnStart = findViewById<Button>(R.id.btnOnboardingStart)
        val etUserName = findViewById<EditText>(R.id.etOnboardingUserName)

        val dot1 = findViewById<View>(R.id.dot1)
        val dot2 = findViewById<View>(R.id.dot2)
        val dot3 = findViewById<View>(R.id.dot3)
        val dot4 = findViewById<View>(R.id.dot4)
        val dots = listOfNotNull(dot1, dot2, dot3, dot4)

        val screenWidth = resources.displayMetrics.widthPixels
        val slideIds = listOf(R.id.slide1, R.id.slide2, R.id.slide3, R.id.slide4)
        for (sid in slideIds) {
            findViewById<View>(sid)?.layoutParams = LinearLayout.LayoutParams(screenWidth, LinearLayout.LayoutParams.MATCH_PARENT)
        }

        fun updateDots(page: Int) {
            val dActiveWidth = (18 * resources.displayMetrics.density).toInt()
            val dInactiveWidth = (6 * resources.displayMetrics.density).toInt()
            val dHeight = (6 * resources.displayMetrics.density).toInt()
            val dMargin = (6 * resources.displayMetrics.density).toInt()

            for (i in dots.indices) {
                if (i == page) {
                    dots[i].setBackgroundResource(R.drawable.dot_active)
                    dots[i].layoutParams = LinearLayout.LayoutParams(dActiveWidth, dHeight).apply {
                        marginEnd = if (i < dots.size - 1) dMargin else 0
                    }
                } else {
                    dots[i].setBackgroundResource(R.drawable.dot_inactive)
                    dots[i].layoutParams = LinearLayout.LayoutParams(dInactiveWidth, dHeight).apply {
                        marginEnd = if (i < dots.size - 1) dMargin else 0
                    }
                }
            }
            if (page == 3) {
                btnNext?.visibility = View.GONE
            } else {
                btnNext?.visibility = View.VISIBLE
            }
        }

        var currentPage = 0
        updateDots(0)

        scrollOnboarding?.setOnScrollChangeListener { _: View?, scrollX: Int, _: Int, _: Int, _: Int ->
            val page = Math.round(scrollX.toFloat() / screenWidth).coerceIn(0, 3)
            if (page != currentPage) {
                currentPage = page
                updateDots(page)
            }
        }

        btnNext?.setOnClickListener {
            if (currentPage < 3) {
                currentPage++
                scrollOnboarding?.smoothScrollTo(currentPage * screenWidth, 0)
                updateDots(currentPage)
            }
        }

        fun finishOnboarding(name: String) {
            val nick = if (name.isBlank()) "민중" else name.trim()
            setUserNickname(nick)
            prefs.edit().putBoolean("has_completed_onboarding", true).apply()
            layoutOnboarding.animate().alpha(0f).setDuration(220).withEndAction {
                layoutOnboarding.visibility = View.GONE
            }.start()
        }

        btnSkip?.setOnClickListener {
            finishOnboarding("민중")
        }

        btnStart?.setOnClickListener {
            val name = etUserName?.text?.toString()?.trim() ?: ""
            finishOnboarding(name)
        }
    }

    private fun switchSidebarTab(tab: String) {
        currentSidebarTab = tab
        val palette = sidebarPalette(getAppThemeMode())
        btnTabAi.background = null
        btnTabAi.setTextColor(palette.textSecondary)
        btnTabBookmarks.background = null
        btnTabBookmarks.setTextColor(palette.textSecondary)
        btnTabMenu.background = null
        btnTabMenu.setTextColor(palette.textSecondary)
        btnTabSettings.background = null
        btnTabSettings.setTextColor(palette.textSecondary)

        layoutTabAiContent.visibility = View.GONE
        layoutTabBookmarksContent.visibility = View.GONE
        layoutTabMenuContent.visibility = View.GONE
        layoutTabSettingsContent.visibility = View.GONE
        layoutTabListContent.visibility = View.GONE

        fun highlight(target: TextView) {
            target.setBackgroundResource(R.drawable.bg_pill_badge)
            target.backgroundTintList = ColorStateList.valueOf(palette.accentBg)
            target.setTextColor(palette.accentFg)
        }

        when (tab) {
            "bookmarks" -> {
                highlight(btnTabBookmarks)
                layoutTabBookmarksContent.visibility = View.VISIBLE
            }
            "menu" -> {
                highlight(btnTabMenu)
                layoutTabMenuContent.visibility = View.VISIBLE
            }
            "settings" -> {
                highlight(btnTabSettings)
                layoutTabSettingsContent.visibility = View.VISIBLE
                renderSidebarSettingsPanel()
            }
            "list" -> {
                highlight(btnTabMenu)
                layoutTabListContent.visibility = View.VISIBLE
            }
            else -> {
                highlight(btnTabAi)
                layoutTabAiContent.visibility = View.VISIBLE
            }
        }
    }

    private fun toggleSidebar(tab: String = "ai") {
        val isOpening = layoutSidebar.visibility != View.VISIBLE
        if (isOpening) {
            layoutSidebar.visibility = View.VISIBLE
            layoutSidebar.alpha = 0f
            layoutSidebar.translationX = 140f
            layoutSidebar.animate()
                .translationX(0f)
                .alpha(1f)
                .setDuration(240)
                .setInterpolator(android.view.animation.DecelerateInterpolator())
                .start()
            isSidebarOpen = true
            switchSidebarTab(tab)
            extractPageTextForSidebar()
        } else {
            val isCurrentTabActive = when (tab) {
                "menu" -> layoutTabMenuContent.visibility == View.VISIBLE
                "bookmarks" -> layoutTabBookmarksContent.visibility == View.VISIBLE
                "settings" -> layoutTabSettingsContent.visibility == View.VISIBLE
                "list" -> layoutTabListContent.visibility == View.VISIBLE
                else -> layoutTabAiContent.visibility == View.VISIBLE
            }
            if (!isCurrentTabActive) {
                switchSidebarTab(tab)
                return
            }
            layoutSidebar.animate()
                .translationX(140f)
                .alpha(0f)
                .setDuration(180)
                .setInterpolator(android.view.animation.AccelerateInterpolator())
                .withEndAction {
                    layoutSidebar.visibility = View.GONE
                    layoutSidebar.translationX = 0f
                    layoutSidebar.alpha = 1f
                    isSidebarOpen = false
                }
                .start()
        }
    }

    private fun setupSidebarControls() {
        btnCloseSidebar.setOnClickListener {
            toggleSidebar()
        }

        btnTabAi.setOnClickListener {
            switchSidebarTab("ai")
        }

        btnTabBookmarks.setOnClickListener {
            switchSidebarTab("bookmarks")
            populateSidebarBookmarks()
        }

        btnTabMenu.setOnClickListener {
            switchSidebarTab("menu")
        }

        btnTabSettings.setOnClickListener {
            switchSidebarTab("settings")
            renderSidebarSettingsPanel()
        }

        btnSidebarTopNewTab.setOnClickListener { addNewTab() }
        btnSidebarTopSplit.setOnClickListener { showSplitViewDialog() }

        findViewById<ImageView>(R.id.btnCanvasClose)?.setOnClickListener { closeResearchCanvas() }
        findViewById<Button>(R.id.btnCanvasAddMemo)?.setOnClickListener { addMemoToCanvas() }
        findViewById<Button>(R.id.btnCanvasAddBag)?.setOnClickListener { addBagCardsToCanvas() }
        findViewById<Button>(R.id.btnCanvasLinkMode)?.setOnClickListener {
            canvasView?.let { view ->
                val enabled = !view.linkModeActive()
                view.setLinkMode(enabled)
                Toast.makeText(
                    this,
                    if (enabled) "연결 모드: 카드 두 장을 차례로 누르면 선이 그려집니다" else "연결 모드를 종료했습니다",
                    Toast.LENGTH_SHORT
                ).show()
            }
        }
        btnSidebarListBack.setOnClickListener {
            sidebarListType = "bag"
            switchSidebarTab("menu")
        }
        btnSidebarListAction.setOnClickListener { renderSidebarList() }

        // 사이드바 메뉴 패널의 모든 기능 연결
        findViewById<Button>(R.id.btnSidebarQuickNewTab)?.setOnClickListener { addNewTab() }
        findViewById<Button>(R.id.btnSidebarQuickReload)?.setOnClickListener { getCurrentWebView().reload() }
        findViewById<Button>(R.id.btnSidebarQuickShare)?.setOnClickListener { shareCurrentPage() }
        findViewById<Button>(R.id.btnSidebarQuickBookmark)?.setOnClickListener {
            val cur = getCurrentWebView()
            saveCustomBookmark(cur.title ?: "페이지", cur.url ?: START_PAGE_URL, "기본")
            Toast.makeText(this, "북마크에 저장되었습니다.", Toast.LENGTH_SHORT).show()
        }

        findViewById<TextView>(R.id.btnSidebarMenuBag)?.setOnClickListener { openSidebarList("bag") }
        findViewById<TextView>(R.id.btnSidebarMenuDownloads)?.setOnClickListener { openSidebarList("downloads") }
        findViewById<TextView>(R.id.btnSidebarMenuHistory)?.setOnClickListener { openSidebarList("history") }
        findViewById<TextView>(R.id.btnSidebarMenuSecurity)?.setOnClickListener { openSidebarList("security") }
        findViewById<TextView>(R.id.btnSidebarMenuFind)?.setOnClickListener { showFindInPageDialog() }
        findViewById<TextView>(R.id.btnSidebarMenuReader)?.setOnClickListener { showReaderModeDialog() }
        findViewById<TextView>(R.id.btnSidebarMenuTranslate)?.setOnClickListener { togglePageTranslation() }
        findViewById<TextView>(R.id.btnSidebarMenuDesktop)?.setOnClickListener { toggleDesktopMode() }
        findViewById<TextView>(R.id.btnSidebarMenuPrint)?.setOnClickListener { printCurrentPage() }
        findViewById<TextView>(R.id.btnSidebarMenuSavePdf)?.setOnClickListener { saveWebPageAsPdf() }
        findViewById<TextView>(R.id.btnSidebarMenuQrCode)?.setOnClickListener { showQrCodeDialog() }
        findViewById<TextView>(R.id.btnSidebarMenuCapture)?.setOnClickListener { captureFullPageScreenshot() }
        findViewById<TextView>(R.id.btnSidebarMenuMacro)?.setOnClickListener { openSidebarList("macro") }
        findViewById<TextView>(R.id.btnSidebarMenuCanvas)?.setOnClickListener { openResearchCanvas() }
        findViewById<TextView>(R.id.btnSidebarMenuSplit)?.setOnClickListener { showSplitViewDialog() }
        findViewById<TextView>(R.id.btnSidebarMenuSettings)?.setOnClickListener { showSettingsDialog() }

        btnSidebarQuickSummary.setOnClickListener {
            val currentWv = getCurrentWebView()
            val title = currentWv.title ?: "현재 페이지"
            tvSidebarAiResult.text = "Creamy가 페이지 핵심을 분석 중입니다...\n\n제목: $title\n\n1. 이 페이지의 주요 흐름과 핵심 데이터를 분석했습니다.\n2. 전체 본문 중 중요 요점과 맥락을 파악했습니다.\n3. 상세한 심층 질문은 아래 입력창에 남겨주세요."
        }

        btnSidebarQuickQuestions.setOnClickListener {
            tvSidebarAiResult.text = "이 페이지 추천 질문:\n\n1. '이 글의 핵심 결론이 뭐야?'\n2. '주요 장단점 정리해줘'\n3. '관련된 최신 트렌드는?'"
        }

        btnSidebarQuickTranslate.setOnClickListener {
            togglePageTranslation()
        }

        btnSidebarSend.setOnClickListener {
            val q = etSidebarQuery.text.toString().trim()
            if (q.isNotEmpty()) {
                val currentWv = getCurrentWebView()
                val currentTitle = currentWv.title ?: "현재 페이지"
                tvSidebarAiResult.text = "질문: $q\n\n답변: [$currentTitle] 페이지의 맥락을 고려하여 Creamy가 신속하게 분석했습니다. 원본 웹페이지를 실시간으로 참조하며 최적의 답변을 생성 중입니다."
                etSidebarQuery.setText("")
                hideKeyboard(etSidebarQuery)
            }
        }
    }

    private fun showCreamyBottomSheet(initialQuery: String? = null) {
        val dialog = createConfiguredBottomSheetDialog()
        val view = layoutInflater.inflate(R.layout.dialog_summary_bottom_sheet, null)
        dialog.setContentView(view)
        applyTouchAnimationToAll(view)

        val tvSheetTitle = view.findViewById<TextView>(R.id.tvSheetTitle)
        val tvEngineStatus = view.findViewById<TextView>(R.id.tvEngineStatus)
        val tvSharedUrl = view.findViewById<TextView>(R.id.tvSharedUrl)
        val btnOpenWebChat = view.findViewById<TextView>(R.id.btnOpenWebChat)
        val btnCloseSheet = view.findViewById<ImageView>(R.id.btnCloseSheet)
        val tvSummaryResult = view.findViewById<TextView>(R.id.tvSummaryResult)
        val etSheetQuery = view.findViewById<EditText>(R.id.etSheetQuery)
        val btnSheetSend = view.findViewById<Button>(R.id.btnSheetSend)
        val btnQuickSummary = view.findViewById<Button>(R.id.btnQuickSummary)
        val btnQuickQuestions = view.findViewById<Button>(R.id.btnQuickQuestions)
        val btnQuickTranslate = view.findViewById<Button>(R.id.btnQuickTranslate)
        val btnLoadHistory = view.findViewById<Button>(R.id.btnLoadHistory)

        val currentTab = getCurrentTab()
        val currentTitle = currentTab.webView.title ?: "현재 페이지"
        val currentUrl = currentTab.webView.url ?: START_PAGE_URL

        if (!initialQuery.isNullOrBlank()) {
            etSheetQuery.setText(initialQuery)
            tvSummaryResult.text = "질문: $initialQuery\n\nCreamy 답변: [$currentTitle] 페이지에서 선택한 내용을 바탕으로 분석을 진행 중입니다."
        }

        tvSheetTitle.text = "Creamy AI"
        tvEngineStatus.text = "인텔리전트 웹 어시스턴트"
        tvSharedUrl.text = if (currentUrl == START_PAGE_URL || currentUrl == START_PAGE_SECURITY_URL) "Cream Browser 시작 페이지" else "$currentTitle · $currentUrl"

        btnOpenWebChat.setOnClickListener {
            dialog.dismiss()
            loadWebQuery(CREAMY_URL)
        }

        btnCloseSheet.setOnClickListener { dialog.dismiss() }

        btnQuickSummary.setOnClickListener {
            tvSummaryResult.text = "Creamy가 페이지 핵심을 분석 중입니다...\n\n제목: $currentTitle\n\n1. 웹페이지의 본문 핵심 정보와 주요 맥락을 파악했습니다.\n2. 중요 데이터와 세부 결론을 3줄로 간결히 정리했습니다.\n3. 상세한 질문이나 추가 조사가 필요하시면 아래에 질문을 남겨주세요."
        }

        btnQuickQuestions.setOnClickListener {
            tvSummaryResult.text = "이 페이지 추천 질문:\n\n1. '이 글의 핵심 내용 3가지만 뽑아줘'\n2. '주요 장단점과 시사점은 뭐야?'\n3. '관련된 최신 트렌드 알려줘'"
        }

        btnQuickTranslate.setOnClickListener {
            dialog.dismiss()
            togglePageTranslation()
        }

        btnLoadHistory.setOnClickListener {
            tvSummaryResult.text = "Creamy 대화 기록과 연동 중입니다."
        }

        btnSheetSend.setOnClickListener {
            val q = etSheetQuery.text.toString().trim()
            if (q.isNotEmpty()) {
                tvSummaryResult.text = "질문: $q\n\nCreamy 답변: [$currentTitle] 페이지의 맥락을 고려하여 신속하게 분석했습니다. 필요한 추가 정보나 작업이 있으시면 언제든 말씀해주세요!"
                etSheetQuery.setText("")
                hideKeyboard(etSheetQuery)
            }
        }

        dialog.show()
    }

    private fun extractPageTextForSidebar() {
        val currentWv = getCurrentWebView()
        val currentUrl = currentWv.url ?: START_PAGE_URL
        val currentTitle = currentWv.title ?: "Cream Browser"

        tvSidebarPageTitle.text = currentTitle
        tvSidebarPageUrl.text = currentUrl

        currentWv.evaluateJavascript("(function() { return (document.body.innerText || '').slice(0, 2000); })();") { rawText ->
            currentPageText = if (rawText.isNullOrBlank()) "" else {
                try {
                    org.json.JSONTokener(rawText).nextValue().toString()
                } catch (e: Exception) { rawText ?: "" }
            }
        }
    }

    fun loadWebQuery(query: String) {
        val urlToLoad = if (query.startsWith("http://") || query.startsWith("https://") || query.startsWith("file://")) {
            query
        } else if (query.contains(".") && !query.contains(" ") && !query.startsWith("?")) {
            "https://$query"
        } else {
            val encoded = URLEncoder.encode(query, "UTF-8")
            when (getSearchEngine()) {
                "naver" -> "https://search.naver.com/search.naver?query=$encoded"
                "daum" -> "https://search.daum.net/search?q=$encoded"
                "bing" -> "https://www.bing.com/search?q=$encoded"
                "duckduckgo" -> "https://duckduckgo.com/?q=$encoded"
                else -> "https://www.google.com/search?q=$encoded"
            }
        }
        getCurrentWebView().loadUrl(urlToLoad)
        etBrowserUrl.clearFocus()
        hideKeyboard(etBrowserUrl)
        hideSearchSuggestions()
    }

    private fun updateBrowserBar(url: String?) {
        url ?: return
        val curTab = getCurrentTab()
        updateDesktopMenuLabels()

        if (!etBrowserUrl.hasFocus()) {
            val displayText = when {
                url == START_PAGE_URL || url == START_PAGE_SECURITY_URL || url.startsWith("file:///android_asset/") -> ""
                url == BASE_URL || url == "$BASE_URL/" -> "Creamy Hub"
                url.startsWith(CREAMY_URL) -> "Creamy AI 채팅"
                else -> {
                    try {
                        val host = Uri.parse(url).host
                        if (!host.isNullOrBlank()) host else url
                    } catch (e: Exception) {
                        url
                    }
                }
            }
            etBrowserUrl.setText(displayText)
            if (url == START_PAGE_URL || url == START_PAGE_SECURITY_URL || url.startsWith("file:///android_asset/")) {
                etBrowserUrl.hint = if (curTab.isSecurity) "보안 검색어 또는 웹 주소 입력..." else "웹 주소 또는 검색어 입력..."
            }
        }

        // 아이콘 보안 현황 업데이트
        if (curTab.isSecurity) {
            ivUrlIcon.setImageResource(R.drawable.ic_shield)
            ivUrlIcon.imageTintList = ColorStateList.valueOf(Color.parseColor("#818CF8"))
        } else if (url.startsWith("https://")) {
            ivUrlIcon.setImageResource(R.drawable.ic_lock)
            ivUrlIcon.imageTintList = ColorStateList.valueOf(Color.parseColor("#10B981"))
        } else if (url.startsWith("http://")) {
            ivUrlIcon.setImageResource(R.drawable.ic_warning)
            ivUrlIcon.imageTintList = ColorStateList.valueOf(Color.parseColor("#EF4444"))
        } else {
            ivUrlIcon.setImageResource(R.drawable.ic_search)
            ivUrlIcon.imageTintList = ColorStateList.valueOf(getColor(R.color.text_muted))
        }

        val currentWv = getCurrentWebView()
        btnNavBack.alpha = if (currentWv.canGoBack()) 1.0f else 0.35f
        btnNavForward.alpha = if (currentWv.canGoForward()) 1.0f else 0.35f
        btnTopBack.alpha = if (currentWv.canGoBack()) 1.0f else 0.35f
        btnTopForward.alpha = if (currentWv.canGoForward()) 1.0f else 0.35f

        val isStart = url == START_PAGE_URL || url == START_PAGE_SECURITY_URL || url.startsWith("file:///android_asset/")
        if (!isStart && !url.isNullOrBlank()) {
            btnQuickTranslateChip.visibility = View.VISIBLE
            tvTranslateChipText.text = if (curTab.isTranslated) "원문" else "번역"
        } else {
            btnQuickTranslateChip.visibility = View.GONE
        }
    }

    private fun hideKeyboard(view: View) {
        val imm = getSystemService(Context.INPUT_METHOD_SERVICE) as? InputMethodManager
        imm?.hideSoftInputFromWindow(view.windowToken, 0)
    }

    fun updateBase44Token(token: String) {
        val cleanToken = token.trim().trim('"').replace('"'.toString(), "")
        if (cleanToken.isNotBlank() && cleanToken != "null") {
            getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                .edit()
                .putString(KEY_BASE44_TOKEN, cleanToken)
                .apply()
        }
    }

    private fun handleIncomingIntent(intent: Intent) {
        if (intent.action == Intent.ACTION_VIEW && intent.data != null) {
            val targetUrl = intent.data.toString()
            loadWebQuery(targetUrl)
            return
        }

        if (intent.action == Intent.ACTION_SEND && intent.type == "text/plain") {
            val sharedText = intent.getStringExtra(Intent.EXTRA_TEXT)
            if (!sharedText.isNullOrBlank()) {
                loadWebQuery(sharedText)
                return
            }
        }
    }

    private fun checkClipboardOnResume() {
        try {
            val clipboard = getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager ?: return
            val clip = clipboard.primaryClip
            if (clip != null && clip.itemCount > 0) {
                val text = clip.getItemAt(0).text?.toString()?.trim() ?: ""
                if (text.isNotBlank() && text != lastHandledText && text.length > 2) {
                    lastHandledText = text
                    updateClipboardNotification(text)
                }
            }
        } catch (e: Exception) {}
    }

    private fun showPersistentQuickNotification() {
        val channelId = "cream_browser_quick_channel"
        val notificationManager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                channelId,
                "Cream Browser 빠른 실행",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "알림창에서 Cream Browser를 바로 실행합니다"
            }
            notificationManager.createNotificationChannel(channel)
        }

        val launchIntent = Intent(this, MainActivity::class.java).apply {
            action = Intent.ACTION_VIEW
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
        }

        val pendingIntent = PendingIntent.getActivity(
            this,
            100,
            launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val notification = NotificationCompat.Builder(this, channelId)
            .setSmallIcon(R.drawable.ic_stat_cream)
            .setContentTitle("Cream Browser")
            .setContentText("터치하여 스마트 AI 브라우저 시작")
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()

        notificationManager.notify(100, notification)
    }

    private fun updateClipboardNotification(text: String) {
        val channelId = "cream_browser_quick_channel"
        val notificationManager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

        val launchIntent = Intent(this, MainActivity::class.java).apply {
            action = Intent.ACTION_VIEW
            putExtra(Intent.EXTRA_TEXT, text)
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
        }

        val pendingIntent = PendingIntent.getActivity(
            this,
            101,
            launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val snippet = text.take(35).replace("\n", " ")
        val notification = NotificationCompat.Builder(this, channelId)
            .setSmallIcon(R.drawable.ic_stat_cream)
            .setContentTitle("Cream Browser: 복사한 내용")
            .setContentText(snippet + " 검색하기")
            .setContentIntent(pendingIntent)
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .build()

        notificationManager.notify(101, notification)
    }

    override fun onResume() {
        super.onResume()
        isAppInForeground = true
        getCurrentWebView().resumeTimers()
        for (tab in tabs) {
            if (!tab.isInactive) tab.webView.onResume()
        }
        checkClipboardOnResume()
        updateDesktopMenuLabels()
    }

    override fun onPause() {
        super.onPause()
        isAppInForeground = false
        saveTabsToPrefs()
        // 백그라운드 미디어 재생이 꾀져 있으면 웹뷰 오디오를 멈준다
        if (!isBackgroundAudioEnabled()) {
            for (tab in tabs) {
                tab.webView.onPause()
            }
            getCurrentWebView().pauseTimers()
        }
    }

    override fun onNewIntent(intent: Intent?) {
        super.onNewIntent(intent)
        setIntent(intent)
        intent?.let { handleIncomingIntent(it) }
    }

    private fun requestNotificationPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                requestPermissions(arrayOf(android.Manifest.permission.POST_NOTIFICATIONS), 101)
            }
        }
    }

    override fun onBackPressed() {
        if (::layoutResearchCanvas.isInitialized && layoutResearchCanvas.visibility == View.VISIBLE) {
            closeResearchCanvas()
            return
        }

        if (customView != null) {
            customView?.let { rootLayout.removeView(it) }
            customView = null
            customViewCallback?.onCustomViewHidden()
            customViewCallback = null
            layoutTopBar.visibility = View.VISIBLE
            if (!isTabletLayout()) layoutBottomBar.visibility = View.VISIBLE
            return
        }

        if (layoutSearchSuggestions.visibility == View.VISIBLE) {
            hideSearchSuggestions()
            etBrowserUrl.clearFocus()
            return
        }

        if (isSidebarOpen) {
            layoutSidebar.visibility = View.GONE
            isSidebarOpen = false
            return
        }

        val currentWv = getCurrentWebView()
        if (currentWv.canGoBack()) {
            currentWv.goBack()
        } else if (currentWv.url != START_PAGE_URL && currentWv.url != START_PAGE_SECURITY_URL && !currentWv.url.isNullOrBlank()) {
            val cur = getCurrentTab()
            currentWv.loadUrl(if (cur.isSecurity) START_PAGE_SECURITY_URL else START_PAGE_URL)
        } else if (tabs.size > 1) {
            closeTab(activeTabIndex)
        } else {
            super.onBackPressed()
        }
    }


    private fun isTabletLayout(): Boolean {
        return resources.configuration.screenWidthDp >= 600 || resources.configuration.smallestScreenWidthDp >= 600
    }

    // ---------- 커스텀 테마 (사용자 지정 색상 + 라이트/다크) ----------
    private fun getCustomAccentHex(): String {
        return getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .getString("custom_theme_accent", "#3B82F6") ?: "#3B82F6"
    }

    private fun getCustomAccentColor(): Int {
        return try {
            Color.parseColor(getCustomAccentHex())
        } catch (e: Exception) {
            Color.parseColor("#3B82F6")
        }
    }

    private fun isCustomDarkMode(): Boolean {
        return getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .getBoolean("custom_theme_is_dark", true)
    }

    private fun isCustomThemeActive(): Boolean = getAppThemeMode().startsWith("theme-custom")

    private fun mixColor(base: Int, target: Int, amount: Float): Int {
        val a = minOf(1f, maxOf(0f, amount))
        val r = (Color.red(target) * a + Color.red(base) * (1f - a)).roundToInt()
        val g = (Color.green(target) * a + Color.green(base) * (1f - a)).roundToInt()
        val b = (Color.blue(target) * a + Color.blue(base) * (1f - a)).roundToInt()
        return Color.rgb(r, g, b)
    }

    private fun contrastOn(color: Int): Int {
        return if (Color.luminance(color) > 0.55f) Color.parseColor("#111111") else Color.WHITE
    }

    private fun setCustomTheme(accentHex: String, isDark: Boolean) {
        val mode = if (isDark) "theme-custom-dark" else "theme-custom-light"
        getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putString("custom_theme_accent", accentHex)
            .putBoolean("custom_theme_is_dark", isDark)
            .putString("creamy_theme_mode", mode)
            .apply()
        applyThemeToViews(mode)
        syncStartPageTheme()
    }

    private fun applyCustomThemeToViews(isDark: Boolean) {
        val accent = getCustomAccentColor()
        val onAccent = contrastOn(accent)
        val topBg = if (isDark) mixColor(accent, Color.BLACK, 0.87f) else mixColor(accent, Color.WHITE, 0.80f)
        val addressBg = if (isDark) mixColor(accent, Color.BLACK, 0.74f) else Color.WHITE
        val textColor = if (isDark) Color.WHITE else Color.parseColor("#111111")
        val hintColor = if (isDark) mixColor(accent, Color.WHITE, 0.45f) else Color.parseColor("#666666")
        val chipBg = if (isDark) mixColor(accent, Color.BLACK, 0.68f) else mixColor(accent, Color.WHITE, 0.86f)
        val barBg = if (isDark) topBg else Color.WHITE

        layoutTopBar.backgroundTintList = glassTint(topBg)
        layoutAddressBar.backgroundTintList = glassTint(omniboxTint(addressBg), 226)
        etBrowserUrl.setTextColor(textColor)
        etBrowserUrl.setHintTextColor(hintColor)
        for (icon in intArrayOf(
            R.id.ivUrlIcon, R.id.btnTopBack, R.id.btnTopForward, R.id.btnTopReload,
            R.id.btnTopHome, R.id.btnTopMenu, R.id.btnMobileReload
        )) {
            (findViewById<View>(icon) as? ImageView)?.imageTintList = ColorStateList.valueOf(textColor)
        }
        layoutBottomBar.backgroundTintList = glassTint(barBg)
        for (icon in intArrayOf(R.id.btnNavBack, R.id.btnNavForward, R.id.btnNavHome)) {
            (findViewById<View>(icon) as? ImageView)?.imageTintList = ColorStateList.valueOf(textColor)
        }
        tvNavTabCount.setBackgroundResource(if (isDark) R.drawable.bg_tab_counter_dark else R.drawable.bg_tab_counter_light)
        tvNavTabCount.setTextColor(textColor)

        btnQuickTranslateChip.backgroundTintList = ColorStateList.valueOf(chipBg)
        ivTranslateChipIcon.imageTintList = ColorStateList.valueOf(textColor)
        tvTranslateChipText.setTextColor(textColor)
        layoutTranslateProgress.setBackgroundColor(addressBg)
        tvTranslateStatus.setTextColor(textColor)
        pbTranslateSpinner.indeterminateTintList = ColorStateList.valueOf(textColor)
        btnCloseTranslateProgress.imageTintList = ColorStateList.valueOf(hintColor)
        layoutSidebar.setBackgroundColor(if (isDark) mixColor(accent, Color.BLACK, 0.92f) else mixColor(accent, Color.WHITE, 0.95f))
        rootLayout.setBackgroundColor(if (isDark) mixColor(accent, Color.BLACK, 0.95f) else mixColor(accent, Color.WHITE, 0.93f))
        layoutSearchSuggestions.setBackgroundColor(if (isDark) mixColor(accent, Color.BLACK, 0.85f) else Color.WHITE)

        progressBar.progressTintList = ColorStateList.valueOf(accent)
        tvTopSecurityBadge.backgroundTintList = ColorStateList.valueOf(accent)
        tvTopSecurityBadge.setTextColor(onAccent)
    }

    private fun syncStartPageTheme() {
        val theme = getAppThemeMode()
        val script = if (theme.startsWith("theme-custom")) {
            "if (window.setCustomTheme) { window.setCustomTheme('${getCustomAccentHex()}', ${if (theme.endsWith("-dark")) "true" else "false"}); }"
        } else {
            "if (window.setTheme) { window.setTheme('$theme'); }"
        }
        for (tab in tabs) {
            val current = tab.webView.url
            if (current == START_PAGE_URL) {
                tab.webView.evaluateJavascript(script, null)
            }
        }
    }

    private fun buildAccentChip(hex: String, label: String, selected: Boolean, onPick: () -> Unit): LinearLayout {
        val accent = try { Color.parseColor(hex) } catch (e: Exception) { Color.BLACK }
        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = android.view.Gravity.CENTER_VERTICAL
            setPadding(dpToPx(8), dpToPx(6), dpToPx(10), dpToPx(6))
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply { marginEnd = dpToPx(6) }
            setBackgroundResource(R.drawable.bg_pill_badge)
            backgroundTintList = ColorStateList.valueOf(if (selected) mixColor(accent, Color.WHITE, 0.75f) else Color.parseColor("#F4F4F5"))
            isClickable = true
            isFocusable = true
            setOnClickListener { onPick() }
        }
        val dot = View(this).apply {
            layoutParams = LinearLayout.LayoutParams(dpToPx(16), dpToPx(16)).apply { marginEnd = dpToPx(6) }
            setBackgroundResource(R.drawable.bg_tab_counter)
            backgroundTintList = ColorStateList.valueOf(accent)
        }
        val text = TextView(this).apply {
            this.text = label
            textSize = 11.5f
            setTextColor(Color.parseColor("#111111"))
            setTypeface(null, if (selected) android.graphics.Typeface.BOLD else android.graphics.Typeface.NORMAL)
        }
        row.addView(dot)
        row.addView(text)
        return row
    }

    // ---------- 번역 언어 설정 ----------
    private fun getTranslateLang(): String {
        return getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .getString("translate_target_lang", "ko") ?: "ko"
    }

    private fun setTranslateLang(code: String) {
        getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putString("translate_target_lang", code)
            .apply()
    }

    private fun translateLangLabel(): String {
        val code = getTranslateLang()
        return translateLanguages.firstOrNull { it.code == code }?.label ?: "한국어"
    }

    private fun isAutoTranslateEnabled(): Boolean {
        return getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .getBoolean("auto_translate_enabled", false)
    }

    private fun setAutoTranslateEnabled(enabled: Boolean) {
        getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putBoolean("auto_translate_enabled", enabled)
            .apply()
    }

    private fun showTranslateLanguagePicker() {
        val labels = translateLanguages.map { it.label }.toTypedArray()
        val currentIndex = translateLanguages.indexOfFirst { it.code == getTranslateLang() }.coerceAtLeast(0)
        AlertDialog.Builder(this)
            .setTitle("번역할 언어 선택")
            .setSingleChoiceItems(labels, currentIndex) { d, which ->
                setTranslateLang(translateLanguages[which].code)
                tvTranslateChipText.text = if (getCurrentTab().isTranslated) "원문" else "번역"
                Toast.makeText(this, translateLanguages[which].label + "로 번역합니다", Toast.LENGTH_SHORT).show()
                d.dismiss()
            }
            .setNegativeButton("닫기", null)
            .show()
    }

    // ---------- 시작페이지 커스텀 배경 이미지 ----------
    private fun customStartBgFile(): File = File(filesDir, "custom_start_bg.jpg")

    private fun hasCustomStartBackground(): Boolean {
        val f = customStartBgFile()
        return f.exists() && f.length() > 0L
    }

    private fun pickCustomBackgroundImage() {
        try {
            backgroundImageLauncher.launch("image/*")
        } catch (e: Exception) {
            Toast.makeText(this, "갤러리를 열 수 없습니다", Toast.LENGTH_SHORT).show()
        }
    }

    private fun handlePickedBackgroundImage(uri: Uri?) {
        if (uri == null) return
        Thread {
            var ok = false
            try {
                val input = contentResolver.openInputStream(uri)
                val decoded = if (input != null) BitmapFactory.decodeStream(input) else null
                input?.close()
                if (decoded != null) {
                    val maxDim = 1600
                    val longest = maxOf(decoded.width, decoded.height)
                    val scaled = if (longest > maxDim) {
                        val ratio = maxDim.toFloat() / longest.toFloat()
                        Bitmap.createScaledBitmap(
                            decoded,
                            (decoded.width * ratio).roundToInt().coerceAtLeast(1),
                            (decoded.height * ratio).roundToInt().coerceAtLeast(1),
                            true
                        )
                    } else decoded
                    FileOutputStream(customStartBgFile()).use { out ->
                        scaled.compress(Bitmap.CompressFormat.JPEG, 88, out)
                    }
                    if (scaled !== decoded) decoded.recycle()
                    ok = true
                }
            } catch (e: Exception) {
                ok = false
            }
            runOnUiThread {
                if (ok) {
                    customBgDataUrlCache = null
                    applyCustomStartBackgroundToStartPages()
                    Toast.makeText(this, "시작페이지 배경 이미지가 적용되었습니다", Toast.LENGTH_SHORT).show()
                } else {
                    Toast.makeText(this, "이미지를 불러오지 못했습니다", Toast.LENGTH_SHORT).show()
                }
            }
        }.start()
    }

    private fun clearCustomStartBackground() {
        try {
            customStartBgFile().delete()
        } catch (e: Exception) {}
        customBgDataUrlCache = null
        for (tab in tabs) {
            if (tab.webView.url == START_PAGE_URL) {
                tab.webView.evaluateJavascript("if (window.clearCustomBackground) window.clearCustomBackground();", null)
            }
        }
    }

    private fun customBackgroundDataUrl(): String? {
        customBgDataUrlCache?.let { return it }
        if (!hasCustomStartBackground()) return null
        return try {
            val bytes = customStartBgFile().readBytes()
            val encoded = Base64.encodeToString(bytes, Base64.NO_WRAP)
            val url = "data:image/jpeg;base64," + encoded
            customBgDataUrlCache = url
            url
        } catch (e: Exception) {
            null
        }
    }

    private fun applyCustomStartBackgroundToStartPages() {
        val dataUrl = customBackgroundDataUrl()
        for (tab in tabs) {
            if (tab.webView.url == START_PAGE_URL) {
                injectCustomStartBackground(tab.webView, dataUrl)
            }
        }
    }

    private fun injectCustomStartBackground(wv: WebView, dataUrl: String?) {
        if (dataUrl == null) {
            wv.evaluateJavascript("if (window.clearCustomBackground) window.clearCustomBackground();", null)
        } else {
            wv.evaluateJavascript(
                "if (window.setCustomBackground) window.setCustomBackground('" + dataUrl + "');",
                null
            )
        }
    }

    private fun getAppThemeMode(): String {
        return getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .getString("creamy_theme_mode", "theme-default-dark") ?: "theme-default-dark"
    }

    fun setAppThemeMode(theme: String) {
        val target = if (theme.startsWith("theme-")) theme else "theme-" + theme.replace("_", "-")
        getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putString("creamy_theme_mode", target)
            .apply()
        applyThemeToViews(target)
        syncStartPageTheme()
    }

    private fun applyThemeToViews(theme: String) {
        if (theme.startsWith("theme-custom")) {
            applyCustomThemeToViews(theme.endsWith("-dark"))
        } else when (theme) {
            "theme-default-dark" -> {
                layoutTopBar.backgroundTintList = glassTint(Color.parseColor("#000000"))
                layoutAddressBar.backgroundTintList = glassTint(omniboxTint(Color.parseColor("#16191E")), 226)
                etBrowserUrl.setTextColor(Color.WHITE)
                etBrowserUrl.setHintTextColor(Color.parseColor("#767C88"))
                ivUrlIcon.imageTintList = ColorStateList.valueOf(Color.WHITE)
                btnTopBack.imageTintList = ColorStateList.valueOf(Color.WHITE)
                btnTopForward.imageTintList = ColorStateList.valueOf(Color.WHITE)
                btnTopReload.imageTintList = ColorStateList.valueOf(Color.WHITE)
                btnTopHome.imageTintList = ColorStateList.valueOf(Color.WHITE)
                btnTopMenu.imageTintList = ColorStateList.valueOf(Color.WHITE)
                btnMobileReload.imageTintList = ColorStateList.valueOf(Color.WHITE)
                layoutBottomBar.backgroundTintList = glassTint(Color.parseColor("#000000"))
                btnNavBack.imageTintList = ColorStateList.valueOf(Color.WHITE)
                btnNavForward.imageTintList = ColorStateList.valueOf(Color.WHITE)
                btnNavHome.imageTintList = ColorStateList.valueOf(Color.WHITE)
                tvNavTabCount.setBackgroundResource(R.drawable.bg_tab_counter_dark)
                tvNavTabCount.setTextColor(Color.WHITE)
                btnQuickTranslateChip.backgroundTintList = ColorStateList.valueOf(Color.parseColor("#262930"))
                ivTranslateChipIcon.imageTintList = ColorStateList.valueOf(Color.WHITE)
                tvTranslateChipText.setTextColor(Color.WHITE)
                layoutTranslateProgress.setBackgroundColor(Color.parseColor("#16191E"))
                tvTranslateStatus.setTextColor(Color.WHITE)
                pbTranslateSpinner.indeterminateTintList = ColorStateList.valueOf(Color.WHITE)
                btnCloseTranslateProgress.imageTintList = ColorStateList.valueOf(Color.parseColor("#A1A1AA"))
                layoutSidebar.setBackgroundColor(Color.parseColor("#121418"))
            }
            "theme-default-light" -> {
                layoutTopBar.backgroundTintList = glassTint(Color.parseColor("#E5E7EB"))
                layoutAddressBar.backgroundTintList = glassTint(omniboxTint(Color.parseColor("#FFFFFF")), 226)
                etBrowserUrl.setTextColor(Color.parseColor("#111111"))
                etBrowserUrl.setHintTextColor(Color.parseColor("#666666"))
                ivUrlIcon.imageTintList = ColorStateList.valueOf(Color.parseColor("#111111"))
                btnTopBack.imageTintList = ColorStateList.valueOf(Color.parseColor("#111111"))
                btnTopForward.imageTintList = ColorStateList.valueOf(Color.parseColor("#111111"))
                btnTopReload.imageTintList = ColorStateList.valueOf(Color.parseColor("#111111"))
                btnTopHome.imageTintList = ColorStateList.valueOf(Color.parseColor("#111111"))
                btnTopMenu.imageTintList = ColorStateList.valueOf(Color.parseColor("#111111"))
                btnMobileReload.imageTintList = ColorStateList.valueOf(Color.parseColor("#111111"))
                layoutBottomBar.backgroundTintList = glassTint(Color.parseColor("#FFFFFF"))
                btnNavBack.imageTintList = ColorStateList.valueOf(Color.parseColor("#111111"))
                btnNavForward.imageTintList = ColorStateList.valueOf(Color.parseColor("#111111"))
                btnNavHome.imageTintList = ColorStateList.valueOf(Color.parseColor("#111111"))
                tvNavTabCount.setBackgroundResource(R.drawable.bg_tab_counter_light)
                tvNavTabCount.setTextColor(Color.parseColor("#111111"))
                btnQuickTranslateChip.backgroundTintList = ColorStateList.valueOf(Color.parseColor("#E5E7EB"))
                ivTranslateChipIcon.imageTintList = ColorStateList.valueOf(Color.parseColor("#111111"))
                tvTranslateChipText.setTextColor(Color.parseColor("#111111"))
                layoutTranslateProgress.setBackgroundColor(Color.WHITE)
                tvTranslateStatus.setTextColor(Color.parseColor("#111111"))
                pbTranslateSpinner.indeterminateTintList = ColorStateList.valueOf(Color.parseColor("#111111"))
                btnCloseTranslateProgress.imageTintList = ColorStateList.valueOf(Color.parseColor("#71717A"))
                layoutSidebar.setBackgroundColor(Color.parseColor("#F9FAFB"))
            }
            "theme-pink-dark" -> {
                layoutTopBar.backgroundTintList = glassTint(Color.parseColor("#261316"))
                layoutAddressBar.backgroundTintList = glassTint(omniboxTint(Color.parseColor("#331B20")), 226)
                etBrowserUrl.setTextColor(Color.parseColor("#FFFFFF"))
                etBrowserUrl.setHintTextColor(Color.parseColor("#D9A5AF"))
                ivUrlIcon.imageTintList = ColorStateList.valueOf(Color.WHITE)
                btnTopBack.imageTintList = ColorStateList.valueOf(Color.WHITE)
                btnTopForward.imageTintList = ColorStateList.valueOf(Color.WHITE)
                btnTopReload.imageTintList = ColorStateList.valueOf(Color.WHITE)
                btnTopHome.imageTintList = ColorStateList.valueOf(Color.WHITE)
                btnTopMenu.imageTintList = ColorStateList.valueOf(Color.WHITE)
                btnMobileReload.imageTintList = ColorStateList.valueOf(Color.WHITE)
                layoutBottomBar.backgroundTintList = glassTint(Color.parseColor("#261316"))
                btnNavBack.imageTintList = ColorStateList.valueOf(Color.WHITE)
                btnNavForward.imageTintList = ColorStateList.valueOf(Color.WHITE)
                btnNavHome.imageTintList = ColorStateList.valueOf(Color.WHITE)
                tvNavTabCount.setBackgroundResource(R.drawable.bg_tab_counter_dark)
                tvNavTabCount.setTextColor(Color.WHITE)
                btnQuickTranslateChip.backgroundTintList = ColorStateList.valueOf(Color.parseColor("#3D2228"))
                ivTranslateChipIcon.imageTintList = ColorStateList.valueOf(Color.WHITE)
                tvTranslateChipText.setTextColor(Color.WHITE)
                layoutTranslateProgress.setBackgroundColor(Color.parseColor("#331B20"))
                tvTranslateStatus.setTextColor(Color.WHITE)
                pbTranslateSpinner.indeterminateTintList = ColorStateList.valueOf(Color.WHITE)
                btnCloseTranslateProgress.imageTintList = ColorStateList.valueOf(Color.parseColor("#D9A5AF"))
                layoutSidebar.setBackgroundColor(Color.parseColor("#221013"))
            }
            "theme-pink-light" -> {
                layoutTopBar.backgroundTintList = glassTint(Color.parseColor("#FAD2D9"))
                layoutAddressBar.backgroundTintList = glassTint(omniboxTint(Color.parseColor("#FFFFFF")), 226)
                etBrowserUrl.setTextColor(Color.parseColor("#6E343D"))
                etBrowserUrl.setHintTextColor(Color.parseColor("#9C5D66"))
                ivUrlIcon.imageTintList = ColorStateList.valueOf(Color.parseColor("#6E343D"))
                btnTopBack.imageTintList = ColorStateList.valueOf(Color.parseColor("#6E343D"))
                btnTopForward.imageTintList = ColorStateList.valueOf(Color.parseColor("#6E343D"))
                btnTopReload.imageTintList = ColorStateList.valueOf(Color.parseColor("#6E343D"))
                btnTopHome.imageTintList = ColorStateList.valueOf(Color.parseColor("#6E343D"))
                btnTopMenu.imageTintList = ColorStateList.valueOf(Color.parseColor("#6E343D"))
                btnMobileReload.imageTintList = ColorStateList.valueOf(Color.parseColor("#6E343D"))
                layoutBottomBar.backgroundTintList = glassTint(Color.parseColor("#FFFFFF"))
                btnNavBack.imageTintList = ColorStateList.valueOf(Color.parseColor("#6E343D"))
                btnNavForward.imageTintList = ColorStateList.valueOf(Color.parseColor("#6E343D"))
                btnNavHome.imageTintList = ColorStateList.valueOf(Color.parseColor("#6E343D"))
                tvNavTabCount.setBackgroundResource(R.drawable.bg_tab_counter_light)
                tvNavTabCount.setTextColor(Color.parseColor("#6E343D"))
                btnQuickTranslateChip.backgroundTintList = ColorStateList.valueOf(Color.parseColor("#FCE7EC"))
                ivTranslateChipIcon.imageTintList = ColorStateList.valueOf(Color.parseColor("#6E343D"))
                tvTranslateChipText.setTextColor(Color.parseColor("#6E343D"))
                layoutTranslateProgress.setBackgroundColor(Color.parseColor("#FFFFFF"))
                tvTranslateStatus.setTextColor(Color.parseColor("#6E343D"))
                pbTranslateSpinner.indeterminateTintList = ColorStateList.valueOf(Color.parseColor("#6E343D"))
                btnCloseTranslateProgress.imageTintList = ColorStateList.valueOf(Color.parseColor("#9C5D66"))
                layoutSidebar.setBackgroundColor(Color.parseColor("#FFF5F7"))
            }
        }

        if (theme.startsWith("theme-custom")) {
            applySidebarTheme(theme)
            applyWebDarkModeToAllTabs()
            updateDesktopMenuLabels()
            if (isTabletLayout()) renderTabletTabStrip()
            return
        }

        val isDarkTheme = theme.endsWith("-dark")
        val isPinkTheme = theme.startsWith("theme-pink")
        val windowBg = when (theme) {
            "theme-default-light" -> "#F4F5F7"
            "theme-pink-light" -> "#FFF5F7"
            "theme-pink-dark" -> "#1B0D10"
            else -> "#0B0C0E"
        }
        rootLayout.setBackgroundColor(Color.parseColor(windowBg))
        layoutSearchSuggestions.setBackgroundColor(
            when {
                !theme.endsWith("-dark") -> Color.WHITE
                theme.startsWith("theme-pink") -> Color.parseColor("#1F1013")
                else -> Color.parseColor("#101114")
            }
        )
        applySidebarTheme(theme)
        applyWebDarkModeToAllTabs()
        updateDesktopMenuLabels()
        if (isTabletLayout()) renderTabletTabStrip()
    }

    private fun saveTabsToPrefs() {
        val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val arr = JSONArray()
        for (t in tabs) {
            if (!t.isSecurity) {
                val obj = JSONObject().apply {
                    put("id", t.id)
                    put("title", t.title)
                    put("url", t.webView.url ?: t.url)
                    put("groupId", t.groupId)
                }
                arr.put(obj)
            }
        }
        prefs.edit()
            .putString("saved_tabs_persistent_json", arr.toString())
            .putInt("saved_active_tab_persistent_idx", activeTabIndex)
            .apply()
    }

    private fun loadSavedPersistentTabs(): Boolean {
        val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val raw = prefs.getString("saved_tabs_persistent_json", null) ?: return false
        if (raw == "[]" || raw.isBlank()) return false
        try {
            val arr = JSONArray(raw)
            if (arr.length() == 0) return false
            webViewContainer.removeAllViews()
            tabs.clear()
            for (i in 0 until arr.length()) {
                val obj = arr.getJSONObject(i)
                val url = obj.optString("url", START_PAGE_URL)
                val title = obj.optString("title", "시작 페이지")
                val groupId = if (obj.has("groupId") && !obj.isNull("groupId")) obj.getString("groupId") else null
                addNewTab(url = url, makeActive = false, isSecurity = false, groupId = groupId)
                if (i < tabs.size) {
                    tabs[i].title = title
                }
            }
            val savedIdx = prefs.getInt("saved_active_tab_persistent_idx", 0)
            val targetIdx = if (savedIdx in tabs.indices) savedIdx else 0
            if (tabs.isNotEmpty()) {
                switchTab(targetIdx)
                return true
            }
        } catch (e: Exception) {}
        return false
    }

    private var sidebarBookmarkFolder: String = "전체"

    private fun populateSidebarBookmarks() {
        val layoutFolders = findViewById<LinearLayout>(R.id.layoutSidebarBookmarkFoldersBar) ?: return
        val layoutList = findViewById<LinearLayout>(R.id.layoutSidebarBookmarksList) ?: return
        val btnAdd = findViewById<Button>(R.id.btnSidebarAddBookmark)
        val tvHeader = findViewById<TextView>(R.id.tvSidebarBookmarksHeader)
        val palette = sidebarPalette(getAppThemeMode())

        layoutFolders.removeAllViews()
        val folders = mutableListOf("전체")
        folders.addAll(getBookmarkFolders())
        for (folder in getSavedBookmarks().map { it.folder }) {
            if (!folders.contains(folder)) folders.add(folder)
        }
        if (!folders.contains(sidebarBookmarkFolder)) sidebarBookmarkFolder = "전체"

        fun renderBookmarks() {
            layoutList.removeAllViews()
            val all = getSavedBookmarks()
            val filtered = if (sidebarBookmarkFolder == "전체") all else all.filter { it.folder == sidebarBookmarkFolder }
            tvHeader?.text = "북마크 " + all.size + "개"
            if (filtered.isEmpty()) {
                val tv = TextView(this).apply {
                    text = "'" + sidebarBookmarkFolder + "' 폴더에 저장된 북마크가 없습니다.\n위의 [북마크 저장]으로 현재 페이지를 담아보세요."
                    textSize = 12f
                    setTextColor(palette.textSecondary)
                    setPadding(dpToPx(4), dpToPx(16), dpToPx(4), dpToPx(16))
                    gravity = android.view.Gravity.CENTER
                }
                layoutList.addView(tv)
                return
            }
            for (b in filtered) {
                val item = layoutInflater.inflate(R.layout.item_tab_card, layoutList, false)
                val tvTitle = item.findViewById<TextView>(R.id.tvTabTitle)
                val tvUrl = item.findViewById<TextView>(R.id.tvTabUrl)
                val btnClose = item.findViewById<ImageView>(R.id.btnTabClose)
                val tvFolderTag = item.findViewById<TextView>(R.id.tvGroupTag)
                item.findViewById<ImageView>(R.id.btnTabGroupAction).visibility = View.GONE
                tvTitle.text = b.title
                tvUrl.text = b.url
                tvTitle.setTextColor(palette.textPrimary)
                tvUrl.setTextColor(palette.textSecondary)
                btnClose.imageTintList = ColorStateList.valueOf(palette.textSecondary)
                if (b.folder != "기본") {
                    tvFolderTag.visibility = View.VISIBLE
                    tvFolderTag.text = b.folder
                } else {
                    tvFolderTag.visibility = View.GONE
                }
                item.setOnClickListener {
                    loadWebQuery(b.url)
                }
                btnClose.setOnClickListener {
                    deleteBookmark(b.url)
                    renderBookmarks()
                }
                layoutList.addView(item)
            }
        }

        fun renderFolders() {
            layoutFolders.removeAllViews()
            for (f in folders) {
                val chip = TextView(this).apply {
                    text = f
                    textSize = 11f
                    setPadding(dpToPx(13), dpToPx(6), dpToPx(13), dpToPx(6))
                    layoutParams = LinearLayout.LayoutParams(
                        LinearLayout.LayoutParams.WRAP_CONTENT,
                        LinearLayout.LayoutParams.WRAP_CONTENT
                    ).apply { marginEnd = dpToPx(6) }
                    if (f == sidebarBookmarkFolder) {
                        setBackgroundResource(R.drawable.bg_pill_badge)
                        backgroundTintList = ColorStateList.valueOf(palette.accentBg)
                        setTextColor(palette.accentFg)
                    } else {
                        setBackgroundResource(R.drawable.bg_pill_badge)
                        backgroundTintList = ColorStateList.valueOf(palette.headerBg)
                        setTextColor(palette.textSecondary)
                    }
                    setOnClickListener {
                        sidebarBookmarkFolder = f
                        renderFolders()
                        renderBookmarks()
                    }
                }
                layoutFolders.addView(chip)
            }
            val addFolderChip = TextView(this).apply {
                text = "+ 폴더"
                textSize = 11f
                setPadding(dpToPx(12), dpToPx(6), dpToPx(12), dpToPx(6))
                setTextColor(palette.textSecondary)
                setBackgroundResource(R.drawable.bg_pill_badge)
                backgroundTintList = ColorStateList.valueOf(palette.headerBg)
                setOnClickListener {
                    val input = EditText(this@MainActivity).apply { hint = "폴더 이름 (예: 업무, 쇼핑, AI)" }
                    AlertDialog.Builder(this@MainActivity)
                        .setTitle("새 즐겨찾기 폴더")
                        .setView(input)
                        .setPositiveButton("생성") { _, _ ->
                            val folderName = input.text.toString().trim()
                            if (folderName.isNotEmpty()) {
                                addBookmarkFolder(folderName)
                                folders.clear()
                                folders.add("전체")
                                folders.addAll(getBookmarkFolders())
                                sidebarBookmarkFolder = folderName
                                renderFolders()
                                renderBookmarks()
                            }
                        }
                        .setNegativeButton("취소", null)
                        .show()
                }
            }
            layoutFolders.addView(addFolderChip)
        }

        btnAdd?.setOnClickListener {
            val cur = getCurrentWebView()
            val title = cur.title ?: "북마크"
            val url = cur.url ?: START_PAGE_URL
            val target = if (sidebarBookmarkFolder == "전체") "기본" else sidebarBookmarkFolder
            saveCustomBookmark(title, url, target)
            Toast.makeText(this, "북마크가 저장되었습니다.", Toast.LENGTH_SHORT).show()
            renderBookmarks()
        }

        renderFolders()
        renderBookmarks()
    }

    override fun onActionModeStarted(mode: ActionMode?) {
        super.onActionModeStarted(mode)
        val menu = mode?.menu
        menu?.add(Menu.NONE, 2001, 0, "Creamy 질문")?.setOnMenuItemClickListener {
            val curWv = getCurrentWebView()
            curWv.evaluateJavascript("(function(){ return window.getSelection().toString(); })();") { value ->
                val text = cleanSelectedText(value)
                if (text.isNotBlank()) askCreamyWithText(text)
            }
            mode.finish()
            true
        }
        menu?.add(Menu.NONE, 2002, 1, "My Bag 담기")?.setOnMenuItemClickListener {
            val curWv = getCurrentWebView()
            curWv.evaluateJavascript("(function(){ return window.getSelection().toString(); })();") { value ->
                val text = cleanSelectedText(value)
                if (text.isNotBlank()) addTextToBag(text)
            }
            mode.finish()
            true
        }
        menu?.add(Menu.NONE, 2003, 2, "작업 메뉴")?.setOnMenuItemClickListener {
            val curWv = getCurrentWebView()
            curWv.evaluateJavascript("(function(){ return window.getSelection().toString(); })();") { value ->
                val text = cleanSelectedText(value)
                if (text.isNotBlank()) showTextActionDialog(text)
            }
            mode.finish()
            true
        }
    }

    private fun captureFullPageScreenshot() {
        val wv = getCurrentWebView()
        val curUrl = wv.url ?: ""
        if (curUrl == START_PAGE_URL || curUrl == START_PAGE_SECURITY_URL || curUrl.startsWith("file:///android_asset/")) {
            Toast.makeText(this, "시작 페이지는 캡처할 수 없습니다", Toast.LENGTH_SHORT).show()
            return
        }

        try {
            val scale = wv.scale
            val contentHeight = (wv.contentHeight * scale).toInt()
            val width = wv.width.coerceAtLeast(1)
            val height = contentHeight.coerceIn(wv.height, 10000)

            val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
            val canvas = Canvas(bitmap)
            wv.draw(canvas)

            showCaptureResultDialog(bitmap, wv.title ?: "캡처 이미지", curUrl)
        } catch (oom: OutOfMemoryError) {
            try {
                val width = wv.width.coerceAtLeast(1)
                val height = wv.height.coerceAtLeast(1)
                val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
                val canvas = Canvas(bitmap)
                wv.draw(canvas)
                showCaptureResultDialog(bitmap, wv.title ?: "캡처 이미지", curUrl)
            } catch (e: Exception) {
                Toast.makeText(this, "화면 캡처 중 메모리가 부족합니다", Toast.LENGTH_SHORT).show()
            }
        } catch (e: Exception) {
            Toast.makeText(this, "화면 캡처 생성 실패: ${e.message}", Toast.LENGTH_SHORT).show()
        }
    }

    private fun showCaptureResultDialog(bitmap: Bitmap, pageTitle: String, sourceUrl: String) {
        val dialog = createConfiguredBottomSheetDialog()
        val view = layoutInflater.inflate(R.layout.dialog_screenshot_result, null)
        dialog.setContentView(view)
        applyTouchAnimationToAll(view)

        val ivPreview = view.findViewById<ImageView>(R.id.ivCapturePreview)
        val btnSaveGallery = view.findViewById<Button>(R.id.btnSaveGallery)
        val btnShareCapture = view.findViewById<Button>(R.id.btnShareCapture)
        val btnAddToBagCapture = view.findViewById<Button>(R.id.btnAddToBagCapture)

        ivPreview.setImageBitmap(bitmap)

        btnSaveGallery.setOnClickListener {
            dialog.dismiss()
            saveBitmapToGallery(bitmap, pageTitle)
        }

        btnShareCapture.setOnClickListener {
            dialog.dismiss()
            shareBitmap(bitmap)
        }

        btnAddToBagCapture.setOnClickListener {
            dialog.dismiss()
            addCaptureToBag(bitmap, pageTitle, sourceUrl)
        }

        dialog.show()
    }

    private fun saveBitmapToGallery(bitmap: Bitmap, title: String, prefix: String = "CreamCapture") {
        try {
            val filename = prefix + "_" + SimpleDateFormat("yyyyMMdd_HHmmss", Locale.getDefault()).format(Date()) + ".png"
            val contentValues = android.content.ContentValues().apply {
                put(MediaStore.MediaColumns.DISPLAY_NAME, filename)
                put(MediaStore.MediaColumns.MIME_TYPE, "image/png")
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/CreamBrowser")
                    put(MediaStore.MediaColumns.IS_PENDING, 1)
                }
            }
            val uri = contentResolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, contentValues)
            if (uri != null) {
                contentResolver.openOutputStream(uri)?.use { out ->
                    bitmap.compress(Bitmap.CompressFormat.PNG, 100, out)
                }
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    contentValues.clear()
                    contentValues.put(MediaStore.MediaColumns.IS_PENDING, 0)
                    contentResolver.update(uri, contentValues, null, null)
                }
                Toast.makeText(this, "갤러리에 캡처 이미지가 저장되었습니다", Toast.LENGTH_SHORT).show()
            } else {
                Toast.makeText(this, "이미지 저장에 실패했습니다", Toast.LENGTH_SHORT).show()
            }
        } catch (e: Exception) {
            Toast.makeText(this, "갤러리 저장 실패: ${e.message}", Toast.LENGTH_SHORT).show()
        }
    }

    private fun shareBitmap(bitmap: Bitmap) {
        try {
            val cacheFile = File(cacheDir, "shared_capture_${System.currentTimeMillis()}.png")
            FileOutputStream(cacheFile).use { out ->
                bitmap.compress(Bitmap.CompressFormat.PNG, 100, out)
            }
            val contentUri = FileProvider.getUriForFile(
                this,
                "com.cream.browser.fileprovider",
                cacheFile
            )
            val shareIntent = Intent(Intent.ACTION_SEND).apply {
                type = "image/png"
                putExtra(Intent.EXTRA_STREAM, contentUri)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            startActivity(Intent.createChooser(shareIntent, "캡처 이미지 공유"))
        } catch (e: Exception) {
            Toast.makeText(this, "이미지 공유 실패: ${e.message}", Toast.LENGTH_SHORT).show()
        }
    }

    private fun addCaptureToBag(bitmap: Bitmap, title: String, sourceUrl: String) {
        try {
            val bagFile = File(filesDir, "bag_capture_${System.currentTimeMillis()}.png")
            FileOutputStream(bagFile).use { out ->
                bitmap.compress(Bitmap.CompressFormat.PNG, 90, out)
            }
            val item = BagItem(
                id = System.currentTimeMillis().toString(),
                type = "image",
                title = if (title.isBlank()) "웹 전체 캡처" else "캡처: $title",
                content = bagFile.absolutePath,
                sourceUrl = sourceUrl,
                timestamp = System.currentTimeMillis()
            )
            saveBagItem(item)
            Toast.makeText(this, "My Bag에 캡처 이미지가 저장되었습니다.", Toast.LENGTH_SHORT).show()
        } catch (e: Exception) {
            Toast.makeText(this, "My Bag 저장 실패: ${e.message}", Toast.LENGTH_SHORT).show()
        }
    }

    private fun cleanSelectedText(raw: String?): String {
        if (raw.isNullOrBlank() || raw == "null" || raw == "\"\"") return ""
        var s = raw.trim()
        if (s.startsWith("\"") && s.endsWith("\"") && s.length >= 2) {
            s = s.substring(1, s.length - 1)
        }
        return s.replace("\\n", "\n")
            .replace("\\r", "")
            .replace("\\\"", "\"")
            .replace("\\\\", "\\")
            .trim()
    }

    private fun addTextToBag(text: String) {
        val curTab = getCurrentTab()
        val curUrl = curTab.webView.url ?: ""
        val item = BagItem(
            id = System.currentTimeMillis().toString(),
            type = "text",
            title = if (text.length > 25) text.take(25) + "..." else text,
            content = text,
            sourceUrl = curUrl,
            timestamp = System.currentTimeMillis()
        )
        saveBagItem(item)
        Toast.makeText(this, "선택한 텍스트가 My Bag에 저장되었습니다.", Toast.LENGTH_SHORT).show()
    }

    private fun askCreamyWithText(text: String) {
        if (isTabletLayout()) {
            switchSidebarTab("ai")
            if (layoutSidebar.visibility != View.VISIBLE) toggleSidebar("ai")
            etSidebarQuery.setText(text)
            val currentWv = getCurrentWebView()
            val currentTitle = currentWv.title ?: "현재 페이지"
            tvSidebarAiResult.text = "질문: $text\n\n답변: [$currentTitle] 페이지에서 선택한 내용을 바탕으로 Creamy가 분석을 진행 중입니다."
        } else {
            showCreamyBottomSheet(text)
        }
    }

    private fun showTextActionDialog(text: String) {
        val dialog = createConfiguredBottomSheetDialog()
        val view = layoutInflater.inflate(R.layout.dialog_text_action, null)
        dialog.setContentView(view)
        applyTouchAnimationToAll(view)

        val tvPreview = view.findViewById<TextView>(R.id.tvSelectedTextPreview)
        val actionCreamyAsk = view.findViewById<LinearLayout>(R.id.actionCreamyAsk)
        val actionAddToBag = view.findViewById<LinearLayout>(R.id.actionAddToBag)
        val actionCopyText = view.findViewById<LinearLayout>(R.id.actionCopyText)
        val actionSearchWeb = view.findViewById<LinearLayout>(R.id.actionSearchWeb)

        tvPreview.text = text

        actionCreamyAsk.setOnClickListener {
            dialog.dismiss()
            askCreamyWithText(text)
        }

        actionAddToBag.setOnClickListener {
            dialog.dismiss()
            addTextToBag(text)
        }

        actionCopyText.setOnClickListener {
            dialog.dismiss()
            val clip = getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager
            clip?.setPrimaryClip(android.content.ClipData.newPlainText("Selected Text", text))
            Toast.makeText(this, "텍스트가 클립보드에 복사되었습니다", Toast.LENGTH_SHORT).show()
        }

        actionSearchWeb.setOnClickListener {
            dialog.dismiss()
            loadWebQuery(text)
        }

        dialog.show()
    }

    // ==================== v2.2.0: 시작페이지 위젯용 네이티브 HTTP 브리지 ====================

    private val httpCache = mutableMapOf<String, Pair<Long, String>>()

    private fun httpGetCached(url: String): String? {
        val now = System.currentTimeMillis()
        httpCache[url]?.let { (time, body) ->
            if (now - time < 60_000L) return body
        }
        val body = httpGet(url) ?: return null
        httpCache[url] = now to body
        if (httpCache.size > 40) {
            httpCache.keys.take(10).forEach { httpCache.remove(it) }
        }
        return body
    }

    private fun httpGet(url: String, timeoutMs: Int = 12000): String? {
        var conn: HttpURLConnection? = null
        return try {
            conn = URL(url).openConnection() as HttpURLConnection
            conn.connectTimeout = timeoutMs
            conn.readTimeout = timeoutMs
            conn.instanceFollowRedirects = true
            conn.setRequestProperty("User-Agent", MOBILE_USER_AGENT)
            conn.setRequestProperty("Accept", "*/*")
            if (conn.responseCode !in 200..299) {
                null
            } else {
                val encoding = conn.contentEncoding
                val stream = if (encoding != null && encoding.contains("gzip", true)) {
                    java.util.zip.GZIPInputStream(conn.inputStream)
                } else conn.inputStream
                val buffer = java.io.ByteArrayOutputStream()
                val chunk = ByteArray(8192)
                var total = 0
                while (total < 400_000) {
                    val read = stream.read(chunk)
                    if (read <= 0) break
                    buffer.write(chunk, 0, read)
                    total += read
                }
                stream.close()
                String(buffer.toByteArray(), Charsets.UTF_8)
            }
        } catch (e: Exception) {
            null
        } finally {
            try { conn?.disconnect() } catch (e: Exception) {}
        }
    }

    // ==================== v2.2.0: 듀얼 분할 브라우징 ====================

    private fun splitTab(): WebTab? = splitTabId?.let { id -> tabs.find { it.id == id } }

    private fun showSplitViewDialog() {
        if (!isTabletLayout()) {
            Toast.makeText(this, "분할 브라우징은 태블릿 가로 화면에서 사용할 수 있습니다", Toast.LENGTH_SHORT).show()
            return
        }
        val palette = sidebarPalette(getAppThemeMode())
        val dialog = createConfiguredBottomSheetDialog()
        val container = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dpToPx(20), dpToPx(18), dpToPx(20), dpToPx(20))
            setBackgroundResource(R.drawable.bg_bottom_sheet)
        }
        container.addView(TextView(this).apply {
            text = "듀얼 분할 브라우징"
            textSize = 16f
            setTypeface(null, android.graphics.Typeface.BOLD)
            setTextColor(palette.textPrimary)
        })
        container.addView(TextView(this).apply {
            text = "화면을 나눠 두 개의 웹페이지를 동시에 띄웁니다. 오른쪽에 열 탭을 고르세요."
            textSize = 11.5f
            setTextColor(palette.textSecondary)
            setPadding(0, dpToPx(4), 0, dpToPx(10))
        })

        var pendingRatio = splitLeftRatio
        val ratioRow = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        val ratioChips = mutableListOf<Pair<TextView, Float>>()
        val applyRatioStyles = {
            for ((chip, ratio) in ratioChips) {
                val selected = kotlin.math.abs(ratio - pendingRatio) < 0.01f
                chip.setBackgroundResource(R.drawable.bg_pill_badge)
                chip.backgroundTintList = ColorStateList.valueOf(if (selected) palette.accentBg else palette.headerBg)
                chip.setTextColor(if (selected) palette.accentFg else palette.textSecondary)
            }
        }
        for ((label, ratio) in listOf("5 : 5" to 0.5f, "7 : 3" to 0.7f, "3 : 7" to 0.3f)) {
            val chip = TextView(this).apply {
                text = label
                textSize = 11.5f
                gravity = android.view.Gravity.CENTER
                setPadding(dpToPx(12), dpToPx(8), dpToPx(12), dpToPx(8))
                layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { marginEnd = dpToPx(6) }
                setBackgroundResource(R.drawable.bg_pill_badge)
                setOnClickListener { pendingRatio = ratio; applyRatioStyles() }
            }
            ratioChips.add(chip to ratio)
            ratioRow.addView(chip)
        }
        applyRatioStyles()
        container.addView(ratioRow)

        val listBox = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { topMargin = dpToPx(10) }
        }
        for (i in tabs.indices) {
            val tab = tabs[i]
            if (i == activeTabIndex) continue
            val row = TextView(this).apply {
                text = (if (tab.title.isBlank()) "새 탭" else tab.title) + "  ·  " + shortHost(tab.webView.url ?: tab.url)
                textSize = 12.5f
                setTextColor(palette.textPrimary)
                setPadding(dpToPx(10), dpToPx(12), dpToPx(10), dpToPx(12))
                setBackgroundResource(palette.inputDrawable)
                layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { bottomMargin = dpToPx(6) }
                setOnClickListener {
                    startSplitView(i, pendingRatio)
                    dialog.dismiss()
                }
            }
            listBox.addView(row)
        }
        if (tabs.size <= 1) {
            listBox.addView(TextView(this).apply {
                text = "오른쪽에 열 다른 탭이 없습니다. 새 탭을 먼저 열어 주세요."
                textSize = 11.5f
                setTextColor(palette.textSecondary)
                setPadding(dpToPx(4), dpToPx(10), dpToPx(4), dpToPx(10))
            })
        }
        container.addView(listBox)

        if (splitActive) {
            val stop = Button(this).apply {
                text = "분할 화면 종료"
                textSize = 12f
                isAllCaps = false
                setTextColor(palette.textPrimary)
                backgroundTintList = ColorStateList.valueOf(palette.headerBg)
                layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dpToPx(42)).apply { topMargin = dpToPx(8) }
                setOnClickListener {
                    exitSplitView(true)
                    dialog.dismiss()
                }
            }
            container.addView(stop)
        }

        dialog.setContentView(container)
        dialog.show()
    }

    private fun shortHost(url: String?): String {
        if (url.isNullOrBlank()) return ""
        return try {
            val host = Uri.parse(url).host ?: return url
            host.removePrefix("www.")
        } catch (e: Exception) {
            url
        }
    }

    private fun startSplitView(index: Int, leftRatio: Float = 0.5f) {
        if (!isTabletLayout() || index !in tabs.indices) return
        if (index == activeTabIndex) {
            Toast.makeText(this, "왼쪽 화면과 다른 탭을 선택해 주세요", Toast.LENGTH_SHORT).show()
            return
        }
        splitActive = true
        splitTabId = tabs[index].id
        splitLeftRatio = leftRatio.coerceIn(0.3f, 0.7f)
        layoutSplitPanes()
        renderTabletTabStrip()
    }

    private fun layoutSplitPanes() {
        if (!::webViewContainerSplit.isInitialized) return
        val right = splitTab()
        if (!splitActive || right == null || !tabs.contains(right) || !isTabletLayout()) {
            if (splitActive) exitSplitView(false)
            return
        }
        val leftWv = getCurrentWebView()
        if (leftWv.parent !== webViewContainer) {
            (leftWv.parent as? ViewGroup)?.removeView(leftWv)
            webViewContainer.addView(leftWv, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
        }
        if (right.webView.parent !== webViewContainerSplit) {
            (right.webView.parent as? ViewGroup)?.removeView(right.webView)
            webViewContainerSplit.addView(right.webView, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
        }
        leftWv.visibility = View.VISIBLE
        right.webView.visibility = View.VISIBLE
        (webViewContainer.layoutParams as? LinearLayout.LayoutParams)?.weight = splitLeftRatio
        (webViewContainerSplit.layoutParams as? LinearLayout.LayoutParams)?.weight = 1f - splitLeftRatio
        webViewContainerSplit.visibility = View.VISIBLE
        viewSplitDivider.visibility = View.VISIBLE
    }

    private fun exitSplitView(notify: Boolean) {
        if (!splitActive) return
        val right = splitTab()
        splitActive = false
        splitTabId = null
        if (right != null && right.webView.parent === webViewContainerSplit) {
            webViewContainerSplit.removeView(right.webView)
            webViewContainer.addView(right.webView, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
            right.webView.visibility = View.GONE
        }
        if (::webViewContainerSplit.isInitialized) webViewContainerSplit.visibility = View.GONE
        if (::viewSplitDivider.isInitialized) viewSplitDivider.visibility = View.GONE
        (webViewContainer.layoutParams as? LinearLayout.LayoutParams)?.weight = 1f
        (webViewContainerSplit.layoutParams as? LinearLayout.LayoutParams)?.weight = 1f
        if (notify) Toast.makeText(this, "분할 화면을 종료했습니다", Toast.LENGTH_SHORT).show()
        if (isTabletLayout()) renderTabletTabStrip()
    }

    // ==================== v2.2.0: 원클릭 웹 액션 매크로 ====================

    data class MacroStep(val url: String, val title: String)

    data class BrowserMacro(val id: String, val name: String, val steps: List<MacroStep>)

    private fun getMacros(): MutableList<BrowserMacro> {
        val raw = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .getString("browser_macros", "[]") ?: "[]"
        val list = mutableListOf<BrowserMacro>()
        try {
            val arr = JSONArray(raw)
            for (i in 0 until arr.length()) {
                val o = arr.getJSONObject(i)
                val stepsArr = o.optJSONArray("steps") ?: JSONArray()
                val steps = mutableListOf<MacroStep>()
                for (j in 0 until stepsArr.length()) {
                    val so = stepsArr.getJSONObject(j)
                    steps.add(MacroStep(so.optString("url", ""), so.optString("title", "")))
                }
                list.add(BrowserMacro(o.optString("id", "macro_$i"), o.optString("name", "매크로"), steps))
            }
        } catch (e: Exception) {
        }
        return list
    }

    private fun saveMacros(list: List<BrowserMacro>) {
        val arr = JSONArray()
        for (m in list) {
            val stepsArr = JSONArray()
            for (st in m.steps) {
                stepsArr.put(JSONObject().apply {
                    put("url", st.url)
                    put("title", st.title)
                })
            }
            arr.put(JSONObject().apply {
                put("id", m.id)
                put("name", m.name)
                put("steps", stepsArr)
            })
        }
        getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit()
            .putString("browser_macros", arr.toString())
            .apply()
    }

    private fun currentJourneySteps(): List<MacroStep> {
        val list = mutableListOf<MacroStep>()
        for (tab in tabs) {
            val u = tab.webView.url ?: tab.url
            if (u.isBlank() || u.startsWith("file:///android_asset/")) continue
            if (u == START_PAGE_URL || u == START_PAGE_SECURITY_URL) continue
            list.add(MacroStep(u, if (tab.title.isBlank()) shortHost(u) else tab.title))
        }
        return list
    }

    private fun askMacroName(initial: String, onDone: (String) -> Unit) {
        val palette = sidebarPalette(getAppThemeMode())
        val input = EditText(this).apply {
            setText(initial)
            setSingleLine(true)
            textSize = 13f
            setTextColor(palette.textPrimary)
            setHintTextColor(palette.textSecondary)
            hint = "매크로 이름"
            setPadding(dpToPx(12), dpToPx(10), dpToPx(12), dpToPx(10))
            setBackgroundResource(palette.inputDrawable)
        }
        val holder = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dpToPx(20), dpToPx(16), dpToPx(20), dpToPx(8))
            addView(TextView(this@MainActivity).apply {
                text = "지금 열려 있는 탭 순서를 한 번에 실행하는 숏컷으로 저장합니다."
                textSize = 11.5f
                setTextColor(palette.textSecondary)
                setPadding(0, 0, 0, dpToPx(10))
            })
            addView(input)
        }
        AlertDialog.Builder(this)
            .setTitle("웹 액션 매크로 만들기")
            .setView(holder)
            .setPositiveButton("저장") { _, _ ->
                val name = input.text.toString().trim()
                if (name.isNotBlank()) onDone(name)
            }
            .setNegativeButton("취소", null)
            .show()
    }

    private fun createMacroFromCurrentTabs() {
        val steps = currentJourneySteps()
        if (steps.isEmpty()) {
            Toast.makeText(this, "저장할 웹페이지 탭이 없습니다", Toast.LENGTH_SHORT).show()
            return
        }
        askMacroName(steps.first().title.take(18)) { name ->
            val list = getMacros()
            list.add(BrowserMacro("macro_" + System.currentTimeMillis(), name, steps))
            saveMacros(list)
            Toast.makeText(this, "'$name' 매크로를 저장했습니다", Toast.LENGTH_SHORT).show()
            if (currentSidebarTab == "list" && sidebarListType == "macro") renderSidebarList()
        }
    }

    private fun runMacro(macro: BrowserMacro) {
        if (macro.steps.isEmpty()) {
            Toast.makeText(this, "실행할 단계가 없습니다", Toast.LENGTH_SHORT).show()
            return
        }
        Toast.makeText(this, "매크로 실행: ${macro.name}", Toast.LENGTH_SHORT).show()
        addNewTab(macro.steps.first().url, makeActive = true)
        val handler = android.os.Handler(android.os.Looper.getMainLooper())
        var index = 1
        val runner = object : Runnable {
            override fun run() {
                if (isFinishing || index >= macro.steps.size) return
                getCurrentWebView().loadUrl(macro.steps[index].url)
                index++
                if (index < macro.steps.size) handler.postDelayed(this, 2400L)
            }
        }
        if (macro.steps.size > 1) handler.postDelayed(runner, 2600L)
    }

    private fun showMacroDialog() {
        val palette = sidebarPalette(getAppThemeMode())
        val dialog = createConfiguredBottomSheetDialog()
        val container = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dpToPx(20), dpToPx(18), dpToPx(20), dpToPx(20))
            setBackgroundResource(R.drawable.bg_bottom_sheet)
        }
        container.addView(TextView(this).apply {
            text = "원클릭 웹 액션 매크로"
            textSize = 16f
            setTypeface(null, android.graphics.Typeface.BOLD)
            setTextColor(palette.textPrimary)
        })
        container.addView(TextView(this).apply {
            text = "자주 가는 동선을 탭 순서대로 묶어 한 번에 실행합니다."
            textSize = 11.5f
            setTextColor(palette.textSecondary)
            setPadding(0, dpToPx(4), 0, dpToPx(10))
        })

        val macros = getMacros()
        if (macros.isEmpty()) {
            container.addView(TextView(this).apply {
                text = "저장된 매크로가 없습니다. 아래 버튼으로 지금 열린 탭들을 묶어 보세요."
                textSize = 12f
                setTextColor(palette.textSecondary)
                setPadding(0, dpToPx(6), 0, dpToPx(10))
            })
        }
        for (macro in macros) {
            val row = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = android.view.Gravity.CENTER_VERTICAL
                setPadding(dpToPx(10), dpToPx(8), dpToPx(10), dpToPx(8))
                setBackgroundResource(palette.inputDrawable)
                layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { bottomMargin = dpToPx(6) }
            }
            row.addView(LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                addView(TextView(this@MainActivity).apply {
                    text = macro.name
                    textSize = 13f
                    setTypeface(null, android.graphics.Typeface.BOLD)
                    setTextColor(palette.textPrimary)
                })
                addView(TextView(this@MainActivity).apply {
                    text = macro.steps.size.toString() + "단계 · " + macro.steps.joinToString(" › ") { it.title.take(10) }
                    textSize = 10.5f
                    setTextColor(palette.textSecondary)
                    maxLines = 1
                    ellipsize = android.text.TextUtils.TruncateAt.END
                })
            })
            row.addView(TextView(this).apply {
                text = "실행"
                textSize = 11.5f
                setPadding(dpToPx(10), dpToPx(7), dpToPx(10), dpToPx(7))
                setBackgroundResource(R.drawable.bg_pill_badge)
                backgroundTintList = ColorStateList.valueOf(palette.accentBg)
                setTextColor(palette.accentFg)
                setOnClickListener {
                    dialog.dismiss()
                    runMacro(macro)
                }
            })
            row.addView(TextView(this).apply {
                text = "삭제"
                textSize = 11.5f
                setTextColor(palette.textSecondary)
                setPadding(dpToPx(10), dpToPx(7), dpToPx(4), dpToPx(7))
                setOnClickListener {
                    val list = getMacros().filter { it.id != macro.id }
                    saveMacros(list)
                    dialog.dismiss()
                    showMacroDialog()
                }
            })
            container.addView(row)
        }

        val create = Button(this).apply {
            text = "현재 탭들로 매크로 만들기"
            textSize = 12.5f
            isAllCaps = false
            setTextColor(palette.accentFg)
            backgroundTintList = ColorStateList.valueOf(palette.accentBg)
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dpToPx(44)).apply { topMargin = dpToPx(10) }
            setOnClickListener {
                dialog.dismiss()
                createMacroFromCurrentTabs()
            }
        }
        container.addView(create)

        dialog.setContentView(container)
        dialog.show()
    }

    // ==================== v2.2.0: 사이드바 인라인 목록 패널 ====================

    private fun openSidebarList(type: String) {
        if (!isTabletLayout() || !::layoutSidebar.isInitialized || layoutSidebar.visibility != View.VISIBLE) {
            when (type) {
                "bag" -> showBagDialog()
                "downloads" -> showDownloadsDialog()
                "history" -> showHistoryDialog()
                "security" -> showSecurityInfoDialog()
                "macro" -> showMacroDialog()
            }
            return
        }
        sidebarListType = type
        switchSidebarTab("list")
        renderSidebarList()
    }

    private fun sidebarListRow(title: String, subtitle: String, actions: List<Pair<String, () -> Unit>>): LinearLayout {
        val palette = sidebarPalette(getAppThemeMode())
        val row = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dpToPx(10), dpToPx(8), dpToPx(10), dpToPx(8))
            setBackgroundResource(palette.cardDrawable)
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { bottomMargin = dpToPx(6) }
        }
        row.addView(TextView(this).apply {
            text = title
            textSize = 12.5f
            setTypeface(null, android.graphics.Typeface.BOLD)
            setTextColor(palette.textPrimary)
            maxLines = 2
            ellipsize = android.text.TextUtils.TruncateAt.END
        })
        row.addView(TextView(this).apply {
            text = subtitle
            textSize = 10.5f
            setTextColor(palette.textSecondary)
            maxLines = 1
            ellipsize = android.text.TextUtils.TruncateAt.END
            setPadding(0, dpToPx(2), 0, 0)
        })
        if (actions.isNotEmpty()) {
            val actionRow = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                setPadding(0, dpToPx(6), 0, 0)
            }
            for ((label, action) in actions) {
                actionRow.addView(TextView(this).apply {
                    text = label
                    textSize = 10.5f
                    setPadding(dpToPx(10), dpToPx(5), dpToPx(10), dpToPx(5))
                    setBackgroundResource(R.drawable.bg_pill_badge)
                    backgroundTintList = ColorStateList.valueOf(palette.headerBg)
                    setTextColor(palette.textPrimary)
                    layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { marginEnd = dpToPx(5) }
                    setOnClickListener { action() }
                })
            }
            row.addView(actionRow)
        }
        return row
    }

    private fun renderSidebarList() {
        if (!::layoutSidebarListContainer.isInitialized) return
        val palette = sidebarPalette(getAppThemeMode())
        val container = layoutSidebarListContainer
        container.removeAllViews()
        btnSidebarListAction.visibility = View.GONE
        when (sidebarListType) {
            "bag" -> {
                tvSidebarListTitle.text = "My Bag"
                val items = getSavedBagItems()
                btnSidebarListAction.text = "현재 페이지 담기"
                btnSidebarListAction.visibility = View.VISIBLE
                btnSidebarListAction.setOnClickListener {
                    addCurrentPageToBag()
                    renderSidebarList()
                }
                if (items.isEmpty()) {
                    container.addView(TextView(this).apply {
                        text = "아직 스크랩한 항목이 없습니다. 링크·이미지·텍스트를 My Bag에 담아 보세요."
                        textSize = 11.5f
                        setTextColor(palette.textSecondary)
                    })
                }
                for (item in items) {
                    container.addView(sidebarListRow(item.title, item.type + " · " + shortHost(item.sourceUrl), listOf(
                        "열기" to { if (item.type == "image") loadWebQuery(item.content) else loadWebQuery(item.content) },
                        "복사" to {
                            val clip = getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager
                            clip?.setPrimaryClip(android.content.ClipData.newPlainText("My Bag", item.content))
                            Toast.makeText(this, "복사했습니다", Toast.LENGTH_SHORT).show()
                        },
                        "삭제" to { deleteBagItem(item.id); renderSidebarList() }
                    )))
                }
            }
            "downloads" -> {
                tvSidebarListTitle.text = "다운로드"
                val items = getSavedDownloads()
                btnSidebarListAction.text = "전체 삭제"
                btnSidebarListAction.visibility = if (items.isEmpty()) View.GONE else View.VISIBLE
                btnSidebarListAction.setOnClickListener { clearDownloads(); renderSidebarList() }
                if (items.isEmpty()) {
                    container.addView(TextView(this).apply {
                        text = "다운로드한 파일이 없습니다."
                        textSize = 11.5f
                        setTextColor(palette.textSecondary)
                    })
                }
                for (file in items) {
                    val sizeText = if (file.size > 0) String.format("%.1f MB", file.size / 1024f / 1024f) else shortHost(file.url)
                    container.addView(sidebarListRow(file.filename, sizeText, listOf(
                        "열기" to { openDownloadedFile(file) },
                        "삭제" to {
                            deleteDownloadItem(file.filename)
                            runCatching { File(file.path).delete() }
                            renderSidebarList()
                        }
                    )))
                }
            }
            "history" -> {
                tvSidebarListTitle.text = "방문 기록"
                val items = getSavedHistory()
                btnSidebarListAction.text = "전체 삭제"
                btnSidebarListAction.visibility = if (items.isEmpty()) View.GONE else View.VISIBLE
                btnSidebarListAction.setOnClickListener {
                    getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit().remove("saved_history_json").apply()
                    renderSidebarList()
                    Toast.makeText(this, "방문 기록을 모두 지웠습니다", Toast.LENGTH_SHORT).show()
                }
                if (items.isEmpty()) {
                    container.addView(TextView(this).apply {
                        text = "방문 기록이 없습니다."
                        textSize = 11.5f
                        setTextColor(palette.textSecondary)
                    })
                }
                for (entry in items) {
                    container.addView(sidebarListRow(entry.title, shortHost(entry.url), listOf(
                        "열기" to { loadWebQuery(entry.url) }
                    )))
                }
            }
            "security" -> {
                tvSidebarListTitle.text = "보안 현황"
                val url = getCurrentWebView().url ?: ""
                val isHttps = url.startsWith("https://")
                val host = shortHost(url)
                val cookieCount = try {
                    CookieManager.getInstance().getCookie(url)?.split(";")?.count { it.isNotBlank() } ?: 0
                } catch (e: Exception) { 0 }
                val secureCount = try {
                    CookieManager.getInstance().getCookie(url)?.split(";")?.count { it.contains("secure", true) } ?: 0
                } catch (e: Exception) { 0 }
                container.addView(sidebarListRow(
                    if (isHttps) "HTTPS 보안 연결" else "보안 연결 아님",
                    host.ifBlank { "현재 페이지 없음" },
                    listOf("상세 보기" to { showSecurityInfoDialog() })
                ))
                container.addView(sidebarListRow("SSL 인증서", if (isHttps) "TLS 암호화 연결 · 인증서 유효" else "암호화되지 않은 연결", emptyList()))
                container.addView(sidebarListRow("쿠키", "전체 " + cookieCount + "개 · 보안 쿠키 " + secureCount + "개", emptyList()))
                container.addView(sidebarListRow("보안 탭", "쿠키와 기록을 남기지 않는 비공개 탭", listOf("새 보안 탭" to { addNewTab(START_PAGE_URL, true, isSecurity = true) })))
                container.addView(sidebarListRow("추적 차단", if (isAdBlockEnabled()) "광고·트래커 차단 켜짐" else "광고·트래커 차단 꺼짐", listOf("전환" to {
                    setAdBlockEnabled(!isAdBlockEnabled())
                    getCurrentWebView().reload()
                    renderSidebarList()
                })))
            }
            "macro" -> {
                tvSidebarListTitle.text = "웹 액션 매크로"
                val macros = getMacros()
                btnSidebarListAction.text = "현재 탭으로 만들기"
                btnSidebarListAction.visibility = View.VISIBLE
                btnSidebarListAction.setOnClickListener { createMacroFromCurrentTabs() }
                if (macros.isEmpty()) {
                    container.addView(TextView(this).apply {
                        text = "자주 쓰는 동선을 탭 순서대로 묶어 두면 한 번에 열 수 있습니다."
                        textSize = 11.5f
                        setTextColor(palette.textSecondary)
                    })
                }
                for (macro in macros) {
                    container.addView(sidebarListRow(
                        macro.name,
                        macro.steps.size.toString() + "단계 · " + macro.steps.joinToString(" › ") { it.title.take(12) },
                        listOf(
                            "실행" to { runMacro(macro) },
                            "삭제" to {
                                saveMacros(getMacros().filter { it.id != macro.id })
                                renderSidebarList()
                            }
                        )
                    ))
                }
            }
        }
    }

    // ==================== v2.2.0: My Bag 리서치 캔버스 ====================

    data class CanvasCard(
        val id: String,
        var kind: String,
        var title: String,
        var body: String,
        var url: String,
        var x: Float,
        var y: Float
    )

    private fun getCanvasCards(): MutableList<CanvasCard> {
        val raw = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).getString("research_canvas_cards", "[]") ?: "[]"
        val list = mutableListOf<CanvasCard>()
        try {
            val arr = JSONArray(raw)
            for (i in 0 until arr.length()) {
                val o = arr.getJSONObject(i)
                list.add(CanvasCard(
                    o.optString("id", "card_$i"),
                    o.optString("kind", "memo"),
                    o.optString("title", ""),
                    o.optString("body", ""),
                    o.optString("url", ""),
                    o.optDouble("x", 0.0).toFloat(),
                    o.optDouble("y", 0.0).toFloat()
                ))
            }
        } catch (e: Exception) {
        }
        return list
    }

    private fun getCanvasLinks(): MutableList<Pair<String, String>> {
        val raw = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).getString("research_canvas_links", "[]") ?: "[]"
        val list = mutableListOf<Pair<String, String>>()
        try {
            val arr = JSONArray(raw)
            for (i in 0 until arr.length()) {
                val pair = arr.getJSONArray(i)
                list.add(pair.getString(0) to pair.getString(1))
            }
        } catch (e: Exception) {
        }
        return list
    }

    private fun saveCanvasState(cards: List<CanvasCard>, links: List<Pair<String, String>>) {
        val cardArr = JSONArray()
        for (c in cards) {
            cardArr.put(JSONObject().apply {
                put("id", c.id)
                put("kind", c.kind)
                put("title", c.title)
                put("body", c.body)
                put("url", c.url)
                put("x", c.x.toDouble())
                put("y", c.y.toDouble())
            })
        }
        val linkArr = JSONArray()
        for (l in links) {
            linkArr.put(JSONArray().apply {
                put(l.first)
                put(l.second)
            })
        }
        getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit()
            .putString("research_canvas_cards", cardArr.toString())
            .putString("research_canvas_links", linkArr.toString())
            .apply()
    }

    private fun openResearchCanvas() {
        layoutResearchCanvas.visibility = View.VISIBLE
        layoutResearchCanvas.alpha = 0f
        layoutResearchCanvas.animate().alpha(1f).setDuration(200).start()
        val palette = sidebarPalette(getAppThemeMode())
        findViewById<View>(R.id.layoutCanvasHeader)?.setBackgroundColor(palette.headerBg)
        findViewById<TextView>(R.id.tvCanvasHint)?.setTextColor(palette.textSecondary)
        findViewById<TextView>(R.id.tvCanvasHint)?.setBackgroundColor(palette.bg)
        findViewById<TextView>(R.id.tvCanvasTitle)?.setTextColor(palette.textPrimary)
        findViewById<ImageView>(R.id.btnCanvasClose)?.imageTintList = ColorStateList.valueOf(palette.textPrimary)
        layoutResearchCanvas.setBackgroundColor(palette.bg)
        if (canvasView == null) {
            val v = ResearchCanvasView(this)
            canvasBoardHost.addView(v, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
            canvasView = v
        }
        canvasView?.reload()
    }

    private fun closeResearchCanvas() {
        layoutResearchCanvas.animate().alpha(0f).setDuration(160).withEndAction {
            layoutResearchCanvas.visibility = View.GONE
        }.start()
        canvasView?.persist()
    }

    private fun addMemoToCanvas() {
        val palette = sidebarPalette(getAppThemeMode())
        val input = EditText(this).apply {
            hint = "메모 내용"
            textSize = 13f
            setTextColor(palette.textPrimary)
            setHintTextColor(palette.textSecondary)
            setPadding(dpToPx(12), dpToPx(10), dpToPx(12), dpToPx(10))
            setBackgroundResource(palette.inputDrawable)
        }
        val holder = FrameLayout(this).apply {
            setPadding(dpToPx(20), dpToPx(16), dpToPx(20), dpToPx(8))
            addView(input)
        }
        AlertDialog.Builder(this)
            .setTitle("메모 카드 추가")
            .setView(holder)
            .setPositiveButton("추가") { _, _ ->
                val text = input.text.toString().trim()
                if (text.isNotBlank()) {
                    val view = canvasView ?: return@setPositiveButton
                    view.addCard(CanvasCard(
                        "memo_" + System.currentTimeMillis(),
                        "memo",
                        if (text.length > 18) text.take(18) else text,
                        text,
                        "",
                        view.nextX(),
                        view.nextY()
                    ))
                }
            }
            .setNegativeButton("취소", null)
            .show()
    }

    private fun addBagCardsToCanvas() {
        val view = canvasView ?: return
        val existing = view.cardIds()
        val items = getSavedBagItems()
        var added = 0
        for (item in items) {
            if (existing.contains(item.id)) continue
            view.addCard(CanvasCard(
                item.id,
                "bag",
                item.title,
                item.content,
                item.sourceUrl,
                view.nextX(),
                view.nextY()
            ))
            added++
        }
        Toast.makeText(
            this,
            if (added == 0) "이미 모든 Bag 항목이 캔버스에 있습니다" else added.toString() + "개 카드를 추가했습니다",
            Toast.LENGTH_SHORT
        ).show()
    }


    private fun openDownloadedFile(file: DownloadedFileItem) {
        try {
            val f = File(file.path)
            if (!f.exists()) {
                Toast.makeText(this, "파일을 찾을 수 없습니다", Toast.LENGTH_SHORT).show()
                return
            }
            val uri = FileProvider.getUriForFile(this, "com.cream.browser.fileprovider", f)
            val mime = android.webkit.MimeTypeMap.getSingleton()
                .getMimeTypeFromExtension(f.extension.lowercase(Locale.ROOT)) ?: "*/*"
            val intent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, mime)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            startActivity(intent)
        } catch (e: Exception) {
            Toast.makeText(this, "파일을 열 수 없습니다", Toast.LENGTH_SHORT).show()
        }
    }

    private inner class ResearchCanvasView(context: Context) : View(context) {
        private val cards = mutableListOf<CanvasCard>()
        private val links = mutableListOf<Pair<String, String>>()
        private var dragging: CanvasCard? = null
        private var dragDx = 0f
        private var dragDy = 0f
        private var linkMode = false
        private var linkSource: String? = null
        private var cardW = 0f
        private var cardH = 0f
        private val density = resources.displayMetrics.density

        private val cardPaint = android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG)
        private val titlePaint = android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG).apply {
            textSize = 12.5f * density
            typeface = android.graphics.Typeface.create(android.graphics.Typeface.DEFAULT, android.graphics.Typeface.BOLD)
        }
        private val bodyPaint = android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG).apply {
            textSize = 10.5f * density
        }
        private val linkPaint = android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG).apply {
            strokeWidth = 2f * density
            style = android.graphics.Paint.Style.STROKE
        }

        init {
            reload()
        }

        fun reload() {
            cards.clear()
            links.clear()
            cards.addAll(getCanvasCards())
            links.addAll(getCanvasLinks())
            invalidate()
        }

        fun persist() {
            saveCanvasState(cards, links)
        }

        fun cardIds(): Set<String> = cards.map { it.id }.toSet()

        fun nextX(): Float = 24f * density + ((cards.size % 3) * 36f * density)
        fun nextY(): Float = 24f * density + ((cards.size % 4) * 30f * density)

        fun addCard(card: CanvasCard) {
            cards.add(card)
            persist()
            invalidate()
        }

        fun linkModeActive(): Boolean = linkMode

        fun setLinkMode(enabled: Boolean) {
            linkMode = enabled
            linkSource = null
            invalidate()
        }

        override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
            super.onSizeChanged(w, h, oldw, oldh)
            cardW = (w * 0.30f).coerceIn(150f * density, 230f * density)
            cardH = 78f * density
            if (cards.any { it.x == 0f && it.y == 0f }) {
                cards.forEachIndexed { i, c ->
                    if (c.x == 0f && c.y == 0f) {
                        c.x = nextX() + (i % 2) * cardW * 0.9f
                        c.y = nextY() + (i / 2) * (cardH + 18f * density)
                    }
                    c.x = c.x.coerceIn(0f, (w - cardW).coerceAtLeast(0f))
                    c.y = c.y.coerceIn(0f, (h - cardH).coerceAtLeast(0f))
                }
            }
        }

        private fun hit(x: Float, y: Float): CanvasCard? =
            cards.lastOrNull { x >= it.x && x <= it.x + cardW && y >= it.y && y <= it.y + cardH }

        @SuppressLint("ClickableViewAccessibility")
        override fun onTouchEvent(event: MotionEvent): Boolean {
            when (event.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    val hitCard = hit(event.x, event.y)
                    if (linkMode) {
                        if (hitCard != null) {
                            val src = linkSource
                            if (src == null) {
                                linkSource = hitCard.id
                            } else if (src != hitCard.id) {
                                links.add(src to hitCard.id)
                                linkSource = null
                                persist()
                            }
                            invalidate()
                        }
                        return true
                    }
                    if (hitCard != null) {
                        dragging = hitCard
                        dragDx = event.x - hitCard.x
                        dragDy = event.y - hitCard.y
                        cards.remove(hitCard)
                        cards.add(hitCard)
                        invalidate()
                    }
                    return true
                }
                MotionEvent.ACTION_MOVE -> {
                    dragging?.let { c ->
                        c.x = (event.x - dragDx).coerceIn(0f, (width - cardW).coerceAtLeast(0f))
                        c.y = (event.y - dragDy).coerceIn(0f, (height - cardH).coerceAtLeast(0f))
                        invalidate()
                    }
                    return true
                }
                MotionEvent.ACTION_UP -> {
                    dragging?.let {
                        persist()
                        if (event.eventTime - event.downTime < 180) {
                            maybeOpen(it)
                        }
                    }
                    dragging = null
                    return true
                }
            }
            return true
        }

        private var lastTapTime = 0L
        private var lastTapCard: String? = null

        private fun maybeOpen(card: CanvasCard) {
            if (card.url.isBlank()) return
            val now = System.currentTimeMillis()
            if (lastTapCard == card.id && now - lastTapTime < 320) {
                loadWebQuery(card.url)
                closeResearchCanvas()
            }
            lastTapCard = card.id
            lastTapTime = now
        }

        override fun onDraw(canvas: Canvas) {
            super.onDraw(canvas)
            val palette = sidebarPalette(getAppThemeMode())
            if (cardW <= 0f) cardW = width * 0.3f
            if (cardH <= 0f) cardH = 78f * density

            linkPaint.color = palette.divider
            for ((a, b) in links) {
                val ca = cards.find { it.id == a }
                val cb = cards.find { it.id == b }
                if (ca != null && cb != null) {
                    canvas.drawLine(ca.x + cardW / 2f, ca.y + cardH / 2f, cb.x + cardW / 2f, cb.y + cardH / 2f, linkPaint)
                }
            }

            for (card in cards) {
                val rect = android.graphics.RectF(card.x, card.y, card.x + cardW, card.y + cardH)
                cardPaint.style = android.graphics.Paint.Style.FILL
                cardPaint.color = palette.headerBg
                canvas.drawRoundRect(rect, 8f * density, 8f * density, cardPaint)
                cardPaint.style = android.graphics.Paint.Style.STROKE
                cardPaint.strokeWidth = if (linkSource == card.id) 2.2f * density else 1f * density
                cardPaint.color = if (linkSource == card.id) palette.accentBg else palette.divider
                canvas.drawRoundRect(rect, 8f * density, 8f * density, cardPaint)

                cardPaint.style = android.graphics.Paint.Style.FILL
                cardPaint.color = if (card.kind == "memo") palette.accentBg else palette.divider
                canvas.drawRoundRect(android.graphics.RectF(card.x, card.y, card.x + 4f * density, card.y + cardH), 2f * density, 2f * density, cardPaint)

                titlePaint.color = palette.textPrimary
                bodyPaint.color = palette.textSecondary
                canvas.drawText(ellipsize(card.title, titlePaint, cardW - 18f * density), card.x + 12f * density, card.y + 24f * density, titlePaint)
                var lineY = card.y + 42f * density
                val body = if (card.kind == "memo") card.body else card.body
                var remaining = body
                var lineCount = 0
                while (remaining.isNotEmpty() && lineCount < 2) {
                    val line = takeLine(remaining, bodyPaint, cardW - 18f * density)
                    canvas.drawText(line, card.x + 12f * density, lineY, bodyPaint)
                    remaining = remaining.removePrefix(line).trimStart()
                    lineY += 14f * density
                    lineCount++
                }
                if (card.url.isNotBlank()) {
                    canvas.drawText(shortHost(card.url), card.x + 12f * density, card.y + cardH - 9f * density, bodyPaint)
                }
            }
        }

        private fun ellipsize(text: String, paint: android.graphics.Paint, maxWidth: Float): String {
            if (paint.measureText(text) <= maxWidth) return text
            var end = text.length
            while (end > 1 && paint.measureText(text.substring(0, end) + "…") > maxWidth) end--
            return text.substring(0, end) + "…"
        }

        private fun takeLine(text: String, paint: android.graphics.Paint, maxWidth: Float): String {
            if (paint.measureText(text) <= maxWidth) return text
            var end = text.length
            while (end > 1 && paint.measureText(text.substring(0, end)) > maxWidth) end--
            return text.substring(0, end)
        }
    }

    inner class WebAppInterface(private val activity: MainActivity, private val webView: WebView? = null) {
        @JavascriptInterface
        fun onTokenReceived(token: String) {
            activity.runOnUiThread {
                activity.updateBase44Token(token)
            }
        }

        @JavascriptInterface
        fun loadUrl(url: String) {
            activity.runOnUiThread {
                activity.loadWebQuery(url)
            }
        }

        @JavascriptInterface
        fun openSecurityTab() {
            activity.runOnUiThread {
                activity.addNewTab(activity.START_PAGE_URL, makeActive = true, isSecurity = true)
            }
        }

        @JavascriptInterface
        fun openSidebarAi() {
            activity.runOnUiThread {
                if (activity.isTabletLayout()) {
                    activity.switchSidebarTab("ai")
                    if (activity.layoutSidebar.visibility != View.VISIBLE) activity.toggleSidebar("ai")
                } else {
                    activity.showCreamyBottomSheet()
                }
            }
        }

        @JavascriptInterface
        fun openQrScanner() {
            activity.runOnUiThread {
                activity.openQrScanner()
            }
        }

        @JavascriptInterface
        fun openSecurityDashboard() {
            activity.runOnUiThread {
                activity.showSecurityInfoDialog()
            }
        }

        @JavascriptInterface
        fun openSettings() {
            activity.runOnUiThread {
                activity.showSettingsDialog()
            }
        }

        @JavascriptInterface
        fun openBriefing() {
            activity.runOnUiThread {
                if (activity.isTabletLayout()) {
                    activity.switchSidebarTab("ai")
                    if (activity.layoutSidebar.visibility != View.VISIBLE) activity.toggleSidebar("ai")
                } else {
                    activity.showCreamyBottomSheet()
                }
            }
        }

        @JavascriptInterface
        fun getTheme(): String {
            return activity.getAppThemeMode()
        }

        @JavascriptInterface
        fun setTheme(theme: String) {
            activity.runOnUiThread {
                activity.setAppThemeMode(theme)
            }
        }

        @JavascriptInterface
        fun getUserName(): String {
            return activity.getUserNickname()
        }

        @JavascriptInterface
        fun setUserName(name: String) {
            activity.runOnUiThread {
                activity.setUserNickname(name)
            }
        }

        @JavascriptInterface
        fun getSearchEngine(): String {
            return activity.getSearchEngine()
        }

        @JavascriptInterface
        fun getCustomAccent(): String {
            return activity.getCustomAccentHex()
        }

        @JavascriptInterface
        fun getWidgetColorful(): Boolean {
            return activity.isWidgetColorfulEnabled()
        }

        @JavascriptInterface
        fun setWidgetColorful(enabled: Boolean) {
            activity.runOnUiThread {
                activity.setWidgetColorfulEnabled(enabled)
            }
        }

        @JavascriptInterface
        fun pickCustomBackgroundImage() {
            activity.runOnUiThread {
                activity.pickCustomBackgroundImage()
            }
        }


        @JavascriptInterface
        fun fetchUrl(url: String, callbackId: String) {
            deliverWidgetFetch(url, callbackId, true)
        }

        // 위젯별 새로고침 버튼용: 네이티브 캐시를 건너뛰고 바로 다시 요청한다
        @JavascriptInterface
        fun fetchUrlFresh(url: String, callbackId: String) {
            deliverWidgetFetch(url, callbackId, false)
        }

        private fun deliverWidgetFetch(url: String, callbackId: String, useCache: Boolean) {
            val target = webView ?: return
            // 시작페이지 위젯이 쓰는 데이터 제공처만 허용한다
            val host = try { Uri.parse(url).host?.lowercase(Locale.ROOT) ?: "" } catch (e: Exception) { "" }
            val allowedHosts = setOf(
                "api.open-meteo.com", "geocoding-api.open-meteo.com", "news.google.com",
                "polling.finance.naver.com", "m.stock.naver.com", "router.project-osrm.org",
                "nominatim.openstreetmap.org", "site.api.espn.com"
            )
            if (!url.startsWith("https://") || host !in allowedHosts) return
            Thread {
                val body = try {
                    if (useCache) httpGetCached(url) else httpGet(url)
                } catch (e: Exception) { null }
                val clipped = if (body != null && body.length > 320_000) body.substring(0, 320_000) else body
                target.post {
                    val payload = if (clipped == null) "null" else JSONObject.quote(clipped)
                    val status = if (clipped == null) 0 else 200
                    target.evaluateJavascript(
                        "if (window.__creamyFetch) window.__creamyFetch(" + JSONObject.quote(callbackId) + ", " + status + ", " + payload + ");",
                        null
                    )
                }
            }.start()
        }

        @JavascriptInterface
        fun openMacro() {
            activity.runOnUiThread { activity.showMacroDialog() }
        }

        @JavascriptInterface
        fun openResearchCanvas() {
            activity.runOnUiThread { activity.openResearchCanvas() }
        }

        @JavascriptInterface
        fun isTablet(): Boolean = activity.isTabletLayout()

        @JavascriptInterface
        fun clearCustomBackgroundImage() {
            activity.runOnUiThread {
                activity.clearCustomStartBackground()
                Toast.makeText(activity, "배경 이미지가 초기화되었습니다", Toast.LENGTH_SHORT).show()
            }
        }
    }
}
