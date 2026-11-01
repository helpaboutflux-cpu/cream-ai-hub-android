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
import android.view.View
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.ProgressBar
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.NotificationCompat
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout
import org.json.JSONObject
import java.io.ByteArrayOutputStream

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private lateinit var swipeRefresh: SwipeRefreshLayout
    private lateinit var progressBar: ProgressBar

    private val BASE_URL = "https://doteai.base44.app"
    private val CREAMY_URL = "https://doteai.base44.app/creamy"
    private val PREFS_NAME = "cream_ai_prefs"
    private val KEY_BASE44_TOKEN = "base44_access_token"

    private var fileChooserCallback: ValueCallback<Array<Uri>>? = null
    private var lastCopiedText = ""
    private var pendingScriptToInject: String? = null

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

        webView = findViewById(R.id.webView)
        swipeRefresh = findViewById(R.id.swipeRefresh)
        progressBar = findViewById(R.id.progressBar)

        requestNotificationPermission()
        setupWebView()
        setupClipboardListener()
        handleIncomingIntent(intent)
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

                    // Sync token script
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
                            setInterval(syncToken, 2500);
                        })();
                    """.trimIndent()
                    view?.evaluateJavascript(tokenSyncScript, null)

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
        // 1. Text or Link Share (e.g. from YouTube, Chrome, Twitter)
        if (intent.action == Intent.ACTION_SEND && intent.type == "text/plain") {
            val sharedText = intent.getStringExtra(Intent.EXTRA_TEXT)
            if (!sharedText.isNullOrBlank()) {
                injectTextIntoCreamy(sharedText)
                return
            }
        }

        // 2. Image Share (e.g. from Gallery, Google Photos, Screenshots)
        if (intent.action == Intent.ACTION_SEND && intent.type?.startsWith("image/") == true) {
            val imageUri = intent.getParcelableExtra<Uri>(Intent.EXTRA_STREAM)
            if (imageUri != null) {
                injectImageIntoCreamy(imageUri)
                return
            }
        }

        // 3. From Clipboard / Download Notification
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

        // 4. From Widget (Search Mode / Voice Trigger / Creamy Direct)
        val targetUrl = intent.getStringExtra("EXTRA_TARGET_URL")
        val mode = intent.getStringExtra("EXTRA_MODE")
        val triggerVoice = intent.getBooleanExtra("EXTRA_TRIGGER_VOICE", false)

        if (targetUrl != null) {
            navigateToCreamy(mode = mode, triggerVoice = triggerVoice)
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

    private fun setupClipboardListener() {
        val clipboard = getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager ?: return
        clipboard.addPrimaryClipChangedListener {
            try {
                val clip = clipboard.primaryClip
                if (clip != null && clip.itemCount > 0) {
                    val item = clip.getItemAt(0)
                    val text = item.text?.toString()?.trim() ?: ""
                    val uri = item.uri

                    if (text.isNotBlank() && text != lastCopiedText && text.length > 2) {
                        lastCopiedText = text
                        showClipboardNotification(text = text, uri = null)
                    } else if (uri != null) {
                        showClipboardNotification(text = null, uri = uri)
                    }
                }
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }
    }

    private fun showClipboardNotification(text: String?, uri: Uri?) {
        val channelId = "cream_ai_clipboard_channel"
        val notificationManager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                channelId,
                "Cream ai 클립보드 감지",
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = "복사한 내용으로 Creamy에 바로 질문합니다"
            }
            notificationManager.createNotificationChannel(channel)
        }

        val launchIntent = Intent(this, MainActivity::class.java).apply {
            action = Intent.ACTION_VIEW
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
            if (!text.isNullOrBlank()) {
                putExtra("EXTRA_INJECT_TEXT", text)
            }
            if (uri != null) {
                putExtra("EXTRA_INJECT_IMAGE_URI", uri.toString())
            }
        }

        val pendingIntent = PendingIntent.getActivity(
            this,
            203,
            launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val snippet = text?.take(40)?.replace("\n", " ") ?: "복사한 이미지"
        val notification = NotificationCompat.Builder(this, channelId)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle("Cream ai Hub")
            .setContentText("📋 복사한 내용으로 Creamy에 질문하기: \"$snippet\"")
            .setContentIntent(pendingIntent)
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .build()

        notificationManager.notify(203, notification)
    }

    override fun onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack()
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
