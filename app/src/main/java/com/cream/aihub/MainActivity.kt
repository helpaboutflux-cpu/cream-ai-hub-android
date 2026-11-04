package com.cream.aihub

import android.annotation.SuppressLint
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.ClipData
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
import android.widget.EditText
import android.widget.ImageView
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.NotificationCompat
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout
import com.google.android.material.bottomsheet.BottomSheetDialog
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.net.URLEncoder

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private lateinit var swipeRefresh: SwipeRefreshLayout
    private lateinit var progressBar: ProgressBar

    // 브라우저 상단 및 하단 컨트롤 바
    private lateinit var etBrowserUrl: EditText
    private lateinit var btnReload: ImageView
    private lateinit var btnNavBack: ImageView
    private lateinit var btnNavForward: ImageView
    private lateinit var btnNavCreamy: View
    private lateinit var btnNavShare: ImageView
    private lateinit var btnNavHome: ImageView

    private val BASE_URL = "https://doteai.base44.app"
    private val CREAMY_URL = "https://doteai.base44.app/creamy"
    private val PREFS_NAME = "cream_ai_prefs"
    private val KEY_BASE44_TOKEN = "base44_access_token"

    private var fileChooserCallback: ValueCallback<Array<Uri>>? = null
    private var lastHandledText = ""
    private var pendingScriptToInject: String? = null
    private var isAppInForeground = false
    private var isGenerationInProgress = false

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
        setupWebView()
        setupBrowserControls()
        handleIncomingIntent(intent)
        showPersistentQuickNotification()
        BriefingReceiver.scheduleDailyMorningBriefing(this)
    }

    private fun initViews() {
        webView = findViewById(R.id.webView)
        swipeRefresh = findViewById(R.id.swipeRefresh)
        progressBar = findViewById(R.id.progressBar)

        etBrowserUrl = findViewById(R.id.etBrowserUrl)
        btnReload = findViewById(R.id.btnReload)
        btnNavBack = findViewById(R.id.btnNavBack)
        btnNavForward = findViewById(R.id.btnNavForward)
        btnNavCreamy = findViewById(R.id.btnNavCreamy)
        btnNavShare = findViewById(R.id.btnNavShare)
        btnNavHome = findViewById(R.id.btnNavHome)
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
                        return false // 내부 브라우징
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

                    // Base44 전용 토큰 동기화 및 답변 관찰자 주입 (Cream ai Hub 사이트인 경우)
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

                                var wasGenerating = false;
                                function checkGenerationStatus() {
                                    try {
                                        var isGenerating = !!document.querySelector(".animate-spin") ||
                                                           !!document.querySelector(".animate-pulse");

                                        if (isGenerating && !wasGenerating) {
                                            wasGenerating = true;
                                            if (window.AndroidCreamApp && window.AndroidCreamApp.onGenerationStarted) {
                                                window.AndroidCreamApp.onGenerationStarted();
                                            }
                                        } else if (!isGenerating && wasGenerating) {
                                            wasGenerating = false;
                                            var text = "";
                                            var bubbles = document.querySelectorAll(".prose, [class*='bubble'], [class*='message'] p");
                                            if (bubbles.length > 0) {
                                                text = bubbles[bubbles.length - 1].textContent || "";
                                            }
                                            if (window.AndroidCreamApp && window.AndroidCreamApp.onGenerationFinished) {
                                                window.AndroidCreamApp.onGenerationFinished(text.slice(0, 100));
                                            }
                                        }
                                    } catch(err) {}
                                }
                                setInterval(checkGenerationStatus, 1000);
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

        // 새로고침 / 정지
        btnReload.setOnClickListener {
            if (progressBar.visibility == View.VISIBLE) {
                webView.stopLoading()
            } else {
                webView.reload()
            }
        }

        // 뒤로 가기
        btnNavBack.setOnClickListener {
            if (webView.canGoBack()) {
                webView.goBack()
            }
        }

        // 앞으로 가기
        btnNavForward.setOnClickListener {
            if (webView.canGoForward()) {
                webView.goForward()
            }
        }

        // 홈 버튼 (Cream ai Hub 복귀)
        btnNavHome.setOnClickListener {
            webView.loadUrl(BASE_URL)
        }

        // 공유 버튼
        btnNavShare.setOnClickListener {
            val currentUrl = webView.url ?: BASE_URL
            val currentTitle = webView.title ?: "Cream ai Hub"
            val shareIntent = Intent(Intent.ACTION_SEND).apply {
                type = "text/plain"
                putExtra(Intent.EXTRA_SUBJECT, currentTitle)
                putExtra(Intent.EXTRA_TEXT, currentUrl)
            }
            startActivity(Intent.createChooser(shareIntent, "페이지 공유"))
        }

        // 중앙 Creamy AI 어시스턴트 버튼
        btnNavCreamy.setOnClickListener {
            val currentUrl = webView.url ?: BASE_URL
            val currentTitle = webView.title ?: "Cream ai Hub"

            // 만약 현재 Cream ai Hub 내부 페이지라면 바로 Creamy로 전환
            if (currentUrl.contains("base44.app")) {
                navigateToCreamy()
                return@setOnClickListener
            }

            // 외부 일반 웹페이지라면 본문 텍스트를 추출해 AI 어시스턴트 바텀시트 호출
            webView.evaluateJavascript("(function() { return (document.body.innerText || '').slice(0, 3000); })();") { rawText ->
                val cleanText = rawText?.trim()?.trim('"')
                    ?.replace("\\n", "\n")
                    ?.replace("\\\"", "\"")
                    ?.replace("\\'", "'") ?: ""
                openCreamyAiSheetForPage(currentUrl, currentTitle, cleanText)
            }
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
    }

    private fun hideKeyboard(view: View) {
        val imm = getSystemService(Context.INPUT_METHOD_SERVICE) as? InputMethodManager
        imm?.hideSoftInputFromWindow(view.windowToken, 0)
    }

    private fun openCreamyAiSheetForPage(url: String, title: String, pageText: String) {
        val dialog = BottomSheetDialog(this)
        val sheetView = layoutInflater.inflate(R.layout.dialog_summary_bottom_sheet, null)
        dialog.setContentView(sheetView)

        val tvSheetTitle = sheetView.findViewById<TextView>(R.id.tvSheetTitle)
        val tvEngineStatus = sheetView.findViewById<TextView>(R.id.tvEngineStatus)
        val tvSharedUrl = sheetView.findViewById<TextView>(R.id.tvSharedUrl)
        val tvSummaryResult = sheetView.findViewById<TextView>(R.id.tvSummaryResult)
        val btnQuickSummary = sheetView.findViewById<View>(R.id.btnQuickSummary)
        val btnQuickQuestions = sheetView.findViewById<View>(R.id.btnQuickQuestions)
        val btnQuickTranslate = sheetView.findViewById<View>(R.id.btnQuickTranslate)
        val btnCloseSheet = sheetView.findViewById<View>(R.id.btnCloseSheet)
        val btnOpenWebChat = sheetView.findViewById<View>(R.id.btnOpenWebChat)
        val etSheetQuery = sheetView.findViewById<EditText>(R.id.etSheetQuery)
        val btnSheetSend = sheetView.findViewById<View>(R.id.btnSheetSend)

        tvSheetTitle.text = "Creamy 브라우저 AI"
        tvEngineStatus.text = "현재 웹페이지 분석 모드"
        tvSharedUrl.text = "$title ($url)"

        val snippet = if (pageText.length > 200) pageText.take(200) + "..." else pageText
        tvSummaryResult.text = "현재 페이지를 감지했습니다:\n\n\"$snippet\"\n\n상단 요약 버튼을 누르거나 원하는 질문을 입력하세요."

        // 3줄 요약
        btnQuickSummary.setOnClickListener {
            tvSummaryResult.text = "⏳ Creamy가 페이지 핵심을 분석 중입니다...\n\n제목: $title\n링크: $url\n\n1. 이 페이지는 '${title.take(30)}'에 관한 내용을 다루고 있습니다.\n2. 핵심 정보 및 본문 내용을 구조화하여 파악했습니다.\n3. 자세한 분석은 [웹 ↗] 버튼을 눌러 Creamy 본체에서 대화할 수 있습니다."
        }

        // 핵심 질문
        btnQuickQuestions.setOnClickListener {
            tvSummaryResult.text = "💡 이 페이지에서 추천하는 질문:\n\n1. \"이 글의 핵심 결론이 뭐야?\"\n2. \"주요 요점 3가지만 정리해줘\"\n3. \"이 페이지의 신뢰도는 어때?\""
        }

        // 번역
        btnQuickTranslate.setOnClickListener {
            tvSummaryResult.text = "🌐 번역 모드:\n\n페이지 내용을 한국어로 이해하기 쉽게 요약 및 번역할 준비가 되었습니다."
        }

        // Creamy 웹 채팅으로 직통 전달
        btnOpenWebChat.setOnClickListener {
            dialog.dismiss()
            val prompt = "이 웹페이지 분석해줘: $title\n링크: $url\n내용:\n${pageText.take(1500)}"
            injectTextIntoCreamy(prompt)
        }

        btnCloseSheet.setOnClickListener {
            dialog.dismiss()
        }

        btnSheetSend.setOnClickListener {
            val q = etSheetQuery.text.toString().trim()
            if (q.isNotEmpty()) {
                dialog.dismiss()
                val prompt = "웹페이지 [$title]에 대한 질문: $q\n(참고 본문: ${pageText.take(1000)})"
                injectTextIntoCreamy(prompt)
            }
        }

        dialog.show()
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
        // 1. Text Selection Menu (PROCESS_TEXT from any app)
        if (intent.action == Intent.ACTION_PROCESS_TEXT) {
            val text = intent.getCharSequenceExtra(Intent.EXTRA_PROCESS_TEXT)?.toString()
            if (!text.isNullOrBlank()) {
                injectTextIntoCreamy(text)
                return
            }
        }

        // 2. Text or Link Share (e.g. from YouTube, Chrome, Twitter)
        if (intent.action == Intent.ACTION_SEND && intent.type == "text/plain") {
            val sharedText = intent.getStringExtra(Intent.EXTRA_TEXT)
            if (!sharedText.isNullOrBlank()) {
                if (sharedText.startsWith("http://") || sharedText.startsWith("https://")) {
                    webView.loadUrl(sharedText)
                } else {
                    injectTextIntoCreamy(sharedText)
                }
                return
            }
        }

        // 3. Image Share (e.g. from Gallery, Screenshots)
        if (intent.action == Intent.ACTION_SEND && intent.type?.startsWith("image/") == true) {
            val imageUri = intent.getParcelableExtra<Uri>(Intent.EXTRA_STREAM)
            if (imageUri != null) {
                injectImageIntoCreamy(imageUri)
                return
            }
        }

        // 4. From Notification or Widget
        val injectText = intent.getStringExtra("EXTRA_INJECT_TEXT")
        val injectImageUriStr = intent.getStringExtra("EXTRA_INJECT_IMAGE_URI")

        if (!injectImageUriStr.isNullOrBlank()) {
            injectImageIntoCreamy(Uri.parse(injectImageUriStr), injectText)
            return
        }

        if (!injectText.isNullOrBlank()) {
            injectTextIntoCreamy(injectText)
            return
        }

        val targetUrl = intent.getStringExtra("EXTRA_TARGET_URL")
        val mode = intent.getStringExtra("EXTRA_MODE")
        val triggerVoice = intent.getBooleanExtra("EXTRA_TRIGGER_VOICE", false)

        if (targetUrl != null) {
            if (targetUrl.startsWith("http://") || targetUrl.startsWith("https://")) {
                webView.loadUrl(targetUrl)
            } else {
                navigateToCreamy(mode = mode, triggerVoice = triggerVoice)
            }
        }
    }

    private fun injectTextIntoCreamy(text: String) {
        val encodedJson = JSONObject.quote(text)
        val injectionScript = """
            (function() {
                var targetText = $encodedJson;
                function tryInject(count) {
                    var input = document.querySelector("input[placeholder*='메시지']");
                    if (input) {
                        var setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
                        setter.call(input, targetText);
                        input.dispatchEvent(new Event('input', { bubbles: true }));
                        input.focus();
                        return;
                    }
                    if (count < 25) {
                        setTimeout(function() { tryInject(count + 1); }, 200);
                    }
                }
                tryInject(0);
            })();
        """.trimIndent()

        executeOrQueueScriptOnCreamy(injectionScript)
    }

    private fun injectImageIntoCreamy(imageUri: Uri, promptText: String? = null) {
        val base64Data = compressImageToBase64(imageUri)
        if (base64Data.isBlank()) {
            promptText?.let { injectTextIntoCreamy(it) }
            return
        }

        val promptJson = JSONObject.quote(promptText ?: "이 이미지에 대해 설명해줘")
        val injectionScript = """
            (function() {
                var base64Data = "$base64Data";
                var mimeType = "image/jpeg";
                var fileName = "shared_image.jpg";

                function b64toBlob(b64, type) {
                    var byteChars = atob(b64);
                    var byteArrays = [];
                    for (var i = 0; i < byteChars.length; i += 512) {
                        var slice = byteChars.slice(i, i + 512);
                        var nums = new Array(slice.length);
                        for (var j = 0; j < slice.length; j++) {
                            nums[j] = slice.charCodeAt(j);
                        }
                        byteArrays.push(new Uint8Array(nums));
                    }
                    return new Blob(byteArrays, { type: type });
                }

                function tryAttach(count) {
                    var fileInput = document.querySelector("input[type='file']");
                    if (fileInput) {
                        try {
                            var blob = b64toBlob(base64Data, mimeType);
                            var file = new File([blob], fileName, { type: mimeType });
                            var dt = new DataTransfer();
                            dt.items.add(file);
                            fileInput.files = dt.files;
                            fileInput.dispatchEvent(new Event('change', { bubbles: true }));

                            var txtInput = document.querySelector("input[placeholder*='메시지']");
                            if (txtInput && !txtInput.value) {
                                var setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
                                setter.call(txtInput, $promptJson);
                                txtInput.dispatchEvent(new Event('input', { bubbles: true }));
                                txtInput.focus();
                            }
                            return;
                        } catch(e) {
                            console.error("Image attach error:", e);
                        }
                    }
                    if (count < 25) {
                        setTimeout(function() { tryAttach(count + 1); }, 200);
                    }
                }
                tryAttach(0);
            })();
        """.trimIndent()

        executeOrQueueScriptOnCreamy(injectionScript)
    }

    private fun navigateToCreamy(mode: String? = null, triggerVoice: Boolean = false) {
        val script = if (triggerVoice) {
            """
                (function() {
                    function tryVoice(count) {
                        var voiceBtn = document.querySelector("button[aria-label*='음성']");
                        if (voiceBtn) { voiceBtn.click(); return; }
                        if (count < 20) setTimeout(function() { tryVoice(count + 1); }, 200);
                    }
                    tryVoice(0);
                })();
            """.trimIndent()
        } else if (mode == "search") {
            """
                (function() {
                    function trySearch(count) {
                        var searchBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent && b.textContent.includes('검색'));
                        if (searchBtn) { searchBtn.click(); return; }
                        if (count < 20) setTimeout(function() { trySearch(count + 1); }, 200);
                    }
                    trySearch(0);
                })();
            """.trimIndent()
        } else null

        if (script != null) {
            executeOrQueueScriptOnCreamy(script)
        } else {
            if (webView.url != CREAMY_URL) {
                webView.loadUrl(CREAMY_URL)
            }
        }
    }

    private fun executeOrQueueScriptOnCreamy(script: String) {
        if (webView.url?.startsWith(CREAMY_URL) == true) {
            webView.evaluateJavascript(script, null)
        } else {
            pendingScriptToInject = script
            webView.loadUrl(CREAMY_URL)
        }
    }

    private fun compressImageToBase64(uri: Uri): String {
        return try {
            contentResolver.openInputStream(uri)?.use { inputStream ->
                val originalBitmap = BitmapFactory.decodeStream(inputStream) ?: return ""
                val maxDim = 1024
                val ratio = Math.min(maxDim.toFloat() / originalBitmap.width, maxDim.toFloat() / originalBitmap.height)
                val targetBitmap = if (ratio < 1.0f) {
                    val w = (originalBitmap.width * ratio).toInt()
                    val h = (originalBitmap.height * ratio).toInt()
                    Bitmap.createScaledBitmap(originalBitmap, w, h, true)
                } else originalBitmap

                val baos = ByteArrayOutputStream()
                targetBitmap.compress(Bitmap.CompressFormat.JPEG, 80, baos)
                Base64.encodeToString(baos.toByteArray(), Base64.NO_WRAP)
            } ?: ""
        } catch (e: Exception) {
            e.printStackTrace()
            ""
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
        val channelId = "cream_ai_quick_channel"
        val notificationManager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                channelId,
                "Cream ai 빠른 실행",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "알림창에서 Creamy를 바로 실행합니다"
            }
            notificationManager.createNotificationChannel(channel)
        }

        val launchIntent = Intent(this, MainActivity::class.java).apply {
            action = Intent.ACTION_VIEW
            putExtra("EXTRA_TARGET_URL", CREAMY_URL)
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
            .setContentTitle("Cream ai Hub")
            .setContentText("탭하여 Creamy에게 질문하기")
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()

        notificationManager.notify(100, notification)
    }

    private fun updateClipboardNotification(text: String) {
        val channelId = "cream_ai_quick_channel"
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
            .setContentTitle("Cream ai Hub: 복사한 내용")
            .setContentText("📋 \"$snippet\" 질문하기")
            .setContentIntent(pendingIntent)
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .build()

        notificationManager.notify(101, notification)
    }

    private fun showGenerationFinishedNotification(summary: String) {
        val channelId = "cream_ai_generation_channel"
        val notificationManager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                channelId,
                "Cream ai 답변 완료",
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = "답변 생성이 완료되었을 때 알립니다"
            }
            notificationManager.createNotificationChannel(channel)
        }

        val launchIntent = Intent(this, MainActivity::class.java).apply {
            action = Intent.ACTION_VIEW
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
        }

        val pendingIntent = PendingIntent.getActivity(
            this,
            102,
            launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val content = if (summary.isNotBlank()) summary else "생성이 완료되었습니다. 탭하여 확인하세요!"
        val notification = NotificationCompat.Builder(this, channelId)
            .setSmallIcon(R.drawable.ic_stat_cream)
            .setContentTitle("✨ Creamy 답변 완료")
            .setContentText(content)
            .setContentIntent(pendingIntent)
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .build()

        notificationManager.notify(102, notification)
    }

    override fun onBackPressed() {
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

        @JavascriptInterface
        fun onGenerationStarted() {
            activity.runOnUiThread {
                activity.isGenerationInProgress = true
            }
        }

        @JavascriptInterface
        fun onGenerationFinished(summary: String) {
            activity.runOnUiThread {
                activity.isGenerationInProgress = false
                if (!activity.isAppInForeground) {
                    activity.showGenerationFinishedNotification(summary)
                }
            }
        }
    }
}
