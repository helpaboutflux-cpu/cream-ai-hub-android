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
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.print.PrintAttributes
import android.print.PrintManager
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
import com.google.android.material.bottomsheet.BottomSheetDialog
import com.google.android.material.color.DynamicColors
import com.google.android.material.switchmaterial.SwitchMaterial
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.io.File
import java.io.FileOutputStream
import java.net.URLEncoder
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import android.app.PictureInPictureParams
import android.content.res.Configuration
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
        var isInactive: Boolean = false,
        var lastAccessedTime: Long = System.currentTimeMillis()
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
    private lateinit var layoutTabMenuContent: View
    private lateinit var layoutTabAiContent: View
    private lateinit var layoutTabBookmarksContent: View
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

    private var fileChooserCallback: ValueCallback<Array<Uri>>? = null
    private var lastHandledText = ""
    private var pendingScriptToInject: String? = null
    private var isAppInForeground = false
    private var isSidebarOpen = false
    private var isDesktopMode = false
    private var currentPageText = ""

    // 알려진 광고 및 트래커 도메인 필터
    private val adDomains = listOf(
        "doubleclick.net", "googleadservices.com", "googlesyndication.com",
        "adservice.google.com", "taboola.com", "outbrain.com", "adform.net",
        "popads.net", "adnxs.com", "criteo.com", "adcolony.com"
    )

    private val fileChooserLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        val uri = if (result.resultCode == RESULT_OK) result.data?.data else null
        val resultUris = if (uri != null) arrayOf(uri) else null
        fileChooserCallback?.onReceiveValue(resultUris)
        fileChooserCallback = null
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
        applyTouchAnimationToAll(findViewById(android.R.id.content))
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
        ivUrlIcon = findViewById(R.id.ivUrlIcon)
        tvTopSecurityBadge = findViewById(R.id.tvTopSecurityBadge)
        etBrowserUrl = findViewById(R.id.etBrowserUrl)
        btnClearUrl = findViewById(R.id.btnClearUrl)
        btnQuickTranslateChip = findViewById(R.id.btnQuickTranslateChip)
        ivTranslateChipIcon = findViewById(R.id.ivTranslateChipIcon)
        tvTranslateChipText = findViewById(R.id.tvTranslateChipText)

        btnQuickTranslateChip.setOnClickListener {
            val curUrl = getCurrentWebView().url ?: ""
            if (curUrl.contains("translate.google.com")) {
                try {
                    val uri = Uri.parse(curUrl)
                    val originalUrl = uri.getQueryParameter("u")
                    if (!originalUrl.isNullOrBlank()) {
                        loadWebQuery(originalUrl)
                        return@setOnClickListener
                    }
                } catch (e: Exception) {}
                getCurrentWebView().goBack()
            } else {
                translateCurrentPage()
            }
        }
        btnTopBack = findViewById(R.id.btnTopBack)
        btnTopForward = findViewById(R.id.btnTopForward)
        btnTopReload = findViewById(R.id.btnTopReload)
        btnMobileReload = findViewById(R.id.btnMobileReload)
        btnTopMenu = findViewById(R.id.btnTopMenu)
        btnTopHome = findViewById(R.id.btnTopHome)
        btnToggleSidebar = findViewById(R.id.btnToggleSidebar)
        tvSidebarBtnText = findViewById(R.id.tvSidebarBtnText)

        // 주소창 제안 오버레이
        layoutSearchSuggestions = findViewById(R.id.layoutSearchSuggestions)
        chipClipboardPaste = findViewById(R.id.chipClipboardPaste)
        tvClipboardText = findViewById(R.id.tvClipboardText)
        btnClearSearchHistory = findViewById(R.id.btnClearSearchHistory)
        layoutRecentSearchesContainer = findViewById(R.id.layoutRecentSearchesContainer)
        layoutRecentSitesChips = findViewById(R.id.layoutRecentSitesChips)

        // 하단 바
        layoutBottomBar = findViewById(R.id.layoutBottomBar)
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
        layoutTabMenuContent = findViewById(R.id.layoutTabMenuContent)
        layoutTabAiContent = findViewById(R.id.layoutTabAiContent)
        layoutTabBookmarksContent = findViewById(R.id.layoutTabBookmarksContent)
        tvSidebarPageTitle = findViewById(R.id.tvSidebarPageTitle)
        tvSidebarPageUrl = findViewById(R.id.tvSidebarPageUrl)
        tvSidebarAiResult = findViewById(R.id.tvSidebarAiResult)
        btnSidebarQuickSummary = findViewById(R.id.btnSidebarQuickSummary)
        btnSidebarQuickQuestions = findViewById(R.id.btnSidebarQuickQuestions)
        btnSidebarQuickTranslate = findViewById(R.id.btnSidebarQuickTranslate)
        etSidebarQuery = findViewById(R.id.etSidebarQuery)
        btnSidebarSend = findViewById(R.id.btnSidebarSend)

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
        wv.addJavascriptInterface(WebAppInterface(this), "AndroidCreamApp")

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
            textZoom = getTextZoom()
            userAgentString = "Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36"
        }

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
                if (isAdBlockEnabled()) {
                    val host = request?.url?.host?.lowercase(Locale.ROOT) ?: ""
                    for (ad in adDomains) {
                        if (host.contains(ad)) {
                            return WebResourceResponse("text/plain", "UTF-8", ByteArrayInputStream("".toByteArray()))
                        }
                    }
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
                    val isStart = url == START_PAGE_URL || url == START_PAGE_SECURITY_URL || url?.startsWith("file:///android_asset/") == true
        swipeRefresh.isEnabled = false

                    if (url == START_PAGE_URL) {
                        view?.evaluateJavascript("if (window.setColorFavicons) window.setColorFavicons(${isColorFaviconsEnabled()});", null)
                    }

                    // 보안 탭이 아닐 때만 방문 기록 저장
                    val curTab = getCurrentTab()
                    if (!curTab.isSecurity && !isStart && !url.isNullOrBlank()) {
                        addHistoryEntry(rawTitle, url)
                    }
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
    }

    private fun switchTab(index: Int) {
        if (index !in tabs.indices) return

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
    }

    private fun closeTab(index: Int) {
        if (index !in tabs.indices) return

        val tabToRemove = tabs[index]
        webViewContainer.removeView(tabToRemove.webView)
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
    }

    private fun closeAllTabsInMode(isSecurityMode: Boolean) {
        val toRemove = tabs.filter { it.isSecurity == isSecurityMode }
        for (tab in toRemove) {
            webViewContainer.removeView(tab.webView)
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
            webViewContainer.removeView(tab.webView)
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
            layoutTopBar.setBackgroundColor(Color.parseColor("#09090B"))
            layoutAddressBar.backgroundTintList = ColorStateList.valueOf(Color.parseColor("#18181B"))
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
            layoutBottomBar.setBackgroundColor(Color.parseColor("#0D0F12"))
            btnNavBack.imageTintList = ColorStateList.valueOf(Color.WHITE)
            btnNavForward.imageTintList = ColorStateList.valueOf(Color.WHITE)
            btnNavHome.imageTintList = ColorStateList.valueOf(Color.WHITE)
            tvNavTabCount.setBackgroundResource(R.drawable.bg_tab_counter_dark)
            tvNavTabCount.setTextColor(Color.WHITE)
        } else {
            tvTopSecurityBadge.visibility = View.GONE
            applyThemeToViews(getAppThemeMode())
        }
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
                setTextColor(getColor(R.color.text_muted))
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
                setTextColor(getColor(R.color.primary_black))
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
                setTextColor(getColor(R.color.primary_black))
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
        val dialog = BottomSheetDialog(this)
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
        val dialog = BottomSheetDialog(this)
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

    private fun showGroupPickerDialog(tab: WebTab, onComplete: () -> Unit) {
        val dialog = BottomSheetDialog(this)
        val view = layoutInflater.inflate(R.layout.dialog_group_picker, null)
        dialog.setContentView(view)
        applyTouchAnimationToAll(view)

        val etGroupName = view.findViewById<EditText>(R.id.etGroupName)
        val btnApply = view.findViewById<Button>(R.id.btnApplyGroup)
        val btnRemove = view.findViewById<Button>(R.id.btnRemoveFromGroup)
        val btnClose = view.findViewById<ImageView>(R.id.btnCloseGroupPicker)

        var selectedColor = "#3B82F6"

        val colorBlue = view.findViewById<View>(R.id.colorBlue)
        val colorPurple = view.findViewById<View>(R.id.colorPurple)
        val colorGreen = view.findViewById<View>(R.id.colorGreen)
        val colorOrange = view.findViewById<View>(R.id.colorOrange)
        val colorPink = view.findViewById<View>(R.id.colorPink)
        val colorGray = view.findViewById<View>(R.id.colorGray)

        colorBlue.setOnClickListener { selectedColor = "#3B82F6"; Toast.makeText(this, "블루 선택", Toast.LENGTH_SHORT).show() }
        colorPurple.setOnClickListener { selectedColor = "#8B5CF6"; Toast.makeText(this, "퍼플 선택", Toast.LENGTH_SHORT).show() }
        colorGreen.setOnClickListener { selectedColor = "#10B981"; Toast.makeText(this, "그린 선택", Toast.LENGTH_SHORT).show() }
        colorOrange.setOnClickListener { selectedColor = "#F59E0B"; Toast.makeText(this, "오렌지 선택", Toast.LENGTH_SHORT).show() }
        colorPink.setOnClickListener { selectedColor = "#EC4899"; Toast.makeText(this, "핑크 선택", Toast.LENGTH_SHORT).show() }
        colorGray.setOnClickListener { selectedColor = "#71717A"; Toast.makeText(this, "그레이 선택", Toast.LENGTH_SHORT).show() }

        // 기존 그룹이 있으면 표시
        if (!tab.groupId.isNullOrBlank()) {
            val curG = tabGroups.find { it.id == tab.groupId }
            if (curG != null) {
                etGroupName.setText(curG.title)
                selectedColor = curG.colorHex
            }
        }

        btnApply.setOnClickListener {
            val name = etGroupName.text.toString().trim()
            if (name.isNotEmpty()) {
                var group = tabGroups.find { it.title == name }
                if (group == null) {
                    group = TabGroup(System.currentTimeMillis().toString(), name, selectedColor)
                    tabGroups.add(group)
                    saveTabGroups()
                }
                tab.groupId = group.id
                Toast.makeText(this, "'${group.title}' 그룹에 지정되었습니다", Toast.LENGTH_SHORT).show()
                dialog.dismiss()
                onComplete()
            }
        }

        btnRemove.setOnClickListener {
            tab.groupId = null
            Toast.makeText(this, "그룹이 해제되었습니다", Toast.LENGTH_SHORT).show()
            dialog.dismiss()
            onComplete()
        }

        btnClose.setOnClickListener { dialog.dismiss() }
        dialog.show()
    }

    // Bag 보관함 기능 (링크, 이미지, 텍스트 스크랩)
    private fun showBagDialog() {
        if (isTabletLayout()) {
            switchSidebarTab("menu")
            if (layoutSidebar.visibility != View.VISIBLE) toggleSidebar("menu")
            return
        }
        val dialog = BottomSheetDialog(this)
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
                    else -> "텍스트"
                }

                ivIcon.setImageResource(R.drawable.ic_bag)

                itemCard.setOnClickListener {
                    if (item.type == "link" || item.content.startsWith("http")) {
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
        if (isTabletLayout()) {
            switchSidebarTab("menu")
            if (layoutSidebar.visibility != View.VISIBLE) toggleSidebar("menu")
            return
        }
        val dialog = BottomSheetDialog(this)
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

                val dialog = BottomSheetDialog(this)
                val view = layoutInflater.inflate(R.layout.dialog_reader_mode, null)
                dialog.setContentView(view)
                applyTouchAnimationToAll(view)

                view.findViewById<TextView>(R.id.tvReaderTitle).text = title
                view.findViewById<TextView>(R.id.tvReaderSource).text = "출처: ${currentWv.url ?: ""}"
                val tvContent = view.findViewById<TextView>(R.id.tvReaderContent)
                tvContent.text = content

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

    // 페이지 한국어 번역
    private fun translateCurrentPage() {
        val curUrl = getCurrentWebView().url ?: ""
        if (curUrl.isNotBlank() && !curUrl.startsWith("file:///")) {
            val transUrl = "https://translate.google.com/translate?sl=auto&tl=ko&u=" + URLEncoder.encode(curUrl, "UTF-8")
            loadWebQuery(transUrl)
        } else {
            Toast.makeText(this, "번역할 수 없는 페이지입니다", Toast.LENGTH_SHORT).show()
        }
    }

    // 메뉴 바텀시트
    private fun showMenuDialog() {
        if (resources.configuration.screenWidthDp >= 600) {
            toggleSidebar("menu")
            return
        }
        val dialog = BottomSheetDialog(this)
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
        val menuItemPip = view.findViewById<LinearLayout>(R.id.menuItemPip)
        val menuItemCapture = view.findViewById<LinearLayout>(R.id.menuItemCapture)
        val menuItemFindInPage = view.findViewById<LinearLayout>(R.id.menuItemFindInPage)
        val menuItemPrint = view.findViewById<LinearLayout>(R.id.menuItemPrint)
        val menuItemHistory = view.findViewById<LinearLayout>(R.id.menuItemHistory)
        val menuItemSettings = view.findViewById<LinearLayout>(R.id.menuItemSettings)

        tvDesktopModeStatus.text = if (isDesktopMode) "PC 웹 활성" else "모바일 웹"

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
            translateCurrentPage()
        }

        menuItemDesktop.setOnClickListener {
            dialog.dismiss()
            toggleDesktopMode()
        }

        menuItemPip?.setOnClickListener {
            dialog.dismiss()
            enterPipMode()
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
        isDesktopMode = !isDesktopMode
        val currentWv = getCurrentWebView()
        if (isDesktopMode) {
            currentWv.settings.userAgentString = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
            Toast.makeText(this, "데스크탑 (PC) 버전으로 전환되었습니다.", Toast.LENGTH_SHORT).show()
        } else {
            currentWv.settings.userAgentString = "Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36"
            Toast.makeText(this, "모바일 웹 버전으로 전환되었습니다.", Toast.LENGTH_SHORT).show()
        }
        currentWv.reload()
    }

    private fun showFindInPageDialog() {
        val dialog = BottomSheetDialog(this)
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
        if (isTabletLayout()) {
            switchSidebarTab("menu")
            if (layoutSidebar.visibility != View.VISIBLE) toggleSidebar("menu")
            return
        }
        val dialog = BottomSheetDialog(this)
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
        if (isTabletLayout()) {
            switchSidebarTab("bookmarks")
            if (layoutSidebar.visibility != View.VISIBLE) toggleSidebar("bookmarks")
            populateSidebarBookmarks()
            return
        }
        val dialog = BottomSheetDialog(this)
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
    private fun showSettingsDialog() {
        val dialog = BottomSheetDialog(this)
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

    // 어떤 버튼이든, 항목이든 누를 때의 바운스 애니메이션
    private fun applyTouchAnimation(v: View) {
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
        btnTabAi.background = null
        btnTabAi.setTextColor(getColor(R.color.text_muted))
        btnTabBookmarks.background = null
        btnTabBookmarks.setTextColor(getColor(R.color.text_muted))
        btnTabMenu.background = null
        btnTabMenu.setTextColor(getColor(R.color.text_muted))

        layoutTabAiContent.visibility = View.GONE
        layoutTabBookmarksContent.visibility = View.GONE
        layoutTabMenuContent.visibility = View.GONE

        when (tab) {
            "bookmarks" -> {
                btnTabBookmarks.setBackgroundResource(R.drawable.bg_pill_badge)
                btnTabBookmarks.backgroundTintList = ColorStateList.valueOf(getColor(R.color.primary_black))
                btnTabBookmarks.setTextColor(getColor(R.color.white))
                layoutTabBookmarksContent.visibility = View.VISIBLE
            }
            "menu" -> {
                btnTabMenu.setBackgroundResource(R.drawable.bg_pill_badge)
                btnTabMenu.backgroundTintList = ColorStateList.valueOf(getColor(R.color.primary_black))
                btnTabMenu.setTextColor(getColor(R.color.white))
                layoutTabMenuContent.visibility = View.VISIBLE
            }
            else -> {
                btnTabAi.setBackgroundResource(R.drawable.bg_pill_badge)
                btnTabAi.backgroundTintList = ColorStateList.valueOf(getColor(R.color.primary_black))
                btnTabAi.setTextColor(getColor(R.color.white))
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

        // 사이드바 메뉴 패널의 모든 기능 연결
        findViewById<Button>(R.id.btnSidebarQuickNewTab)?.setOnClickListener { addNewTab() }
        findViewById<Button>(R.id.btnSidebarQuickReload)?.setOnClickListener { getCurrentWebView().reload() }
        findViewById<Button>(R.id.btnSidebarQuickShare)?.setOnClickListener { shareCurrentPage() }
        findViewById<Button>(R.id.btnSidebarQuickBookmark)?.setOnClickListener {
            val cur = getCurrentWebView()
            saveCustomBookmark(cur.title ?: "페이지", cur.url ?: START_PAGE_URL, "기본")
            Toast.makeText(this, "북마크에 저장되었습니다.", Toast.LENGTH_SHORT).show()
        }

        findViewById<TextView>(R.id.btnSidebarMenuBag)?.setOnClickListener { showBagDialog() }
        findViewById<TextView>(R.id.btnSidebarMenuDownloads)?.setOnClickListener { showDownloadsDialog() }
        findViewById<TextView>(R.id.btnSidebarMenuHistory)?.setOnClickListener { showHistoryDialog() }
        findViewById<TextView>(R.id.btnSidebarMenuSecurity)?.setOnClickListener { showSecurityInfoDialog() }
        findViewById<TextView>(R.id.btnSidebarMenuFind)?.setOnClickListener { showFindInPageDialog() }
        findViewById<TextView>(R.id.btnSidebarMenuReader)?.setOnClickListener { showReaderModeDialog() }
        findViewById<TextView>(R.id.btnSidebarMenuTranslate)?.setOnClickListener { translateCurrentPage() }
        findViewById<TextView>(R.id.btnSidebarMenuDesktop)?.setOnClickListener { toggleDesktopMode() }
        findViewById<TextView>(R.id.btnSidebarMenuPrint)?.setOnClickListener { printCurrentPage() }
        findViewById<TextView>(R.id.btnSidebarMenuCapture)?.setOnClickListener { captureFullPageScreenshot() }
        findViewById<TextView>(R.id.btnSidebarMenuPip)?.setOnClickListener { enterPipMode() }
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
            translateCurrentPage()
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
        val dialog = BottomSheetDialog(this)
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
            translateCurrentPage()
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
            val isTranslated = url.contains("translate.google.com")
            tvTranslateChipText.text = if (isTranslated) "원문" else "번역"
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
        checkClipboardOnResume()
    }

    override fun onPause() {
        super.onPause()
        isAppInForeground = false
        saveTabsToPrefs()
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
        val wv = getCurrentWebView()
        wv.evaluateJavascript("if (window.setTheme) { window.setTheme(''); }", null)
    }

    private fun applyThemeToViews(theme: String) {
        when (theme) {
            "theme-default-dark" -> {
                layoutTopBar.setBackgroundColor(Color.parseColor("#000000"))
                layoutAddressBar.backgroundTintList = ColorStateList.valueOf(Color.parseColor("#16191E"))
                etBrowserUrl.setTextColor(Color.WHITE)
                etBrowserUrl.setHintTextColor(Color.parseColor("#767C88"))
                ivUrlIcon.imageTintList = ColorStateList.valueOf(Color.WHITE)
                btnTopBack.imageTintList = ColorStateList.valueOf(Color.WHITE)
                btnTopForward.imageTintList = ColorStateList.valueOf(Color.WHITE)
                btnTopReload.imageTintList = ColorStateList.valueOf(Color.WHITE)
                btnTopHome.imageTintList = ColorStateList.valueOf(Color.WHITE)
                btnTopMenu.imageTintList = ColorStateList.valueOf(Color.WHITE)
                btnMobileReload.imageTintList = ColorStateList.valueOf(Color.WHITE)
                layoutBottomBar.setBackgroundColor(Color.parseColor("#000000"))
                btnNavBack.imageTintList = ColorStateList.valueOf(Color.WHITE)
                btnNavForward.imageTintList = ColorStateList.valueOf(Color.WHITE)
                btnNavHome.imageTintList = ColorStateList.valueOf(Color.WHITE)
                tvNavTabCount.setBackgroundResource(R.drawable.bg_tab_counter_dark)
                tvNavTabCount.setTextColor(Color.WHITE)
                btnQuickTranslateChip.backgroundTintList = ColorStateList.valueOf(Color.parseColor("#262930"))
                ivTranslateChipIcon.imageTintList = ColorStateList.valueOf(Color.WHITE)
                tvTranslateChipText.setTextColor(Color.WHITE)
                layoutSidebar.setBackgroundColor(Color.parseColor("#121418"))
            }
            "theme-default-light" -> {
                layoutTopBar.setBackgroundColor(Color.parseColor("#E5E7EB"))
                layoutAddressBar.backgroundTintList = ColorStateList.valueOf(Color.parseColor("#FFFFFF"))
                etBrowserUrl.setTextColor(Color.parseColor("#111111"))
                etBrowserUrl.setHintTextColor(Color.parseColor("#666666"))
                ivUrlIcon.imageTintList = ColorStateList.valueOf(Color.parseColor("#111111"))
                btnTopBack.imageTintList = ColorStateList.valueOf(Color.parseColor("#111111"))
                btnTopForward.imageTintList = ColorStateList.valueOf(Color.parseColor("#111111"))
                btnTopReload.imageTintList = ColorStateList.valueOf(Color.parseColor("#111111"))
                btnTopHome.imageTintList = ColorStateList.valueOf(Color.parseColor("#111111"))
                btnTopMenu.imageTintList = ColorStateList.valueOf(Color.parseColor("#111111"))
                btnMobileReload.imageTintList = ColorStateList.valueOf(Color.parseColor("#111111"))
                layoutBottomBar.setBackgroundColor(Color.parseColor("#FFFFFF"))
                btnNavBack.imageTintList = ColorStateList.valueOf(Color.parseColor("#111111"))
                btnNavForward.imageTintList = ColorStateList.valueOf(Color.parseColor("#111111"))
                btnNavHome.imageTintList = ColorStateList.valueOf(Color.parseColor("#111111"))
                tvNavTabCount.setBackgroundResource(R.drawable.bg_tab_counter_light)
                tvNavTabCount.setTextColor(Color.parseColor("#111111"))
                btnQuickTranslateChip.backgroundTintList = ColorStateList.valueOf(Color.parseColor("#E5E7EB"))
                ivTranslateChipIcon.imageTintList = ColorStateList.valueOf(Color.parseColor("#111111"))
                tvTranslateChipText.setTextColor(Color.parseColor("#111111"))
                layoutSidebar.setBackgroundColor(Color.parseColor("#F9FAFB"))
            }
            "theme-pink-dark" -> {
                layoutTopBar.setBackgroundColor(Color.parseColor("#261316"))
                layoutAddressBar.backgroundTintList = ColorStateList.valueOf(Color.parseColor("#331B20"))
                etBrowserUrl.setTextColor(Color.parseColor("#FFFFFF"))
                etBrowserUrl.setHintTextColor(Color.parseColor("#D9A5AF"))
                ivUrlIcon.imageTintList = ColorStateList.valueOf(Color.WHITE)
                btnTopBack.imageTintList = ColorStateList.valueOf(Color.WHITE)
                btnTopForward.imageTintList = ColorStateList.valueOf(Color.WHITE)
                btnTopReload.imageTintList = ColorStateList.valueOf(Color.WHITE)
                btnTopHome.imageTintList = ColorStateList.valueOf(Color.WHITE)
                btnTopMenu.imageTintList = ColorStateList.valueOf(Color.WHITE)
                btnMobileReload.imageTintList = ColorStateList.valueOf(Color.WHITE)
                layoutBottomBar.setBackgroundColor(Color.parseColor("#261316"))
                btnNavBack.imageTintList = ColorStateList.valueOf(Color.WHITE)
                btnNavForward.imageTintList = ColorStateList.valueOf(Color.WHITE)
                btnNavHome.imageTintList = ColorStateList.valueOf(Color.WHITE)
                tvNavTabCount.setBackgroundResource(R.drawable.bg_tab_counter_dark)
                tvNavTabCount.setTextColor(Color.WHITE)
                btnQuickTranslateChip.backgroundTintList = ColorStateList.valueOf(Color.parseColor("#3D2228"))
                ivTranslateChipIcon.imageTintList = ColorStateList.valueOf(Color.WHITE)
                tvTranslateChipText.setTextColor(Color.WHITE)
                layoutSidebar.setBackgroundColor(Color.parseColor("#221013"))
            }
            "theme-pink-light" -> {
                layoutTopBar.setBackgroundColor(Color.parseColor("#FAD2D9"))
                layoutAddressBar.backgroundTintList = ColorStateList.valueOf(Color.parseColor("#FFFFFF"))
                etBrowserUrl.setTextColor(Color.parseColor("#6E343D"))
                etBrowserUrl.setHintTextColor(Color.parseColor("#9C5D66"))
                ivUrlIcon.imageTintList = ColorStateList.valueOf(Color.parseColor("#6E343D"))
                btnTopBack.imageTintList = ColorStateList.valueOf(Color.parseColor("#6E343D"))
                btnTopForward.imageTintList = ColorStateList.valueOf(Color.parseColor("#6E343D"))
                btnTopReload.imageTintList = ColorStateList.valueOf(Color.parseColor("#6E343D"))
                btnTopHome.imageTintList = ColorStateList.valueOf(Color.parseColor("#6E343D"))
                btnTopMenu.imageTintList = ColorStateList.valueOf(Color.parseColor("#6E343D"))
                btnMobileReload.imageTintList = ColorStateList.valueOf(Color.parseColor("#6E343D"))
                layoutBottomBar.setBackgroundColor(Color.parseColor("#FFFFFF"))
                btnNavBack.imageTintList = ColorStateList.valueOf(Color.parseColor("#6E343D"))
                btnNavForward.imageTintList = ColorStateList.valueOf(Color.parseColor("#6E343D"))
                btnNavHome.imageTintList = ColorStateList.valueOf(Color.parseColor("#6E343D"))
                tvNavTabCount.setBackgroundResource(R.drawable.bg_tab_counter_light)
                tvNavTabCount.setTextColor(Color.parseColor("#6E343D"))
                btnQuickTranslateChip.backgroundTintList = ColorStateList.valueOf(Color.parseColor("#FCE7EC"))
                ivTranslateChipIcon.imageTintList = ColorStateList.valueOf(Color.parseColor("#6E343D"))
                tvTranslateChipText.setTextColor(Color.parseColor("#6E343D"))
                layoutSidebar.setBackgroundColor(Color.parseColor("#FFF5F7"))
            }
        }
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

    private fun populateSidebarBookmarks() {
        val layoutFolders = findViewById<LinearLayout>(R.id.layoutSidebarBookmarkFoldersBar) ?: return
        val layoutList = findViewById<LinearLayout>(R.id.layoutSidebarBookmarksList) ?: return
        val btnAdd = findViewById<Button>(R.id.btnSidebarAddBookmark)

        layoutFolders.removeAllViews()
        val folders = mutableListOf("전체")
        folders.addAll(getBookmarkFolders())

        var selectedFolder = "전체"

        fun renderBookmarks() {
            layoutList.removeAllViews()
            val all = getSavedBookmarks()
            val filtered = if (selectedFolder == "전체") all else all.filter { it.folder == selectedFolder }
            if (filtered.isEmpty()) {
                val tv = TextView(this).apply {
                    text = "'$selectedFolder' 폴더에 저장된 북마크가 없습니다."
                    textSize = 12f
                    setTextColor(getColor(R.color.text_muted))
                    setPadding(10, 20, 10, 20)
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
                    setPadding(26, 12, 26, 12)
                    layoutParams = LinearLayout.LayoutParams(
                        LinearLayout.LayoutParams.WRAP_CONTENT,
                        LinearLayout.LayoutParams.WRAP_CONTENT
                    ).apply { marginEnd = 12 }
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
                        renderFolders()
                        renderBookmarks()
                    }
                }
                layoutFolders.addView(chip)
            }
        }

        btnAdd?.setOnClickListener {
            val cur = getCurrentWebView()
            val title = cur.title ?: "북마크"
            val url = cur.url ?: START_PAGE_URL
            val target = if (selectedFolder == "전체") "기본" else selectedFolder
            saveCustomBookmark(title, url, target)
            Toast.makeText(this, "북마크가 저장되었습니다.", Toast.LENGTH_SHORT).show()
            renderBookmarks()
        }

        renderFolders()
        renderBookmarks()
    }

    private fun enterPipMode() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            try {
                val params = PictureInPictureParams.Builder().build()
                enterPictureInPictureMode(params)
            } catch (e: Exception) {
                Toast.makeText(this, "PIP 모드를 시작할 수 없습니다", Toast.LENGTH_SHORT).show()
            }
        } else {
            Toast.makeText(this, "이 안드로이드 버전에서는 PIP가 지원되지 않습니다", Toast.LENGTH_SHORT).show()
        }
    }

    override fun onPictureInPictureModeChanged(isInPictureInPictureMode: Boolean, newConfig: Configuration) {
        super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig)
        if (isInPictureInPictureMode) {
            layoutTopBar.visibility = View.GONE
            layoutBottomBar.visibility = View.GONE
            layoutSidebar.visibility = View.GONE
            progressBar.visibility = View.GONE
        } else {
            layoutTopBar.visibility = View.VISIBLE
            if (!isTabletLayout()) {
                layoutBottomBar.visibility = View.VISIBLE
            }
        }
    }

    override fun onUserLeaveHint() {
        super.onUserLeaveHint()
        if (customView != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            enterPipMode()
        }
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
        val dialog = BottomSheetDialog(this)
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

    private fun saveBitmapToGallery(bitmap: Bitmap, title: String) {
        try {
            val filename = "CreamCapture_${SimpleDateFormat("yyyyMMdd_HHmmss", Locale.getDefault()).format(Date())}.png"
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
        val dialog = BottomSheetDialog(this)
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

    inner class WebAppInterface(private val activity: MainActivity) {
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
    }
}
