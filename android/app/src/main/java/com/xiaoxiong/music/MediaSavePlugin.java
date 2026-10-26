package com.xiaoxiong.music;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;

/**
 * Capacitor 插件：相册媒体保存
 *
 * 提供将 base64 图片写入系统 MediaStore 相册的接口
 */
@CapacitorPlugin(name = "MediaSave")
public class MediaSavePlugin extends Plugin {
    private static final String TAG = "MediaSavePlugin";

    /**
     * 保存 base64 图片到系统相册
     *
     * @param call 包含 base64 与 fileName 的调用参数
     */
    @PluginMethod
    public void saveImageToGallery(PluginCall call) {
        String base64Data = call.getString("base64");
        String fileName = call.getString("fileName");

        if (base64Data == null || base64Data.isEmpty()) {
            call.reject("base64 data is empty");
            return;
        }

        if (fileName == null || fileName.isEmpty()) {
            fileName = "xiaoxiong_qr_" + System.currentTimeMillis() + ".png";
        }

        try {
            int commaIdx = base64Data.indexOf(",");
            if (commaIdx >= 0) {
                base64Data = base64Data.substring(commaIdx + 1);
            }

            byte[] decodedBytes = Base64.decode(base64Data, Base64.DEFAULT);

            ContentResolver resolver = getContext().getContentResolver();
            Uri imageUri;

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ContentValues values = new ContentValues();
                values.put(MediaStore.Images.Media.DISPLAY_NAME, fileName);
                values.put(MediaStore.Images.Media.MIME_TYPE, "image/png");
                values.put(MediaStore.Images.Media.RELATIVE_PATH, "Pictures/xiaoxiong");
                values.put(MediaStore.Images.Media.IS_PENDING, 1);

                imageUri = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values);
                if (imageUri == null) {
                    call.reject("Failed to insert MediaStore record");
                    return;
                }

                try (OutputStream os = resolver.openOutputStream(imageUri)) {
                    if (os == null) {
                        call.reject("Failed to open output stream");
                        return;
                    }
                    os.write(decodedBytes);
                    os.flush();
                }

                values.clear();
                values.put(MediaStore.Images.Media.IS_PENDING, 0);
                resolver.update(imageUri, values, null, null);
            } else {
                File picturesDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_PICTURES);
                File targetDir = new File(picturesDir, "xiaoxiong");
                if (!targetDir.exists()) {
                    targetDir.mkdirs();
                }
                File targetFile = new File(targetDir, fileName);
                try (FileOutputStream fos = new FileOutputStream(targetFile)) {
                    fos.write(decodedBytes);
                    fos.flush();
                }

                ContentValues values = new ContentValues();
                values.put(MediaStore.Images.Media.DISPLAY_NAME, fileName);
                values.put(MediaStore.Images.Media.MIME_TYPE, "image/png");
                values.put(MediaStore.Images.Media.DATA, targetFile.getAbsolutePath());
                imageUri = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values);
            }

            JSObject ret = new JSObject();
            ret.put("uri", imageUri != null ? imageUri.toString() : "");
            call.resolve(ret);
            Log.d(TAG, "Image saved to gallery: " + (imageUri != null ? imageUri.toString() : fileName));
        } catch (Exception e) {
            Log.e(TAG, "saveImageToGallery failed", e);
            call.reject("Failed to save image to gallery: " + e.getMessage(), e);
        }
    }
}
