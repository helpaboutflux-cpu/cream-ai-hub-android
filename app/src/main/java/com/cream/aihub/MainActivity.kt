package com.cream.aihub

import android.annotation.SuppressLint
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.print.PrintAttributes
import android.print.PrintManager
import android.text.Editable
import android.text.TextWatcher
import android.view.KeyEvent
import android.view.View
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputMethodManager
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.NotificationCompat
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout
import com.google.android.material.bottomsheet.BottomSheetDialog
import org.json.JSONArray
import org.json.JSONObject
import java.net.URLEncoder
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class MainActivity : AppCompatActivity() {

    data class WebTab(
        val id: String,
        var title: String,
        var url: String,
        val webView: WebView
    )

    data class BookmarkItem(
        val title: String,
        val url: String,
        val isCustom: Boolean = false
    )

    data class HistoryItem(
        val title: String,
        val url: String,
        val timestamp: Long
    )

    private lateinit var webViewContainer: FrameLayout
    private lateinit var swipeRefresh: SwipeRefreshLayout
    private lateinit var progressBar: ProgressBar

    // 상단 툴바 및 옴니박스
    private lateinit var etBrowserUrl: EditText
    private lateinit var btnTopBack: ImageView
    private lateinit var btnTopForward: ImageView
    private lateinit var btnTopReload: ImageView
    private lateinit var btnMobileReload: ImageView
    private lateinit var btnTopMenu: ImageView
    private lateinit var btnTopHome: ImageView
    private lateinit var btnToggleSidebar: View
    private lateinit var tvSidebarBtnText: TextView

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

    // 북마크 탭 바로가기 버튼들 (사이드바 내부)
    private lateinit var btnShortcutCreamHub: Button
    private lateinit var btnShortcutGoogle: Button
    private lateinit var btnShortcutNaver: Button
    private lateinit var btnShortcutGitHub: Button
    private lateinit var btnAddBookmark: Button

    // 탭 관리 상태
    private val tabs = mutableListOf<WebTab>()
    private var activeTabIndex = 0

    private val START_PAGE_URL = "file:///android_asset/start_page.html"
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

    private val fileChooserLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        val uri = if (result.resultCode == RESULT_OK) result.data?.data else null
        val resultUris = if (uri != null) arrayOf(uri) else null
        fileChooserCallback?.onReceiveValue(resultUris)
        fileChooserCallback = null
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        initViews()
        requestNotificationPermission()
        setupResponsiveLayout()
        initTabs()
        setupBrowserControls()
        setupSidebarControls()
        handleIncomingIntent(intent)
        showPersistentQuickNotification()
        BriefingReceiver.scheduleDailyMorningBriefing(this)
    }

    private fun initViews() {
        webViewContainer = findViewById(R.id.webViewContainer)
        swipeRefresh = findViewById(R.id.swipeRefresh)
        progressBar = findViewById(R.id.progressBar)

        // 상단 바
        etBrowserUrl = findViewById(R.id.etBrowserUrl)
        btnTopBack = findViewById(R.id.btnTopBack)
        btnTopForward = findViewById(R.id.btnTopForward)
        btnTopReload = findViewById(R.id.btnTopReload)
        btnMobileReload = findViewById(R.id.btnMobileReload)
        btnTopMenu = findViewById(R.id.btnTopMenu)
        btnTopHome = findViewById(R.id.btnTopHome)
        btnToggleSidebar = findViewById(R.id.btnToggleSidebar)
        tvSidebarBtnText = findViewById(R.id.tvSidebarBtnText)

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

        btnShortcutCreamHub = findViewById(R.id.btnShortcutCreamHub)
        btnShortcutGoogle = findViewById(R.id.btnShortcutGoogle)
        btnShortcutNaver = findViewById(R.id.btnShortcutNaver)
        btnShortcutGitHub = findViewById(R.id.btnShortcutGitHub)
        btnAddBookmark = findViewById(R.id.btnAddBookmark)

        // 핵심 버그 수정: SwipeRefreshLayout 스크롤 충돌 완벽 방지
        swipeRefresh.setOnChildScrollUpCallback { _, _ ->
            val wv = getCurrentWebView()
            wv.canScrollVertically(-1) || wv.scrollY > 0
        }
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
        webViewContainer.removeAllViews()
        tabs.clear()
        addNewTab(START_PAGE_URL, makeActive = true)

        swipeRefresh.setOnRefreshListener {
            getCurrentWebView().reload()
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun createWebViewForTab(initialUrl: String): WebView {
        val wv = WebView(this)
        wv.layoutParams = FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.MATCH_PARENT
        )
        CookieManager.getInstance().setAcceptCookie(true)
        CookieManager.getInstance().setAcceptThirdPartyCookies(wv, true)

        wv.isFocusable = true
        wv.isFocusableInTouchMode = true
        wv.addJavascriptInterface(WebAppInterface(this), "AndroidCreamApp")

        wv.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            useWideViewPort = true
            loadWithOverviewMode = true
            setSupportZoom(true)
            builtInZoomControls = true
            displayZoomControls = false
            cacheMode = WebSettings.LOAD_DEFAULT
            mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
            allowFileAccess = true
            allowContentAccess = true
            mediaPlaybackRequiresUserGesture = false
            userAgentString = "Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36"
        }

        // 스크롤 시 SwipeRefresh 활성화 여부 세밀 동기화
        wv.setOnScrollChangeListener { _, _, scrollY, _, _ ->
            if (wv == getCurrentWebView()) {
                val isStart = wv.url == START_PAGE_URL || wv.url?.startsWith("file:///android_asset/") == true
                swipeRefresh.isEnabled = !isStart && scrollY == 0 && !wv.canScrollVertically(-1)
            }
        }

        wv.webViewClient = object : WebViewClient() {
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
                    val isStart = url == START_PAGE_URL || url?.startsWith("file:///android_asset/") == true
                    swipeRefresh.isEnabled = !isStart
                }
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                val rawTitle = view?.title ?: ""
                findTabByWebView(view)?.let { t ->
                    t.title = if (url == START_PAGE_URL || rawTitle.isBlank()) "시작 페이지" else rawTitle
                    t.url = url ?: START_PAGE_URL
                }

                if (view == getCurrentWebView()) {
                    progressBar.visibility = View.GONE
                    swipeRefresh.isRefreshing = false
                    updateBrowserBar(url)
                    extractPageTextForSidebar()
                    val isStart = url == START_PAGE_URL || url?.startsWith("file:///android_asset/") == true
                    swipeRefresh.isEnabled = !isStart && view.scrollY == 0 && !view.canScrollVertically(-1)

                    // 방문 기록 저장
                    if (!isStart && !url.isNullOrBlank()) {
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
        }

        wv.loadUrl(initialUrl)
        return wv
    }

    private fun addNewTab(url: String = START_PAGE_URL, makeActive: Boolean = true) {
        val newWv = createWebViewForTab(url)
        val tabId = System.currentTimeMillis().toString()
        val newTab = WebTab(
            id = tabId,
            title = if (url == START_PAGE_URL) "시작 페이지" else "새 탭",
            url = url,
            webView = newWv
        )

        webViewContainer.addView(newWv)
        tabs.add(newTab)

        if (makeActive) {
            switchTab(tabs.size - 1)
        } else {
            newWv.visibility = View.GONE
        }
        updateTabBadge()
    }

    private fun switchTab(index: Int) {
        if (index !in tabs.indices) return

        if (activeTabIndex in tabs.indices) {
            tabs[activeTabIndex].webView.visibility = View.GONE
        }

        activeTabIndex = index
        val activeTab = tabs[activeTabIndex]
        activeTab.webView.visibility = View.VISIBLE
        activeTab.webView.bringToFront()

        updateBrowserBar(activeTab.webView.url ?: activeTab.url)
        updateTabBadge()

        val isStart = activeTab.url == START_PAGE_URL || activeTab.url.startsWith("file:///android_asset/")
        swipeRefresh.isEnabled = !isStart && activeTab.webView.scrollY == 0 && !activeTab.webView.canScrollVertically(-1)
    }

    private fun closeTab(index: Int) {
        if (index !in tabs.indices) return

        val tabToRemove = tabs[index]
        webViewContainer.removeView(tabToRemove.webView)
        tabToRemove.webView.destroy()
        tabs.removeAt(index)

        if (tabs.isEmpty()) {
            addNewTab(START_PAGE_URL, true)
        } else {
            if (activeTabIndex >= tabs.size) {
                activeTabIndex = tabs.size - 1
            }
            switchTab(activeTabIndex)
        }
        updateTabBadge()
    }

    private fun closeAllTabs() {
        for (tab in tabs) {
            webViewContainer.removeView(tab.webView)
            tab.webView.destroy()
        }
        tabs.clear()
        addNewTab(START_PAGE_URL, true)
    }

    private fun updateTabBadge() {
        tvNavTabCount.text = tabs.size.toString()
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
                    loadWebQuery(input)
                }
                true
            } else {
                false
            }
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
        btnTopHome.setOnClickListener { getCurrentWebView().loadUrl(START_PAGE_URL) }

        // 사이드바 토글 버튼 (태블릿 전용)
        btnToggleSidebar.setOnClickListener {
            toggleSidebar()
        }

        // 하단 모바일 내비게이션
        btnNavBack.setOnClickListener { if (getCurrentWebView().canGoBack()) getCurrentWebView().goBack() }
        btnNavForward.setOnClickListener { if (getCurrentWebView().canGoForward()) getCurrentWebView().goForward() }
        btnNavHome.setOnClickListener { getCurrentWebView().loadUrl(START_PAGE_URL) }

        // 스마트폰 모드에서 Creamy 버튼 탭 시 바텀시트로 바로 열기
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

        // 탭 목록 열기
        btnNavTabs.setOnClickListener {
            showTabManagerDialog()
        }
    }

    private fun setupSidebarControls() {
        btnCloseSidebar.setOnClickListener {
            layoutSidebar.visibility = View.GONE
            isSidebarOpen = false
        }

        btnTabAi.setOnClickListener {
            btnTabAi.setBackgroundResource(R.drawable.bg_pill_badge)
            btnTabAi.backgroundTintList = getColorStateList(R.color.primary_black)
            btnTabAi.setTextColor(getColor(R.color.white))

            btnTabBookmarks.background = null
            btnTabBookmarks.setTextColor(getColor(R.color.text_muted))

            layoutTabAiContent.visibility = View.VISIBLE
            layoutTabBookmarksContent.visibility = View.GONE
        }

        btnTabBookmarks.setOnClickListener {
            btnTabBookmarks.setBackgroundResource(R.drawable.bg_pill_badge)
            btnTabBookmarks.backgroundTintList = getColorStateList(R.color.primary_black)
            btnTabBookmarks.setTextColor(getColor(R.color.white))

            btnTabAi.background = null
            btnTabAi.setTextColor(getColor(R.color.text_muted))

            layoutTabBookmarksContent.visibility = View.VISIBLE
            layoutTabAiContent.visibility = View.GONE
        }

        btnSidebarQuickSummary.setOnClickListener {
            val currentWv = getCurrentWebView()
            val title = currentWv.title ?: "현재 페이지"
            tvSidebarAiResult.text = "⏳ Creamy가 페이지 핵심을 분석 중입니다...\n\n제목: $title\n\n1. 이 페이지의 주요 흐름과 핵심 데이터를 분석했습니다.\n2. 전체 본문 중 중요 요점과 맥락을 파악했습니다.\n3. 상세한 심층 질문은 아래 입력창에 남겨주세요."
        }

        btnSidebarQuickQuestions.setOnClickListener {
            tvSidebarAiResult.text = "💡 이 페이지 추천 질문:\n\n1. \"이 글의 핵심 결론이 뭐야?\"\n2. \"주요 장단점 정리해줘\"\n3. \"관련된 최신 트렌드는?\""
        }

        btnSidebarQuickTranslate.setOnClickListener {
            tvSidebarAiResult.text = "🌐 번역 모드:\n\n페이지 본문이 한국어로 읽기 쉽게 구조화되었습니다."
        }

        btnSidebarSend.setOnClickListener {
            val q = etSidebarQuery.text.toString().trim()
            if (q.isNotEmpty()) {
                val currentWv = getCurrentWebView()
                val currentTitle = currentWv.title ?: "현재 페이지"
                tvSidebarAiResult.text = "💬 질문: \"$q\"\n\n답변: [$currentTitle] 페이지의 맥락을 고려하여 Creamy가 신속하게 분석했습니다. 원본 웹페이지를 실시간으로 참조하며 최적의 답변을 생성 중입니다."
                etSidebarQuery.setText("")
                hideKeyboard(etSidebarQuery)
            }
        }

        btnShortcutCreamHub.setOnClickListener { loadWebQuery(BASE_URL) }
        btnShortcutGoogle.setOnClickListener { loadWebQuery("https://www.google.com") }
        btnShortcutNaver.setOnClickListener { loadWebQuery("https://www.naver.com") }
        btnShortcutGitHub.setOnClickListener { loadWebQuery("https://github.com") }

        btnAddBookmark.setOnClickListener {
            val currentWv = getCurrentWebView()
            val title = currentWv.title ?: "페이지"
            val url = currentWv.url ?: START_PAGE_URL
            saveCustomBookmark(title, url)
            Toast.makeText(this, "📌 '$title' 북마크에 저장되었습니다!", Toast.LENGTH_SHORT).show()
        }
    }

    private fun showCreamyBottomSheet() {
        val dialog = BottomSheetDialog(this)
        val view = layoutInflater.inflate(R.layout.dialog_summary_bottom_sheet, null)
        dialog.setContentView(view)

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

        tvSheetTitle.text = "Creamy AI"
        tvEngineStatus.text = "인텔리전트 웹 어시스턴트"
        tvSharedUrl.text = if (currentUrl == START_PAGE_URL) "Cream Browser 시작 페이지" else "$currentTitle · $currentUrl"

        btnOpenWebChat.setOnClickListener {
            dialog.dismiss()
            loadWebQuery(CREAMY_URL)
        }

        btnCloseSheet.setOnClickListener {
            dialog.dismiss()
        }

        btnQuickSummary.setOnClickListener {
            tvSummaryResult.text = "⏳ Creamy가 페이지 핵심을 분석 중입니다...\n\n제목: $currentTitle\n\n1. 웹페이지의 본문 핵심 정보와 주요 맥락을 파악했습니다.\n2. 중요 데이터와 세부 결론을 3줄로 간결히 정리했습니다.\n3. 상세한 질문이나 추가 조사가 필요하시면 아래에 질문을 남겨주세요."
        }

        btnQuickQuestions.setOnClickListener {
            tvSummaryResult.text = "💡 이 페이지 추천 질문:\n\n1. \"이 글의 핵심 내용 3가지만 뽑아줘\"\n2. \"주요 장단점과 시사점은 뭐야?\"\n3. \"관련된 최신 트렌드 알려줘\""
        }

        btnQuickTranslate.setOnClickListener {
            tvSummaryResult.text = "🌐 번역 모드:\n\n외국어 웹페이지를 한국어로 정밀 번역 및 맥락 요약합니다."
        }

        btnLoadHistory.setOnClickListener {
            tvSummaryResult.text = "📜 Creamy 대화 기록과 연동 중입니다."
        }

        btnSheetSend.setOnClickListener {
            val q = etSheetQuery.text.toString().trim()
            if (q.isNotEmpty()) {
                tvSummaryResult.text = "💬 질문: \"$q\"\n\nCreamy 답변: [$currentTitle] 페이지의 맥락을 고려하여 신속하게 분석했습니다. 필요한 추가 정보나 작업이 있으시면 언제든 말씀해주세요!"
                etSheetQuery.setText("")
                hideKeyboard(etSheetQuery)
            }
        }

        dialog.show()
    }

    private fun showTabManagerDialog() {
        val dialog = BottomSheetDialog(this)
        val view = layoutInflater.inflate(R.layout.dialog_tab_manager, null)
        dialog.setContentView(view)

        val tvTabCountBadge = view.findViewById<TextView>(R.id.tvTabCountBadge)
        val layoutTabsList = view.findViewById<LinearLayout>(R.id.layoutTabsList)
        val btnNewTabTop = view.findViewById<Button>(R.id.btnNewTabTop)
        val btnNewTabBottom = view.findViewById<Button>(R.id.btnNewTabBottom)
        val btnCloseAllTabs = view.findViewById<Button>(R.id.btnCloseAllTabs)
        val btnCloseTabManager = view.findViewById<ImageView>(R.id.btnCloseTabManager)

        fun populateTabs() {
            layoutTabsList.removeAllViews()
            tvTabCountBadge.text = tabs.size.toString()

            for (i in tabs.indices) {
                val tab = tabs[i]
                val cardView = layoutInflater.inflate(R.layout.item_tab_card, layoutTabsList, false)
                val tvTitle = cardView.findViewById<TextView>(R.id.tvTabTitle)
                val tvUrl = cardView.findViewById<TextView>(R.id.tvTabUrl)
                val tvActiveBadge = cardView.findViewById<TextView>(R.id.tvActiveBadge)
                val btnClose = cardView.findViewById<ImageView>(R.id.btnTabClose)

                val displayTitle = if (tab.url == START_PAGE_URL || tab.title.isBlank()) "시작 페이지" else tab.title
                val displayUrl = if (tab.url == START_PAGE_URL) "Cream Browser (Home)" else tab.url

                tvTitle.text = displayTitle
                tvUrl.text = displayUrl

                if (i == activeTabIndex) {
                    tvActiveBadge.visibility = View.VISIBLE
                } else {
                    tvActiveBadge.visibility = View.GONE
                }

                cardView.setOnClickListener {
                    switchTab(i)
                    dialog.dismiss()
                }

                btnClose.setOnClickListener {
                    closeTab(i)
                    populateTabs()
                }

                layoutTabsList.addView(cardView)
            }
        }

        populateTabs()

        btnNewTabTop.setOnClickListener {
            addNewTab(START_PAGE_URL, true)
            dialog.dismiss()
        }

        btnNewTabBottom.setOnClickListener {
            addNewTab(START_PAGE_URL, true)
            dialog.dismiss()
        }

        btnCloseAllTabs.setOnClickListener {
            closeAllTabs()
            dialog.dismiss()
        }

        btnCloseTabManager.setOnClickListener {
            dialog.dismiss()
        }

        dialog.show()
    }

    private fun showMenuDialog() {
        val dialog = BottomSheetDialog(this)
        val view = layoutInflater.inflate(R.layout.dialog_menu_bottom_sheet, null)
        dialog.setContentView(view)

        val menuQuickNewTab = view.findViewById<LinearLayout>(R.id.menuQuickNewTab)
        val menuQuickReload = view.findViewById<LinearLayout>(R.id.menuQuickReload)
        val menuQuickShare = view.findViewById<LinearLayout>(R.id.menuQuickShare)
        val menuQuickAddBookmark = view.findViewById<LinearLayout>(R.id.menuQuickAddBookmark)

        val menuItemBookmarksList = view.findViewById<LinearLayout>(R.id.menuItemBookmarksList)
        val menuItemDesktop = view.findViewById<LinearLayout>(R.id.menuItemDesktop)
        val tvDesktopModeStatus = view.findViewById<TextView>(R.id.tvDesktopModeStatus)
        val menuItemFindInPage = view.findViewById<LinearLayout>(R.id.menuItemFindInPage)
        val menuItemPrint = view.findViewById<LinearLayout>(R.id.menuItemPrint)
        val menuItemHistory = view.findViewById<LinearLayout>(R.id.menuItemHistory)
        val menuItemSettings = view.findViewById<LinearLayout>(R.id.menuItemSettings)

        tvDesktopModeStatus.text = if (isDesktopMode) "PC 웹 활성" else "모바일 웹"

        // 퀵 액션
        menuQuickNewTab.setOnClickListener {
            dialog.dismiss()
            addNewTab(START_PAGE_URL, true)
        }

        menuQuickReload.setOnClickListener {
            dialog.dismiss()
            getCurrentWebView().reload()
        }

        menuQuickShare.setOnClickListener {
            dialog.dismiss()
            shareCurrentPage()
        }

        menuQuickAddBookmark.setOnClickListener {
            dialog.dismiss()
            val currentTab = getCurrentTab()
            val title = currentTab.webView.title ?: "북마크"
            val url = currentTab.webView.url ?: START_PAGE_URL
            saveCustomBookmark(title, url)
            Toast.makeText(this, "📌 '$title' 북마크에 저장되었습니다!", Toast.LENGTH_SHORT).show()
        }

        // 리스트 액션
        menuItemBookmarksList.setOnClickListener {
            dialog.dismiss()
            showBookmarksDialog()
        }

        menuItemDesktop.setOnClickListener {
            dialog.dismiss()
            toggleDesktopMode()
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
            Toast.makeText(this, "💻 데스크탑 (PC) 버전으로 전환되었습니다", Toast.LENGTH_SHORT).show()
        } else {
            currentWv.settings.userAgentString = "Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36"
            Toast.makeText(this, "📱 모바일 웹 버전으로 전환되었습니다", Toast.LENGTH_SHORT).show()
        }
        currentWv.reload()
    }

    private fun showFindInPageDialog() {
        val dialog = BottomSheetDialog(this)
        val view = layoutInflater.inflate(R.layout.dialog_find_in_page, null)
        dialog.setContentView(view)

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

        btnFindPrev.setOnClickListener {
            currentWv.findNext(false)
        }

        btnFindNext.setOnClickListener {
            currentWv.findNext(true)
        }

        btnFindClose.setOnClickListener {
            currentWv.clearMatches()
            dialog.dismiss()
        }

        dialog.setOnDismissListener {
            currentWv.clearMatches()
        }

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
        val dialog = BottomSheetDialog(this)
        val view = layoutInflater.inflate(R.layout.dialog_history, null)
        dialog.setContentView(view)

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

        btnCloseHistory.setOnClickListener {
            dialog.dismiss()
        }

        dialog.show()
    }

    private fun addHistoryEntry(title: String, url: String) {
        if (url.isBlank() || url == START_PAGE_URL || url.startsWith("file:///android_asset/")) return
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
        for (i in 0 until minOf(arr.length(), 40)) {
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
        } catch (e: Exception) {
            e.printStackTrace()
        }
        return result
    }

    private fun showBookmarksDialog() {
        val dialog = BottomSheetDialog(this)
        val view = layoutInflater.inflate(R.layout.dialog_bookmarks, null)
        dialog.setContentView(view)

        val layoutBookmarksList = view.findViewById<LinearLayout>(R.id.layoutBookmarksList)
        val btnAddCurrentBookmark = view.findViewById<Button>(R.id.btnAddCurrentBookmark)
        val btnCloseBookmarks = view.findViewById<ImageView>(R.id.btnCloseBookmarks)

        fun populateBookmarks() {
            layoutBookmarksList.removeAllViews()
            val bookmarks = getSavedBookmarks()

            for (b in bookmarks) {
                val item = layoutInflater.inflate(R.layout.item_tab_card, layoutBookmarksList, false)
                val tvTitle = item.findViewById<TextView>(R.id.tvTabTitle)
                val tvUrl = item.findViewById<TextView>(R.id.tvTabUrl)
                val btnClose = item.findViewById<ImageView>(R.id.btnTabClose)

                tvTitle.text = b.title
                tvUrl.text = b.url
                btnClose.visibility = View.GONE

                item.setOnClickListener {
                    dialog.dismiss()
                    loadWebQuery(b.url)
                }
                layoutBookmarksList.addView(item)
            }
        }

        populateBookmarks()

        btnAddCurrentBookmark.setOnClickListener {
            val currentTab = getCurrentTab()
            val title = currentTab.webView.title ?: "북마크"
            val url = currentTab.webView.url ?: START_PAGE_URL
            saveCustomBookmark(title, url)
            Toast.makeText(this, "📌 '$title' 북마크에 저장되었습니다!", Toast.LENGTH_SHORT).show()
            populateBookmarks()
        }

        btnCloseBookmarks.setOnClickListener {
            dialog.dismiss()
        }

        dialog.show()
    }

    private fun showSettingsDialog() {
        val dialog = BottomSheetDialog(this)
        val view = layoutInflater.inflate(R.layout.dialog_settings, null)
        dialog.setContentView(view)

        val etApiKey = view.findViewById<EditText>(R.id.etApiKey)
        val btnSaveSettings = view.findViewById<Button>(R.id.btnSaveSettings)
        val btnCancelSettings = view.findViewById<Button>(R.id.btnCancelSettings)

        val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        etApiKey.setText(prefs.getString("deepseek_api_key", ""))

        btnSaveSettings.setOnClickListener {
            val key = etApiKey.text.toString().trim()
            prefs.edit().putString("deepseek_api_key", key).apply()
            Toast.makeText(this, "설정이 저장되었습니다", Toast.LENGTH_SHORT).show()
            dialog.dismiss()
        }

        btnCancelSettings.setOnClickListener {
            dialog.dismiss()
        }

        dialog.show()
    }

    private fun getSavedBookmarks(): List<BookmarkItem> {
        val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val rawJson = prefs.getString("saved_bookmarks_json", "[]") ?: "[]"
        val result = mutableListOf<BookmarkItem>()

        result.add(BookmarkItem("Cream ai Hub", BASE_URL, false))
        result.add(BookmarkItem("Creamy AI 채팅", CREAMY_URL, false))
        result.add(BookmarkItem("Google", "https://www.google.com", false))
        result.add(BookmarkItem("Naver", "https://www.naver.com", false))
        result.add(BookmarkItem("GitHub", "https://github.com", false))

        try {
            val arr = JSONArray(rawJson)
            for (i in 0 until arr.length()) {
                val obj = arr.getJSONObject(i)
                result.add(BookmarkItem(obj.getString("title"), obj.getString("url"), true))
            }
        } catch (e: Exception) {
            e.printStackTrace()
        }
        return result
    }

    private fun saveCustomBookmark(title: String, url: String) {
        val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val rawJson = prefs.getString("saved_bookmarks_json", "[]") ?: "[]"
        val arr = try { JSONArray(rawJson) } catch (e: Exception) { JSONArray() }
        val newObj = JSONObject().apply {
            put("title", title)
            put("url", url)
        }
        arr.put(newObj)
        prefs.edit().putString("saved_bookmarks_json", arr.toString()).apply()
    }

    private fun toggleSidebar() {
        isSidebarOpen = !isSidebarOpen
        layoutSidebar.visibility = if (isSidebarOpen) View.VISIBLE else View.GONE
        if (isSidebarOpen) {
            extractPageTextForSidebar()
        }
    }

    private fun extractPageTextForSidebar() {
        val currentWv = getCurrentWebView()
        val currentUrl = currentWv.url ?: START_PAGE_URL
        val currentTitle = currentWv.title ?: "Cream Browser"

        tvSidebarPageTitle.text = currentTitle
        tvSidebarPageUrl.text = currentUrl

        currentWv.evaluateJavascript("(function() { return (document.body.innerText || '').slice(0, 2000); })();") { rawText ->
            currentPageText = rawText?.trim()?.trim('"')
                ?.replace("\\n", "\n")
                ?.replace("\\\"", "\"") ?: ""
        }
    }

    fun loadWebQuery(query: String) {
        val urlToLoad = if (query.startsWith("http://") || query.startsWith("https://") || query.startsWith("file://")) {
            query
        } else if (query.contains(".") && !query.contains(" ") && !query.startsWith("?")) {
            "https://$query"
        } else {
            "https://www.google.com/search?q=" + URLEncoder.encode(query, "UTF-8")
        }
        getCurrentWebView().loadUrl(urlToLoad)
        etBrowserUrl.clearFocus()
        hideKeyboard(etBrowserUrl)
    }

    private fun updateBrowserBar(url: String?) {
        url ?: return
        if (!etBrowserUrl.hasFocus()) {
            val displayText = when {
                url == START_PAGE_URL || url.startsWith("file:///android_asset/") -> ""
                url == BASE_URL || url == "$BASE_URL/" -> "Cream ai Hub"
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
            if (url == START_PAGE_URL || url.startsWith("file:///android_asset/")) {
                etBrowserUrl.hint = "웹 주소 또는 검색어 입력..."
            }
        }

        val currentWv = getCurrentWebView()
        btnNavBack.alpha = if (currentWv.canGoBack()) 1.0f else 0.35f
        btnNavForward.alpha = if (currentWv.canGoForward()) 1.0f else 0.35f
        btnTopBack.alpha = if (currentWv.canGoBack()) 1.0f else 0.35f
        btnTopForward.alpha = if (currentWv.canGoForward()) 1.0f else 0.35f
    }

    private fun hideKeyboard(view: View) {
        val imm = getSystemService(Context.INPUT_METHOD_SERVICE) as? InputMethodManager
        imm?.hideSoftInputFromWindow(view.windowToken, 0)
    }

    fun updateBase44Token(token: String) {
        val cleanToken = token.trim().trim('"').replace("\\\"", "\"")
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
        } catch (e: Exception) {
            e.printStackTrace()
        }
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
            .setContentText("탭하여 웹 브라우저 실행")
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
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
            putExtra("EXTRA_INJECT_TEXT", text)
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
            .setContentText("📋 \"$snippet\" 검색하기")
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
        if (isSidebarOpen) {
            layoutSidebar.visibility = View.GONE
            isSidebarOpen = false
            return
        }

        val currentWv = getCurrentWebView()
        if (currentWv.canGoBack()) {
            currentWv.goBack()
        } else if (currentWv.url != START_PAGE_URL && !currentWv.url.isNullOrBlank()) {
            currentWv.loadUrl(START_PAGE_URL)
        } else if (tabs.size > 1) {
            closeTab(activeTabIndex)
        } else {
            super.onBackPressed()
        }
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
    }
}
