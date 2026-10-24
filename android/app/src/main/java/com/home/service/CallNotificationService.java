package com.home.service;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Intent;
import android.os.Build;
import androidx.core.app.NotificationCompat;
import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;
import java.util.Map;

/** Additive call notification layer. The existing WebRTC flow remains untouched. */
public class CallNotificationService extends FirebaseMessagingService {
    public static final String CHANNEL_ID = "home-service-incoming-calls-v1";
    public static final String EXTRA_TARGET_PATH = "target_path";
    private static final int NOTIFICATION_ID = 9401;

    @Override public void onMessageReceived(RemoteMessage message) {
        Map<String, String> data = message.getData();
        if (!"voice_call".equals(data.get("notification_type"))) return;
        String title = data.get("title");
        if (title == null || title.trim().isEmpty()) title = "مكالمة واردة من HOME";
        String body = data.get("body");
        if (body == null || body.trim().isEmpty()) body = "لديك مكالمة صوتية واردة";
        String targetPath = data.get(EXTRA_TARGET_PATH);
        if (targetPath == null || targetPath.trim().isEmpty()) targetPath = "/customer/overview";
        showCallNotification(title, body, targetPath);
    }

    private void showCallNotification(String title, String body, String targetPath) {
        NotificationManager manager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "المكالمات الواردة", NotificationManager.IMPORTANCE_HIGH);
            channel.setDescription("تنبيهات المكالمات الصوتية الواردة");
            manager.createNotificationChannel(channel);
        }
        Intent open = new Intent(this, MainActivity.class).setAction(Intent.ACTION_VIEW)
            .setData(android.net.Uri.parse("com.home.service://call" + targetPath));
        open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent openPending = PendingIntent.getActivity(this, 9402, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        PendingIntent answer = actionPendingIntent(targetPath, "answer", 9403);
        PendingIntent reject = actionPendingIntent(targetPath, "reject", 9404);
        Notification notification = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(com.home.service.R.mipmap.ic_launcher)
            .setContentTitle(title)
            .setContentText(body)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOngoing(true)
            .setAutoCancel(false)
            .setFullScreenIntent(openPending, true)
            .addAction(new NotificationCompat.Action(0, "رد", answer))
            .addAction(new NotificationCompat.Action(0, "رفض", reject))
            .build();
        manager.notify(NOTIFICATION_ID, notification);
    }

    private PendingIntent actionPendingIntent(String targetPath, String action, int requestCode) {
        Intent intent = new Intent(this, CallNotificationActionReceiver.class);
        intent.setAction(CallNotificationActionReceiver.actionFor(action));
        intent.putExtra(EXTRA_TARGET_PATH, targetPath);
        return PendingIntent.getBroadcast(this, requestCode, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
}
