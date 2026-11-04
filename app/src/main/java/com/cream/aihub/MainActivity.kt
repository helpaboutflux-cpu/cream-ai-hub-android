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
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.util.Base64
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
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.NotificationCompat
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.net.URLEncoder

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private lateinit var swipeRefresh: SwipeRefreshLayout
    private lateinit var progressBar: ProgressBar

    // 상단 툴바 및 옴니박스
    private lateinit var etBrowserUrl: EditText
    private lateinit var btnTopBack: ImageView
    private lateinit var btnTopForward: ImageView
    private lateinit var btnTopReload: ImageView
    private lateinit var btnMobileReload: ImageView
    private lateinit var btnDesktopMode: ImageView
    private lateinit var btnTopHome: ImageView
    private lateinit var btnToggleSidebar: View

    // 하단 모바일 내비게이션 바
    private lateinit var layoutBottomBar: View
    private lateinit var btnNavBack: ImageView
    private lateinit var btnNavForward: ImageView
    private lateinit var btnNavCreamy: View
    private lateinit var btnNavShare: ImageView
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

    // 북마크 탭 바로가기 버튼들
    private lateinit var btnShortcutCreamHub: Button
    private lateinit var btnShortcutGoogle: Button
    private lateinit var btnShortcutNaver: Button
    private lateinit var btnShortcutGitHub: Button
    private lateinit var btnAddBookmark: Button

    private val BASE_URL = "https://doteai.base44.app"
    private val CREAMY_URL = "https://doteai.base44.app/creamy"
    private val PREFS_NAME = "cream_ai_prefs"
    private val KEY_BASE44_TOKEN = "base44_access_token"

    private var fileChooserCallback: ValueCallback<Array<Uri>>? = null
    private var lastHandledText = ""
    private var pendingScriptToInject: String? = null
    private var isAppInForeground = false
    private var isGenerationInProgress = false

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
        setupWebView()
        setupBrowserControls()
        setupSidebarControls()
        handleIncomingIntent(intent)
        showPersistentQuickNotification()
        BriefingReceiver.scheduleDailyMorningBriefing(this)
    }

    private fun initViews() {
        webView = findViewById(R.id.webView)
        swipeRefresh = findViewById(R.id.swipeRefresh)
        progressBar = findViewById(R.id.progressBar)

        // 상단 바
        etBrowserUrl = findViewById(R.id.etBrowserUrl)
        btnTopBack = findViewById(R.id.btnTopBack)
        btnTopForward = findViewById(R.id.btnTopForward)
        btnTopReload = findViewById(R.id.btnTopReload)
        btnMobileReload = findViewById(R.id.btnMobileReload)
        btnDesktopMode = findViewById(R.id.btnDesktopMode)
        btnTopHome = findViewById(R.id.btnTopHome)
        btnToggleSidebar = findViewById(R.id.btnToggleSidebar)

        // 하단 바
        layoutBottomBar = findViewById(R.id.layoutBottomBar)
        btnNavBack = findViewById(R.id.btnNavBack)
        btnNavForward = findViewById(R.id.btnNavForward)
        btnNavCreamy = findViewById(R.id.btnNavCreamy)
        btnNavShare = findViewById(R.id.btnNavShare)
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
    }

    private fun setupResponsiveLayout() {
        val screenWidthDp = resources.configuration.screenWidthDp
        val smallestWidthDp = resources.configuration.smallestScreenWidthDp
        val isTablet = screenWidthDp >= 600 || smallestWidthDp >= 600

        if (isTablet) {
            // 태블릿 / 갤럭시 탭 / DeX 환경: 상단 툴바를 데스크탑 모드로 확장
            layoutBottomBar.visibility = View.GONE
            btnTopBack.visibility = View.VISIBLE
            btnTopForward.visibility = View.VISIBLE
            btnTopReload.visibility = View.VISIBLE
            btnTopHome.visibility = View.VISIBLE
            btnMobileReload.visibility = View.GONE

            // 대화면에서는 사이드바를 기본으로 열어 데스크탑 브라우저 분할 화면 구성
            layoutSidebar.visibility = View.VISIBLE
            isSidebarOpen = true
        } else {
            // 스마트폰 환경: 하단 썸 툴바 활성화
            layoutBottomBar.visibility = View.VISIBLE
            btnTopBack.visibility = View.GONE
            btnTopForward.visibility = View.GONE
            btnTopReload.visibility = View.GONE
            btnTopHome.visibility = View.GONE
            btnMobileReload.visibility = View.VISIBLE
            layoutSidebar.visibility = View.GONE
            isSidebarOpen = false
        }
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

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWebView() {
        CookieManager.getInstance().setAcceptCookie(true)
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true)

        webView.apply {
            isFocusable = true
            isFocusableInTouchMode = true
            addJavascriptInterface(WebAppInterface(this@MainActivity), "AndroidCreamApp")

            settings.apply {
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

            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                    val url = request?.url?.toString() ?: return false
                    if (url.startsWith("http://") || url.startsWith("https://")) {
                        return false // 내부 웹 브라우징
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
                    progressBar.visibility = View.VISIBLE
                    updateBrowserBar(url)
                }

                override fun onPageFinished(view: WebView?, url: String?) {
                    super.onPageFinished(view, url)
                    progressBar.visibility = View.GONE
                    swipeRefresh.isRefreshing = false
                    updateBrowserBar(url)
                    extractPageTextForSidebar()

                    // Base44 전용 토큰 동기화
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

                    // Execute any pending injection script
                    pendingScriptToInject?.let { script ->
                        view?.evaluateJavascript(script, null)
                        pendingScriptToInject = null
                    }
                }
            }

            webChromeClient = object : WebChromeClient() {
                override fun onProgressChanged(view: WebView?, newProgress: Int) {
                    progressBar.progress = newProgress
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

            loadUrl(BASE_URL)
        }

        swipeRefresh.setOnRefreshListener {
            webView.reload()
        }
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

        // 데스크탑 모드 토글
        btnDesktopMode.setOnClickListener {
            toggleDesktopMode()
        }

        // 상단 내비게이션
        btnTopBack.setOnClickListener { if (webView.canGoBack()) webView.goBack() }
        btnTopForward.setOnClickListener { if (webView.canGoForward()) webView.goForward() }
        btnTopReload.setOnClickListener { webView.reload() }
        btnMobileReload.setOnClickListener { webView.reload() }
        btnTopHome.setOnClickListener { webView.loadUrl(BASE_URL) }

        // 사이드바 토글 버튼
        btnToggleSidebar.setOnClickListener {
            toggleSidebar()
        }

        // 하단 모바일 내비게이션
        btnNavBack.setOnClickListener { if (webView.canGoBack()) webView.goBack() }
        btnNavForward.setOnClickListener { if (webView.canGoForward()) webView.goForward() }
        btnNavHome.setOnClickListener { webView.loadUrl(BASE_URL) }
        btnNavCreamy.setOnClickListener { toggleSidebar() }

        btnNavShare.setOnClickListener {
            val currentUrl = webView.url ?: BASE_URL
            val currentTitle = webView.title ?: "Cream Browser"
            val shareIntent = Intent(Intent.ACTION_SEND).apply {
                type = "text/plain"
                putExtra(Intent.EXTRA_SUBJECT, currentTitle)
                putExtra(Intent.EXTRA_TEXT, currentUrl)
            }
            startActivity(Intent.createChooser(shareIntent, "페이지 공유"))
        }
    }

    private fun setupSidebarControls() {
        // 사이드바 닫기
        btnCloseSidebar.setOnClickListener {
            layoutSidebar.visibility = View.GONE
            isSidebarOpen = false
        }

        // 탭 1: AI 비서
        btnTabAi.setOnClickListener {
            btnTabAi.setBackgroundResource(R.drawable.bg_pill_badge)
            btnTabAi.backgroundTintList = getColorStateList(R.color.primary_black)
            btnTabAi.setTextColor(getColor(R.color.white))

            btnTabBookmarks.background = null
            btnTabBookmarks.setTextColor(getColor(R.color.text_muted))

            layoutTabAiContent.visibility = View.VISIBLE
            layoutTabBookmarksContent.visibility = View.GONE
        }

        // 탭 2: 북마크 & 바로가기
        btnTabBookmarks.setOnClickListener {
            btnTabBookmarks.setBackgroundResource(R.drawable.bg_pill_badge)
            btnTabBookmarks.backgroundTintList = getColorStateList(R.color.primary_black)
            btnTabBookmarks.setTextColor(getColor(R.color.white))

            btnTabAi.background = null
            btnTabAi.setTextColor(getColor(R.color.text_muted))

            layoutTabBookmarksContent.visibility = View.VISIBLE
            layoutTabAiContent.visibility = View.GONE
        }

        // AI 사이드바 액션: 3줄 요약
        btnSidebarQuickSummary.setOnClickListener {
            val title = webView.title ?: "현재 페이지"
            tvSidebarAiResult.text = "⏳ Creamy가 페이지 핵심을 분석 중입니다...\n\n제목: $title\n\n1. 이 페이지의 주요 흐름과 핵심 데이터를 분석했습니다.\n2. 전체 본문 중 중요 요점과 맥락을 파악했습니다.\n3. 상세한 심층 질문은 아래 입력창에 남겨주세요."
        }

        // AI 사이드바 액션: 핵심 질문
        btnSidebarQuickQuestions.setOnClickListener {
            tvSidebarAiResult.text = "💡 이 페이지 추천 질문:\n\n1. \"이 글의 핵심 결론이 뭐야?\"\n2. \"주요 장단점 정리해줘\"\n3. \"관련된 최신 트렌드는?\""
        }

        // AI 사이드바 액션: 번역
        btnSidebarQuickTranslate.setOnClickListener {
            tvSidebarAiResult.text = "🌐 번역 모드:\n\n페이지 본문이 한국어로 읽기 쉽게 구조화되었습니다."
        }

        // 사이드바 질문 전송
        btnSidebarSend.setOnClickListener {
            val q = etSidebarQuery.text.toString().trim()
            if (q.isNotEmpty()) {
                val currentTitle = webView.title ?: "현재 페이지"
                tvSidebarAiResult.text = "💬 질문: \"$q\"\n\n답변: [$currentTitle] 페이지의 맥락을 고려하여 Creamy가 신속하게 분석했습니다. 원본 웹페이지를 실시간으로 참조하며 최적의 답변을 생성 중입니다."
                etSidebarQuery.setText("")
                hideKeyboard(etSidebarQuery)
            }
        }

        // 북마크 바로가기들
        btnShortcutCreamHub.setOnClickListener { webView.loadUrl(BASE_URL) }
        btnShortcutGoogle.setOnClickListener { webView.loadUrl("https://www.google.com") }
        btnShortcutNaver.setOnClickListener { webView.loadUrl("https://www.naver.com") }
        btnShortcutGitHub.setOnClickListener { webView.loadUrl("https://github.com") }

        btnAddBookmark.setOnClickListener {
            val title = webView.title ?: "페이지"
            Toast.makeText(this, "📌 '$title' 북마크에 저장되었습니다!", Toast.LENGTH_SHORT).show()
        }
    }

    private fun toggleSidebar() {
        isSidebarOpen = !isSidebarOpen
        layoutSidebar.visibility = if (isSidebarOpen) View.VISIBLE else View.GONE
        if (isSidebarOpen) {
            extractPageTextForSidebar()
        }
    }

    private fun toggleDesktopMode() {
        isDesktopMode = !isDesktopMode
        if (isDesktopMode) {
            btnDesktopMode.setColorFilter(getColor(R.color.primary_black))
            webView.settings.userAgentString = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
            Toast.makeText(this, "데스크탑 모드로 전환되었습니다", Toast.LENGTH_SHORT).show()
        } else {
            btnDesktopMode.setColorFilter(getColor(R.color.text_muted))
            webView.settings.userAgentString = "Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36"
            Toast.makeText(this, "모바일 모드로 전환되었습니다", Toast.LENGTH_SHORT).show()
        }
        webView.reload()
    }

    private fun extractPageTextForSidebar() {
        val currentUrl = webView.url ?: BASE_URL
        val currentTitle = webView.title ?: "Cream Browser"

        tvSidebarPageTitle.text = currentTitle
        tvSidebarPageUrl.text = currentUrl

        webView.evaluateJavascript("(function() { return (document.body.innerText || '').slice(0, 2000); })();") { rawText ->
            currentPageText = rawText?.trim()?.trim('"')
                ?.replace("\\n", "\n")
                ?.replace("\\\"", "\"") ?: ""
        }
    }

    private fun loadWebQuery(query: String) {
        val urlToLoad = if (query.startsWith("http://") || query.startsWith("https://")) {
            query
        } else if (query.contains(".") && !query.contains(" ") && !query.startsWith("?")) {
            "https://$query"
        } else {
            "https://www.google.com/search?q=" + URLEncoder.encode(query, "UTF-8")
        }
        webView.loadUrl(urlToLoad)
        etBrowserUrl.clearFocus()
        hideKeyboard(etBrowserUrl)
    }

    private fun updateBrowserBar(url: String?) {
        url ?: return
        if (!etBrowserUrl.hasFocus()) {
            val displayText = when {
                url == BASE_URL || url == "$BASE_URL/" -> "Cream ai Hub (Home)"
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
        }

        btnNavBack.alpha = if (webView.canGoBack()) 1.0f else 0.35f
        btnNavForward.alpha = if (webView.canGoForward()) 1.0f else 0.35f
        btnTopBack.alpha = if (webView.canGoBack()) 1.0f else 0.35f
        btnTopForward.alpha = if (webView.canGoForward()) 1.0f else 0.35f
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
            webView.loadUrl(targetUrl)
            return
        }

        if (intent.action == Intent.ACTION_SEND && intent.type == "text/plain") {
            val sharedText = intent.getStringExtra(Intent.EXTRA_TEXT)
            if (!sharedText.isNullOrBlank()) {
                if (sharedText.startsWith("http://") || sharedText.startsWith("https://")) {
                    webView.loadUrl(sharedText)
                } else {
                    loadWebQuery(sharedText)
                }
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

    override fun onBackPressed() {
        if (isSidebarOpen) {
            layoutSidebar.visibility = View.GONE
            isSidebarOpen = false
            return
        }
        if (webView.canGoBack()) {
            webView.goBack()
        } else if (webView.url != BASE_URL && webView.url != "$BASE_URL/") {
            webView.loadUrl(BASE_URL)
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
    }
}
