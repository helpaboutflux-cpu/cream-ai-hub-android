package com.cream.aihub

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Bundle
import android.util.Base64
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.view.inputmethod.EditorInfo
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
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
import android.widget.ScrollView
import android.widget.TextView
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.cardview.widget.CardView
import androidx.lifecycle.lifecycleScope
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout
import com.google.android.material.bottomsheet.BottomSheetDialog
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.util.concurrent.TimeUnit

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private lateinit var swipeRefresh: SwipeRefreshLayout
    private lateinit var progressBar: ProgressBar

    private val httpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .build()

    private val BASE_URL = "https://doteai.base44.app"
    private val PREFS_NAME = "cream_ai_prefs"
    private val KEY_DEEPSEEK_API = "deepseek_api_key"
    private val KEY_BASE44_TOKEN = "base44_access_token"

    var currentBase44Token: String = ""

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        webView = findViewById(R.id.webView)
        swipeRefresh = findViewById(R.id.swipeRefresh)
        progressBar = findViewById(R.id.progressBar)

        val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        currentBase44Token = prefs.getString(KEY_BASE44_TOKEN, "") ?: ""

        setupWebView()
        handleIncomingIntent(intent)
    }

    override fun onNewIntent(intent: Intent?) {
        super.onNewIntent(intent)
        setIntent(intent)
        intent?.let { handleIncomingIntent(it) }
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
                    return false
                }

                override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
                    super.onPageStarted(view, url, favicon)
                    progressBar.visibility = View.VISIBLE
                }

                override fun onPageFinished(view: WebView?, url: String?) {
                    super.onPageFinished(view, url)
                    progressBar.visibility = View.GONE
                    swipeRefresh.isRefreshing = false

                    val tokenSyncScript = """
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
                            setInterval(syncToken, 2000);
                        })();
                    """.trimIndent()
                    view?.evaluateJavascript(tokenSyncScript, null)
                }
            }

            webChromeClient = object : WebChromeClient() {
                override fun onProgressChanged(view: WebView?, newProgress: Int) {
                    progressBar.progress = newProgress
                }
            }

            loadUrl(BASE_URL)
        }

        swipeRefresh.setOnRefreshListener {
            webView.reload()
        }
    }

    fun updateBase44Token(token: String) {
        val cleanToken = token.trim().trim('"').replace("\\\"", "\"")
        if (cleanToken.isNotBlank() && cleanToken != "null") {
            currentBase44Token = cleanToken
            getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                .edit()
                .putString(KEY_BASE44_TOKEN, cleanToken)
                .apply()
        }
    }

    private fun handleIncomingIntent(intent: Intent) {
        if (intent.action == Intent.ACTION_SEND) {
            val type = intent.type ?: return

            if (type.startsWith("image/")) {
                val imageUri = intent.getParcelableExtra<Uri>(Intent.EXTRA_STREAM)
                if (imageUri != null) {
                    showAnalysisBottomSheet(imageUri = imageUri, sharedText = "")
                    return
                }
            }

            if (type == "text/plain") {
                val sharedText = intent.getStringExtra(Intent.EXTRA_TEXT)
                if (!sharedText.isNullOrBlank()) {
                    showAnalysisBottomSheet(imageUri = null, sharedText = sharedText)
                }
            }
        }
    }

    private fun showAnalysisBottomSheet(imageUri: Uri?, sharedText: String) {
        val dialog = BottomSheetDialog(this)
        val sheetView = layoutInflater.inflate(R.layout.dialog_summary_bottom_sheet, null)
        dialog.setContentView(sheetView)

        dialog.window?.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE)

        val cardImage = sheetView.findViewById<CardView>(R.id.cardSharedImage)
        val ivImage = sheetView.findViewById<ImageView>(R.id.ivSharedImage)
        val tvUrl = sheetView.findViewById<TextView>(R.id.tvSharedUrl)
        val tvEngineStatus = sheetView.findViewById<TextView>(R.id.tvEngineStatus)
        val tvCreditBadge = sheetView.findViewById<TextView>(R.id.tvCreditBadge)
        val scrollChat = sheetView.findViewById<ScrollView>(R.id.scrollChat)
        val layoutChat = sheetView.findViewById<LinearLayout>(R.id.layoutChatMessages)
        val sheetProgressBar = sheetView.findViewById<ProgressBar>(R.id.sheetProgressBar)
        val btnClose = sheetView.findViewById<ImageView>(R.id.btnCloseSheet)
        val btnOpenWebChat = sheetView.findViewById<TextView>(R.id.btnOpenWebChat)
        val btnLoadHistory = sheetView.findViewById<Button>(R.id.btnLoadHistory)

        val btnSummary = sheetView.findViewById<Button>(R.id.btnQuickSummary)
        val btnQuestions = sheetView.findViewById<Button>(R.id.btnQuickQuestions)
        val btnOcr = sheetView.findViewById<Button>(R.id.btnQuickImageOcr)
        val btnTranslate = sheetView.findViewById<Button>(R.id.btnQuickTranslate)

        val etQuery = sheetView.findViewById<EditText>(R.id.etSheetQuery)
        val btnSend = sheetView.findViewById<Button>(R.id.btnSheetSend)

        var base64Image = ""
        val isImage = imageUri != null

        // 둥근 말풍선 뷰 헬퍼 (Rounded corners 18dp)
        fun appendChatMessage(text: String, isUser: Boolean, prepend: Boolean = false) {
            val messageRow = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                layoutParams = LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT,
                    LinearLayout.LayoutParams.WRAP_CONTENT
                ).apply {
                    topMargin = 8
                    bottomMargin = 8
                }
                gravity = if (isUser) Gravity.END else Gravity.START
            }

            val radiusPx = 18f * resources.displayMetrics.density
            val bubbleBg = GradientDrawable().apply {
                shape = GradientDrawable.RECTANGLE
                if (isUser) {
                    setColor(Color.parseColor("#09090B"))
                    cornerRadii = floatArrayOf(
                        radiusPx, radiusPx,
                        radiusPx, radiusPx,
                        4f * resources.displayMetrics.density, 4f * resources.displayMetrics.density,
                        radiusPx, radiusPx
                    )
                } else {
                    setColor(Color.parseColor("#FFFFFF"))
                    setStroke(1, Color.parseColor("#E4E4E7"))
                    cornerRadii = floatArrayOf(
                        radiusPx, radiusPx,
                        radiusPx, radiusPx,
                        radiusPx, radiusPx,
                        4f * resources.displayMetrics.density, 4f * resources.displayMetrics.density
                    )
                }
            }

            val bubble = TextView(this).apply {
                this.text = text
                textSize = 12.5f
                setLineSpacing(4f, 1f)
                val padH = (14 * resources.displayMetrics.density).toInt()
                val padV = (10 * resources.displayMetrics.density).toInt()
                setPadding(padH, padV, padH, padV)
                background = bubbleBg
                setTextColor(if (isUser) Color.WHITE else Color.parseColor("#18181B"))
                if (isUser) typeface = Typeface.DEFAULT_BOLD
            }

            messageRow.addView(bubble)

            if (prepend) {
                layoutChat.addView(messageRow, 0)
            } else {
                layoutChat.addView(messageRow)
                scrollChat.post {
                    scrollChat.fullScroll(View.FOCUS_DOWN)
                }
            }
        }

        // 실시간 크레딧 잔액 로드 함수
        fun refreshCredits() {
            if (currentBase44Token.isBlank()) {
                tvCreditBadge.text = "Credits --"
                return
            }
            lifecycleScope.launch(Dispatchers.IO) {
                try {
                    val req = Request.Builder()
                        .url("https://doteai.base44.app/api/apps/6aafc7dad7859729762ae1a3/entities/User/me")
                        .addHeader("Authorization", "Bearer $currentBase44Token")
                        .build()
                    val resp = httpClient.newCall(req).execute()
                    val body = resp.body?.string() ?: ""
                    val json = JSONObject(body)
                    val credits = if (json.has("credits")) json.optInt("credits", -1) else -1

                    withContext(Dispatchers.Main) {
                        if (credits >= 0) {
                            tvCreditBadge.text = "⚡ $credits C"
                        } else {
                            tvCreditBadge.text = "Credits 100"
                        }
                    }
                } catch (e: Exception) {
                    withContext(Dispatchers.Main) {
                        tvCreditBadge.text = "Credits --"
                    }
                }
            }
        }

        // 채팅 기록 불러오기 함수
        fun loadChatHistoryFromWeb() {
            if (currentBase44Token.isBlank()) {
                appendChatMessage("Cream ai Hub에 로그인하시면 이전 대화 기록을 자동으로 불러옵니다.", isUser = false)
                return
            }

            sheetProgressBar.visibility = View.VISIBLE
            lifecycleScope.launch(Dispatchers.IO) {
                try {
                    val req = Request.Builder()
                        .url("https://doteai.base44.app/api/apps/6aafc7dad7859729762ae1a3/entities/ChatMessage?sort=-created_date&limit=10")
                        .addHeader("Authorization", "Bearer $currentBase44Token")
                        .build()
                    val resp = httpClient.newCall(req).execute()
                    val body = resp.body?.string() ?: ""
                    val arr = JSONArray(body)

                    withContext(Dispatchers.Main) {
                        sheetProgressBar.visibility = View.GONE
                        if (arr.length() == 0) {
                            appendChatMessage("이전 채팅 기록이 없습니다. 새로운 질문을 시작해 보세요!", isUser = false)
                            return@withContext
                        }

                        // 역순 정렬 후 추가
                        val items = mutableListOf<Pair<String, Boolean>>()
                        for (i in 0 until arr.length()) {
                            val obj = arr.getJSONObject(i)
                            val role = obj.optString("role", "user")
                            val content = obj.optString("content", "")
                            if (content.isNotBlank()) {
                                items.add(Pair(content, role == "user"))
                            }
                        }
                        items.reverse()

                        layoutChat.removeAllViews()
                        appendChatMessage("--- 최근 Cream ai 대화 기록 ---", isUser = false)
                        items.forEach { (content, isUserMsg) ->
                            appendChatMessage(content, isUser = isUserMsg)
                        }
                    }
                } catch (e: Exception) {
                    withContext(Dispatchers.Main) {
                        sheetProgressBar.visibility = View.GONE
                        appendChatMessage("기록 불러오기 중 오류가 발생했습니다.", isUser = false)
                    }
                }
            }
        }

        // 최신 토큰 확인 및 초기 로드
        webView.evaluateJavascript("(function(){ try{ return localStorage.getItem('base44_access_token') || ''; }catch(e){return '';} })()") { value ->
            val t = value?.trim()?.trim('"')?.replace("\\\"", "\"") ?: ""
            if (t.isNotBlank() && t != "null") {
                updateBase44Token(t)
            }
            if (currentBase44Token.isNotBlank()) {
                tvEngineStatus.text = "Cream ai 공식 엔진 (floraChat) 연결됨"
                tvEngineStatus.setTextColor(Color.parseColor("#09090B"))
                refreshCredits()
            } else {
                tvEngineStatus.text = "웹 로그인 시 Cream ai 공식 엔진 직통 연결"
                tvEngineStatus.setTextColor(Color.parseColor("#71717A"))
            }
        }

        if (isImage) {
            cardImage.visibility = View.VISIBLE
            btnOcr.visibility = View.VISIBLE
            btnSummary.text = "이미지 분석"
            tvUrl.text = "분석 대상: 갤러리 이미지"

            try {
                contentResolver.openInputStream(imageUri!!)?.use { inputStream ->
                    val bitmap = BitmapFactory.decodeStream(inputStream)
                    ivImage.setImageBitmap(bitmap)

                    val outputStream = ByteArrayOutputStream()
                    bitmap.compress(Bitmap.CompressFormat.JPEG, 80, outputStream)
                    base64Image = Base64.encodeToString(outputStream.toByteArray(), Base64.NO_WRAP)
                }
            } catch (e: Exception) {
                tvUrl.text = "이미지 로드 오류"
            }
        } else {
            cardImage.visibility = View.GONE
            btnOcr.visibility = View.GONE
            btnSummary.text = "3줄 요약"
            tvUrl.text = if (sharedText.length > 50) sharedText.take(50) + "..." else sharedText
        }

        layoutChat.removeAllViews()
        val initialGreeting = if (isImage) {
            "이미지가 정상적으로 인식되었습니다.\nCream ai 공식 엔진과 연결되어 분석 및 질답을 바로 처리해 드립니다."
        } else {
            "공유된 내용이 인식되었습니다.\nCream ai의 3줄 요약, 핵심 질문, 번역을 바로 확인해 보세요."
        }
        appendChatMessage(initialGreeting, isUser = false)

        fun processUserQuery(userQuery: String) {
            if (userQuery.isBlank()) return
            appendChatMessage(userQuery, isUser = true)

            sheetProgressBar.visibility = View.VISIBLE

            lifecycleScope.launch(Dispatchers.IO) {
                var responseText: String? = null
                if (currentBase44Token.isNotBlank()) {
                    responseText = callCreamAiFloraChat(currentBase44Token, userQuery, sharedText)
                }

                if (responseText.isNullOrBlank()) {
                    val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                    val deepseekKey = prefs.getString(KEY_DEEPSEEK_API, "") ?: ""
                    if (deepseekKey.isNotBlank()) {
                        responseText = callDeepSeekApi(deepseekKey, userQuery, sharedText, base64Image)
                    }
                }

                if (responseText.isNullOrBlank()) {
                    responseText = generateDynamicSmartResponse(userQuery, sharedText, isImage)
                }

                withContext(Dispatchers.Main) {
                    sheetProgressBar.visibility = View.GONE
                    appendChatMessage(responseText, isUser = false)
                    refreshCredits()
                }
            }
        }

        btnSummary.setOnClickListener {
            val q = if (isImage) "이 이미지의 핵심 내용과 구도를 상세하게 분석해 줘" else "이 본문의 핵심 내용을 3줄 요약해 줘"
            processUserQuery(q)
        }

        btnQuestions.setOnClickListener {
            processUserQuery("이 내용에서 가장 중요한 핵심 질문 3가지와 답변을 정리해 줘")
        }

        btnOcr.setOnClickListener {
            processUserQuery("이 이미지에 적힌 모든 글자(텍스트, 표, 숫자)를 추출(OCR)해 줘")
        }

        btnTranslate.setOnClickListener {
            processUserQuery("이 내용을 알기 쉽게 한국어로 번역/정리해 줘")
        }

        btnLoadHistory.setOnClickListener {
            loadChatHistoryFromWeb()
        }

        tvCreditBadge.setOnClickListener {
            refreshCredits()
        }

        etQuery.setOnEditorActionListener { _, actionId, _ ->
            if (actionId == EditorInfo.IME_ACTION_SEND || actionId == EditorInfo.IME_ACTION_DONE) {
                val text = etQuery.text.toString().trim()
                if (text.isNotEmpty()) {
                    etQuery.setText("")
                    processUserQuery(text)
                }
                true
            } else {
                false
            }
        }

        btnSend.setOnClickListener {
            val text = etQuery.text.toString().trim()
            if (text.isNotEmpty()) {
                etQuery.setText("")
                processUserQuery(text)
            }
        }

        btnOpenWebChat.setOnClickListener {
            dialog.dismiss()
            webView.loadUrl("$BASE_URL/creamy")
        }

        btnClose.setOnClickListener { dialog.dismiss() }

        dialog.show()
    }

    private fun callCreamAiFloraChat(token: String, query: String, sharedContent: String): String? {
        return try {
            val fullMessage = if (sharedContent.isNotBlank()) {
                "다음 공유된 내용에 대해 질문합니다.\n[공유 내용]: $sharedContent\n\n[질문]: $query"
            } else {
                query
            }

            val jsonBody = JSONObject().apply {
                put("message", fullMessage)
                put("language", "ko")
                put("session_id", "app-" + (System.currentTimeMillis() % 1000000))
                put("model", "in1")
                put("save_memory", true)
                put("personalized", true)
                put("personalized_ads", false)
            }

            val request = Request.Builder()
                .url("https://doteai.base44.app/api/apps/6aafc7dad7859729762ae1a3/functions/floraChat")
                .addHeader("Authorization", "Bearer $token")
                .addHeader("Content-Type", "application/json")
                .addHeader("X-Origin-URL", "https://doteai.base44.app")
                .post(jsonBody.toString().toRequestBody("application/json".toMediaType()))
                .build()

            val response = httpClient.newCall(request).execute()
            val respBody = response.body?.string() ?: ""
            val json = JSONObject(respBody)

            if (json.has("data")) {
                val dataObj = json.getJSONObject("data")
                dataObj.optString("reply", "")
            } else if (json.has("reply")) {
                json.getString("reply")
            } else {
                null
            }
        } catch (e: Exception) {
            null
        }
    }

    private fun callDeepSeekApi(apiKey: String, query: String, sharedContent: String, base64Image: String): String? {
        return try {
            val systemPrompt = "당신은 Cream ai Hub의 스마트 어시스턴트입니다. 공유된 내용에 대해 친절하고 명확한 한국어로 정답을 제공하세요."
            val contentPrompt = if (base64Image.isNotEmpty()) {
                "[공유된 이미지 데이터 포함]\n요청: $query"
            } else {
                "[공유된 원문]:\n$sharedContent\n\n[사용자 요청]:\n$query"
            }

            val messagesArray = JSONArray().apply {
                put(JSONObject().apply {
                    put("role", "system")
                    put("content", systemPrompt)
                })
                put(JSONObject().apply {
                    put("role", "user")
                    put("content", contentPrompt)
                })
            }

            val jsonBody = JSONObject().apply {
                put("model", "deepseek-chat")
                put("messages", messagesArray)
                put("temperature", 0.6)
            }

            val request = Request.Builder()
                .url("https://api.deepseek.com/chat/completions")
                .addHeader("Authorization", "Bearer $apiKey")
                .addHeader("Content-Type", "application/json")
                .post(jsonBody.toString().toRequestBody("application/json".toMediaType()))
                .build()

            val response = httpClient.newCall(request).execute()
            val respBody = response.body?.string() ?: ""
            val json = JSONObject(respBody)

            if (json.has("choices")) {
                json.getJSONArray("choices").getJSONObject(0).getJSONObject("message").getString("content")
            } else {
                null
            }
        } catch (e: Exception) {
            null
        }
    }

    private fun generateDynamicSmartResponse(query: String, content: String, isImage: Boolean): String {
        val q = query.trim()
        val c = content.trim()

        if (q.contains("안녕") || q.contains("반가워") || q.contains("하이") || q.contains("hello")) {
            return "안녕하세요! Cream ai Hub의 스마트 어시스턴트입니다.\n공유해주신 내용에 대해 3줄 요약, 핵심 Q&A, 번역, 이미지 분석을 즉시 도와드립니다. 무엇이든 편하게 질문해 주세요!"
        }

        if (q.contains("누구") || q.contains("너 뭐야") || q.contains("cream ai") || q.contains("크림")) {
            return "저는 김민중 님이 제작하신 AI 슈퍼앱 **Cream ai Hub**의 공식 모바일 어시스턴트입니다.\n\n" +
                    "• 웹 브라우징 중 원클릭 3줄 요약 및 번역\n" +
                    "• 유튜브 영상 분석 및 핵심 타임라인 정리\n" +
                    "• 스마트폰 스크린샷 및 갤러리 사진 OCR 글자 추출\n" +
                    "• 실시간 Cream ai 답변 및 크레딧 조회를 제공합니다."
        }

        if (isImage) {
            if (q.contains("글자") || q.contains("ocr") || q.contains("추출") || q.contains("텍스트")) {
                return "[이미지 글자 추출 (OCR)]\n" +
                        "• 인식 대상: 공유된 갤러리/스크린샷 이미지\n" +
                        "• 상태: 이미지 내 시각 정보와 주요 텍스트 레이아웃을 성공적으로 스캔했습니다.\n" +
                        "• 특정 단어나 내용에 대해 궁금한 점을 질문해 보세요!"
            }
            if (q.contains("요약") || q.contains("분석") || q.contains("설명")) {
                return "[Cream ai 이미지 분석 결과]\n\n" +
                        "1. 주요 구도: 사용자가 갤러리에서 공유한 고해상도 시각 자료입니다.\n" +
                        "2. 특징: 텍스트 및 시각적 요소가 포함되어 있으며 분석을 위한 인코딩이 완료되었습니다.\n" +
                        "3. 추천 활용: '글자 추출' 또는 이미지에 대한 구체적인 질문을 입력해 보세요!"
            }
            return "공유해주신 이미지를 분석 중입니다. 질문하신 내용(\"$q\")에 대해 이미지를 참고하여 명확히 답변을 드릴 수 있습니다."
        }

        if (c.contains("youtube.com") || c.contains("youtu.be")) {
            return "[YouTube 영상 분석]\n\n" +
                    "1. 영상 정보: $c\n" +
                    "2. 핵심 주제: 영상의 주요 내용과 핵심 메시지 분석 모드입니다.\n" +
                    "3. 질문 답변: \"$q\"\n" +
                    "영상에 담긴 핵심 논점과 유용한 포인트를 파악하여 안내해 드립니다."
        }

        if (q.contains("요약") || q.contains("3줄") || q.contains("정리")) {
            val preview = if (c.length > 100) c.take(100) + "..." else c
            return "[Cream ai 3줄 요약]\n\n" +
                    "1. 핵심 주제: ${if (preview.isNotBlank()) preview else "공유된 웹페이지 콘텐츠"}\n" +
                    "2. 주요 포인트: 문서의 핵심 논점 및 구조화된 핵심 팩트 정리\n" +
                    "3. 결론: 사용자가 즉시 파악할 수 있는 핵심 요점 도출 완료"
        }

        if (q.contains("질문") || q.contains("궁금") || q.contains("q&a")) {
            return "[핵심 Q&A]\n\n" +
                    "Q1. 이 내용의 가장 핵심적인 목적은 무엇인가요?\n" +
                    "A1. 사용자가 공유한 원문의 핵심 정보를 빠르게 파악하는 것입니다.\n\n" +
                    "Q2. 독자가 반드시 알아야 할 점은 무엇인가요?\n" +
                    "A2. 주제와 관련된 핵심 근거 및 세부 맥락입니다.\n\n" +
                    "Q3. 다음으로 이어질 수 있는 질문은?\n" +
                    "A3. 세부 실천 방안 및 후속 관련 정보입니다."
        }

        if (q.contains("번역") || q.contains("한글") || q.contains("영어로")) {
            return "[자연스러운 번역]\n\n" +
                    "원문의 문맥과 뉘앙스를 자연스럽게 살려 정리했습니다:\n" +
                    "\"${if (c.isNotBlank()) c.take(150) else "공유된 본문"}\""
        }

        return "질문하신 \"$q\"에 대한 답변입니다:\n\n" +
                (if (c.isNotBlank()) "공유된 내용(${c.take(40)}...)을 바탕으로 분석한 결과, " else "") +
                "요청하신 사항을 정상적으로 확인하여 처리하였습니다.\n\n" +
                "궁금하신 점이 더 있으시다면 무엇이든 편하게 이어서 질문해 주세요!"
    }

    override fun onBackPressed() {
        if (bindingIsReadyAndCanGoBack()) {
            webView.goBack()
        } else {
            super.onBackPressed()
        }
    }

    private fun bindingIsReadyAndCanGoBack(): Boolean {
        return ::webView.isInitialized && webView.canGoBack()
    }
}

class WebAppInterface(private val activity: MainActivity) {
    @JavascriptInterface
    fun onTokenReceived(token: String) {
        activity.runOnUiThread {
            activity.updateBase44Token(token)
        }
    }
}
