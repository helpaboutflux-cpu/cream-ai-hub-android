package com.cream.aihub

import android.annotation.SuppressLint
import android.content.Intent
import android.graphics.Bitmap
import android.os.Bundle
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

    private fun handleIncomingIntent(intent: Intent) {
        if (intent.action == Intent.ACTION_SEND && intent.type == "text/plain") {
            val sharedText = intent.getStringExtra(Intent.EXTRA_TEXT)
            if (!sharedText.isNullOrBlank()) {
                showSummaryBottomSheet(sharedText)
            }
        }
    }

    private fun showSummaryBottomSheet(sharedText: String) {
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
                val result = callAIEngine(sharedText, prompt)
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

    private suspend fun callAIEngine(content: String, prompt: String): String {
        return try {
            val apiKey = ""
            if (apiKey.isBlank()) {
                return "🍦 [Cream ai 요약 안내]\n\n" +
                        "공유된 링크:\n$content\n\n" +
                        "✨ 요청하신 요약 작업이 접수되었습니다!\n" +
                        "앱 설정에서 DeepSeek API 키를 등록하시면 모바일에서도 실시간 3줄 요약과 Q&A를 0.1원 이하로 무제한 사용하실 수 있습니다."
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
                        put("content", "[대상 내용/링크]: $content\n\n[요청]: $prompt")
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
