package com.home.service;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import androidx.core.app.NotificationManagerCompat;

/** Converts notification actions into the existing app deep-link flow. */
public class CallNotificationActionReceiver extends BroadcastReceiver {
    public static final String ACTION_ANSWER = "com.home.service.CALL_ANSWER";
    public static final String ACTION_REJECT = "com.home.service.CALL_REJECT";

    public static String actionFor(String action) {
        return "answer".equals(action) ? ACTION_ANSWER : ACTION_REJECT;
    }

    @Override public void onReceive(Context context, Intent received) {
        String path = received.getStringExtra(CallNotificationService.EXTRA_TARGET_PATH);
        if (path == null || path.trim().isEmpty()) path = "/customer/overview";
        String action = ACTION_ANSWER.equals(received.getAction()) ? "answer" : "reject";
        Uri uri = Uri.parse("com.home.service://call" + path + (path.contains("?") ? "&" : "?") + "action=" + action);
        Intent open = new Intent(context, MainActivity.class).setAction(Intent.ACTION_VIEW).setData(uri);
        open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        context.startActivity(open);
        NotificationManagerCompat.from(context).cancel(9401);
    }
}
