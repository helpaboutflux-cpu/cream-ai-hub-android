package com.cream.aihub

import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import java.util.Calendar

class BriefingReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == Intent.ACTION_BOOT_COMPLETED) {
            scheduleDailyMorningBriefing(context)
            return
        }

        // Fire morning briefing notification
        showBriefingNotification(context)

        // Reschedule for next day
        scheduleDailyMorningBriefing(context)
    }

    private fun showBriefingNotification(context: Context) {
        val channelId = "cream_ai_briefing_channel"
        val notificationManager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                channelId,
                "Creamy 모닝 브리핑",
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = "매일 아침 오늘의 날씨, 일정, 주요 소식을 브리핑합니다"
            }
            notificationManager.createNotificationChannel(channel)
        }

        val launchIntent = Intent(context, MainActivity::class.java).apply {
            action = Intent.ACTION_VIEW
            putExtra("EXTRA_TARGET_URL", "https://doteai.base44.app/creamy")
            putExtra("EXTRA_INJECT_TEXT", "오늘의 브리핑 보여줘")
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }

        val pendingIntent = PendingIntent.getActivity(
            context,
            301,
            launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val notification = NotificationCompat.Builder(context, channelId)
            .setSmallIcon(R.drawable.ic_stat_cream)
            .setContentTitle("오늘의 Creamy 모닝 브리핑")
            .setContentText("오늘의 날씨, 일정, 주요 AI 소식을 확인해 보세요.")
            .setContentIntent(pendingIntent)
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .build()

        notificationManager.notify(301, notification)
    }

    companion object {
        fun scheduleDailyMorningBriefing(context: Context) {
            try {
                val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as? AlarmManager ?: return
                val intent = Intent(context, BriefingReceiver::class.java).apply {
                    action = "com.cream.aihub.ACTION_MORNING_BRIEFING"
                }

                val pendingIntent = PendingIntent.getBroadcast(
                    context,
                    300,
                    intent,
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
                )

                // Schedule for 08:00 AM
                val calendar = Calendar.getInstance().apply {
                    timeInMillis = System.currentTimeMillis()
                    set(Calendar.HOUR_OF_DAY, 8)
                    set(Calendar.MINUTE, 0)
                    set(Calendar.SECOND, 0)
                    set(Calendar.MILLISECOND, 0)
                    if (timeInMillis <= System.currentTimeMillis()) {
                        add(Calendar.DAY_OF_YEAR, 1)
                    }
                }

                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    alarmManager.setExactAndAllowWhileIdle(
                        AlarmManager.RTC_WAKEUP,
                        calendar.timeInMillis,
                        pendingIntent
                    )
                } else {
                    alarmManager.set(
                        AlarmManager.RTC_WAKEUP,
                        calendar.timeInMillis,
                        pendingIntent
                    )
                }
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }
    }
}
