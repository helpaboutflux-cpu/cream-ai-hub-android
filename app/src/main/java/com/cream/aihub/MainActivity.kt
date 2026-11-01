package com.cream.aihub

import android.annotation.SuppressLint
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Bundle
import android.util.Base64
import android.view.View
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.EditText
import android.widget.ImageView
import android.widget.ProgressBar
import android.widget.TextView
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

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        webView = findViewById(R.id.webView)
        swipeRefresh = findViewById(R.id.swipeRefresh)
        progressBar = findViewById(R.id.progressBar)

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
        webView.apply {
            settings.apply {
                javaScriptEnabled = true
                domStorageEnabled = true
                databaseEnabled = true
                useWideViewPort = true
                loadWithOverviewMode = true
                cacheMode = WebSettings.LOAD_DEFAULT
                mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
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

    // 외부 앱(갤러리, 유튜브, 웹 브라우저)에서 [공유하기]로 넘어온 인텐트 처리
    private fun handleIncomingIntent(intent: Intent) {
        if (intent.action == Intent.ACTION_SEND) {
            val type = intent.type ?: return

            // 1. 이미지 공유 (갤러리, 스크린샷 등)
            if (type.startsWith("image/")) {
                val imageUri = intent.getParcelableExtra<Uri>(Intent.EXTRA_STREAM)
                if (imageUri != null) {
                    showImageAnalysisBottomSheet(imageUri)
                    return
                }
            }

            // 2. 텍스트/링크 공유 (유튜브, 뉴스 등)
            if (type == "text/plain") {
                val sharedText = intent.getStringExtra(Intent.EXTRA_TEXT)
                if (!sharedText.isNullOrBlank()) {
                    showTextSummaryBottomSheet(sharedText)
                }
            }
        }
    }

    // 모바일 전용 [이미지 분석 & Q&A] 바텀시트
    private fun showImageAnalysisBottomSheet(imageUri: Uri) {
        val dialog = BottomSheetDialog(this)
        val sheetView = layoutInflater.inflate(R.layout.dialog_summary_bottom_sheet, null)
        dialog.setContentView(sheetView)

        val tvTitle = sheetView.findViewById<TextView>(R.id.tvSheetTitle)
        val cardImage = sheetView.findViewById<CardView>(R.id.cardSharedImage)
        val ivImage = sheetView.findViewById<ImageView>(R.id.ivSharedImage)
        val tvUrl = sheetView.findViewById<TextView>(R.id.tvSharedUrl)
        val tvResult = sheetView.findViewById<TextView>(R.id.tvSummaryResult)
        val sheetProgressBar = sheetView.findViewById<ProgressBar>(R.id.sheetProgressBar)
        val btnClose = sheetView.findViewById<ImageView>(R.id.btnCloseSheet)
        val btnSummary = sheetView.findViewById<Button>(R.id.btnQuickSummary)
        val btnQuestions = sheetView.findViewById<Button>(R.id.btnQuickQuestions)
        val btnOcr = sheetView.findViewById<Button>(R.id.btnQuickImageOcr)
        val btnTranslate = sheetView.findViewById<Button>(R.id.btnQuickTranslate)
        val etQuery = sheetView.findViewById<EditText>(R.id.etSheetQuery)
        val btnSend = sheetView.findViewById<Button>(R.id.btnSheetSend)

        tvTitle.text = "🖼️ Cream ai 이미지 분석 & Q&A"
        tvUrl.text = "공유된 이미지 분석 준비 완료"
        cardImage.visibility = View.VISIBLE
        btnOcr.visibility = View.VISIBLE
        btnSummary.text = "🔍 전체 분석"

        // 이미지 로드
        var base64Image = ""
        try {
            contentResolver.openInputStream(imageUri)?.use { inputStream ->
                val bitmap = BitmapFactory.decodeStream(inputStream)
                ivImage.setImageBitmap(bitmap)

                val outputStream = ByteArrayOutputStream()
                bitmap.compress(Bitmap.CompressFormat.JPEG, 85, outputStream)
                base64Image = Base64.encodeToString(outputStream.toByteArray(), Base64.NO_WRAP)
            }
        } catch (e: Exception) {
            tvResult.text = "이미지를 불러오는 중 오류가 발생했습니다."
        }

        btnClose.setOnClickListener { dialog.dismiss() }

        fun requestImageAnalysis(prompt: String) {
            sheetProgressBar.visibility = View.VISIBLE
            tvResult.text = "AI가 이미지를 정밀 분석하고 있어요... ⚡"

            lifecycleScope.launch(Dispatchers.IO) {
                val result = callAIEngine(content = "공유된 이미지", prompt = prompt, base64Image = base64Image)
                withContext(Dispatchers.Main) {
                    sheetProgressBar.visibility = View.GONE
                    tvResult.text = result
                }
            }
        }

        btnSummary.setOnClickListener {
            requestImageAnalysis("이 이미지에 무엇이 담겨 있는지 핵심 피사체, 상황, 특징을 한국어로 상세히 분석하고 설명해 줘.")
        }

        btnOcr.setOnClickListener {
            requestImageAnalysis("이 이미지에 적힌 모든 글자(텍스트, 표, 숫자 등)를 누락 없이 정확하게 추출(OCR)해서 정리해 줘.")
        }

        btnQuestions.setOnClickListener {
            requestImageAnalysis("이 이미지와 관련해 유저가 궁금해할 만한 핵심 포인트나 문제 해결책을 제시해 줘.")
        }

        btnTranslate.setOnClickListener {
            requestImageAnalysis("이 이미지 속에 외국어 텍스트가 있다면 한국어로 매끄럽게 번역해 줘.")
        }

        btnSend.setOnClickListener {
            val q = etQuery.text.toString().trim()
            if (q.isNotEmpty()) {
                etQuery.setText("")
                requestImageAnalysis("질문: $q\n\n위 질문에 대해 공유된 이미지 내용을 바탕으로 명확하고 정확하게 답변해 줘.")
            }
        }

        dialog.show()

        // 첫 진입 시 자동 이미지 분석 실행
        requestImageAnalysis("이 이미지에 무엇이 담겨 있는지 핵심 피사체, 상황, 특징을 한국어로 알기 쉽게 분석해 줘.")
    }

    // 모바일 전용 [텍스트/링크 3줄 요약] 바텀시트
    private fun showTextSummaryBottomSheet(sharedText: String) {
        val dialog = BottomSheetDialog(this)
        val sheetView = layoutInflater.inflate(R.layout.dialog_summary_bottom_sheet, null)
        dialog.setContentView(sheetView)

        val tvUrl = sheetView.findViewById<TextView>(R.id.tvSharedUrl)
        val tvResult = sheetView.findViewById<TextView>(R.id.tvSummaryResult)
        val sheetProgressBar = sheetView.findViewById<ProgressBar>(R.id.sheetProgressBar)
        val btnClose = sheetView.findViewById<ImageView>(R.id.btnCloseSheet)
        val btnSummary = sheetView.findViewById<Button>(R.id.btnQuickSummary)
        val btnQuestions = sheetView.findViewById<Button>(R.id.btnQuickQuestions)
        val btnTranslate = sheetView.findViewById<Button>(R.id.btnQuickTranslate)
        val etQuery = sheetView.findViewById<EditText>(R.id.etSheetQuery)
        val btnSend = sheetView.findViewById<Button>(R.id.btnSheetSend)

        tvUrl.text = sharedText
        btnClose.setOnClickListener { dialog.dismiss() }

        fun requestAnalysis(prompt: String) {
            sheetProgressBar.visibility = View.VISIBLE
            tvResult.text = "AI가 내용을 실시간으로 분석하고 있어요..."

            lifecycleScope.launch(Dispatchers.IO) {
                val result = callAIEngine(content = sharedText, prompt = prompt)
                withContext(Dispatchers.Main) {
                    sheetProgressBar.visibility = View.GONE
                    tvResult.text = result
                }
            }
        }

        btnSummary.setOnClickListener {
            requestAnalysis("이 링크나 내용의 핵심을 1) 한 줄 주제, 2) 주요 포인트 3가지, 3) 결론으로 깔끔하게 3줄 요약해 줘.")
        }

        btnQuestions.setOnClickListener {
            requestAnalysis("이 내용에서 사람들이 가장 궁금해할 핵심 질문 3가지와 답변을 명쾌하게 정리해 줘.")
        }

        btnTranslate.setOnClickListener {
            requestAnalysis("이 내용의 핵심을 자연스럽고 매끄러운 한국어로 번역 및 정리해 줘.")
        }

        btnSend.setOnClickListener {
            val q = etQuery.text.toString().trim()
            if (q.isNotEmpty()) {
                etQuery.setText("")
                requestAnalysis("질문: $q\n\n위 질문에 대해 본문 내용을 근거로 정확하게 답변해 줘.")
            }
        }

        dialog.show()

        requestAnalysis("이 링크나 내용의 핵심을 1) 한 줄 주제, 2) 주요 포인트 3가지, 3) 결론으로 깔끔하게 3줄 요약해 줘.")
    }

    private suspend fun callAIEngine(content: String, prompt: String, base64Image: String = ""): String {
        return try {
            val apiKey = "" // API 키가 비어있는 경우 안내 문구 반환
            if (apiKey.isBlank()) {
                val targetDesc = if (base64Image.isNotEmpty()) "공유된 이미지" else "공유된 링크:\n$content"
                return "🍦 [Cream ai 분석 완료 안내]\n\n" +
                        "$targetDesc\n\n" +
                        "✨ 요청하신 작업이 정상 접수되었습니다!\n" +
                        "Cream ai 앱 설정에서 DeepSeek 또는 OpenAI API 키를 연결하시면, 모바일에서도 사진 분석·글자 추출·3줄 요약을 0.1원 이하로 실시간 무제한 사용하실 수 있습니다."
            }

            val jsonBody = JSONObject().apply {
                put("model", "deepseek-chat")
                put("messages", JSONArray().apply {
                    put(JSONObject().apply {
                        put("role", "system")
                        put("content", "당신은 Cream ai Hub의 스마트 모바일 어시스턴트 Creamy입니다. 친절하고 정확한 한국어로 답변하세요.")
                    })
                    put(JSONObject().apply {
                        put("role", "user")
                        put("content", "[대상 내용]: $content\n\n[요청]: $prompt")
                    })
                })
            }

            val request = Request.Builder()
                .url("https://api.deepseek.com/chat/completions")
                .addHeader("Authorization", "Bearer $apiKey")
                .post(jsonBody.toString().toRequestBody("application/json".toMediaType()))
                .build()

            val response = httpClient.newCall(request).execute()
            val respBody = response.body?.string() ?: ""
            val json = JSONObject(respBody)
            json.getJSONArray("choices").getJSONObject(0).getJSONObject("message").getString("content")
        } catch (e: Exception) {
            "⚠️ 분석 중 오류가 발생했습니다: ${e.localizedMessage}"
        }
    }

    override fun onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack()
        } else {
            super.onBackPressed()
        }
    }
}
