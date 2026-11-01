package com.cream.aihub

import android.app.DownloadManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat

class DownloadReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == DownloadManager.ACTION_DOWNLOAD_COMPLETE) {
            val downloadId = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1L)
            if (downloadId == -1L) return

            val downloadManager = context.getSystemService(Context.DOWNLOAD_SERVICE) as? DownloadManager ?: return
            val query = DownloadManager.Query().setFilterById(downloadId)
            val cursor = downloadManager.query(query)
            if (cursor != null && cursor.moveToFirst()) {
                val statusIndex = cursor.getColumnIndex(DownloadManager.COLUMN_STATUS)
                val uriIndex = cursor.getColumnIndex(DownloadManager.COLUMN_LOCAL_URI)
                val titleIndex = cursor.getColumnIndex(DownloadManager.COLUMN_TITLE)

                if (statusIndex != -1 && cursor.getInt(statusIndex) == DownloadManager.STATUS_SUCCESSFUL) {
                    val fileUriStr = if (uriIndex != -1) cursor.getString(uriIndex) else null
                    val title = if (titleIndex != -1) cursor.getString(titleIndex) else "다운로드 파일"

                    showDownloadNotification(context, title, fileUriStr)
                }
                cursor.close()
            }
        }
    }

    private fun showDownloadNotification(context: Context, fileName: String, fileUriStr: String?) {
        val channelId = "cream_ai_download_channel"
        val notificationManager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                channelId,
                "Cream ai 다운로드 알림",
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = "다운로드한 파일로 Creamy에 질문합니다"
            }
            notificationManager.createNotificationChannel(channel)
        }

        val launchIntent = Intent(context, MainActivity::class.java).apply {
            action = Intent.ACTION_VIEW
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
            putExtra("EXTRA_INJECT_TEXT", "방금 다운로드한 파일(${fileName})에 대해 설명해줘")
            if (fileUriStr != null) {
                putExtra("EXTRA_INJECT_IMAGE_URI", fileUriStr)
            }
        }

        val pendingIntent = PendingIntent.getActivity(
            context,
            201,
            launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val notification = NotificationCompat.Builder(context, channelId)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle("Cream ai Hub")
            .setContentText("📥 다운로드 완료: ${fileName}로 Creamy에 바로 질문하기")
            .setContentIntent(pendingIntent)
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .build()

        notificationManager.notify(201, notification)
    }
}
