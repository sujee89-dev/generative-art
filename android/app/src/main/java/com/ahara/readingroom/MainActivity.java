package com.ahara.readingroom;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.speech.tts.Voice;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.Locale;
import java.util.Set;

/**
 * Shows the reading app (bundled in assets/www) full screen.
 *
 * Android's WebView has no built-in speech, so the page talks to the tablet's
 * own text-to-speech engine through the "AndroidTTS" bridge below. The script
 * www/android-tts.js turns that bridge back into the standard
 * window.speechSynthesis API that the app already uses.
 */
public class MainActivity extends Activity {
    private static final String START_URL = "file:///android_asset/www/index.html";

    private WebView web;
    private TextToSpeech tts;
    private volatile boolean ttsReady = false;
    private String[] pending; // a request made before the speech engine finished starting

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        web = new WebView(this);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);          // stars, progress and saved chess games
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(true);
        s.setTextZoom(100);

        web.setWebChromeClient(new WebChromeClient());
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return openOutside(request.getUrl().toString());
            }

            @SuppressWarnings("deprecation")
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return openOutside(url);
            }
        });
        web.addJavascriptInterface(new Bridge(), "AndroidTTS");

        tts = new TextToSpeech(this, status -> {
            ttsReady = status == TextToSpeech.SUCCESS;
            if (!ttsReady) return;
            tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                @Override public void onStart(String id) { send(id, "start", 0); }
                @Override public void onDone(String id) { send(id, "end", 0); }
                @SuppressWarnings("deprecation")
                @Override public void onError(String id) { send(id, "error", 0); }
                @Override public void onError(String id, int code) { send(id, "error", 0); }
                @Override public void onStop(String id, boolean interrupted) { send(id, "stop", 0); }
                @Override public void onRangeStart(String id, int start, int end, int frame) { send(id, "boundary", start); }
            });
            runOnUiThread(() -> js("window.__ttsEvent && window.__ttsEvent(0, 'voices', 0)"));
            String[] p = pending;
            pending = null;
            if (p != null) speakNow(p[0], p[1], Float.parseFloat(p[2]), Float.parseFloat(p[3]), p[4], p[5]);
        });

        if (savedInstanceState != null) web.restoreState(savedInstanceState);
        else web.loadUrl(START_URL);
    }

    /** Links to other websites (the free online libraries) open in the browser. */
    private boolean openOutside(String url) {
        if (url.startsWith("file:")) return false;
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
        } catch (ActivityNotFoundException ignored) {
            // No browser allowed (for example in a kids profile): stay in the app.
        }
        return true;
    }

    private void js(String code) {
        if (web != null) web.evaluateJavascript(code, null);
    }

    private void send(String id, String type, int index) {
        final String code = "window.__ttsEvent && window.__ttsEvent(" + JSONObject.quote(id) + ", '" + type + "', " + index + ")";
        runOnUiThread(() -> js(code));
    }

    private void speakNow(String text, String lang, float rate, float pitch, String id, String voiceName) {
        boolean voiceSet = false;
        if (voiceName != null && !voiceName.isEmpty()) {
            try {
                Set<Voice> voices = tts.getVoices();
                if (voices != null) {
                    for (Voice v : voices) {
                        if (v.getName().equals(voiceName)) { tts.setVoice(v); voiceSet = true; break; }
                    }
                }
            } catch (Exception ignored) { }
        }
        if (!voiceSet) {
            int result = tts.setLanguage(Locale.forLanguageTag(lang));
            if (result == TextToSpeech.LANG_MISSING_DATA || result == TextToSpeech.LANG_NOT_SUPPORTED) {
                send(id, "error", 0);
                return;
            }
        }
        tts.setSpeechRate(rate);
        tts.setPitch(pitch);
        if (tts.speak(text, TextToSpeech.QUEUE_FLUSH, new Bundle(), id) != TextToSpeech.SUCCESS) send(id, "error", 0);
    }

    /** Methods the page can call as window.AndroidTTS.*. */
    private class Bridge {
        @JavascriptInterface
        public boolean ready() { return ttsReady; }

        @JavascriptInterface
        public String voices() {
            JSONArray out = new JSONArray();
            if (!ttsReady) return out.toString();
            try {
                Set<Voice> voices = tts.getVoices();
                if (voices != null) {
                    for (Voice v : voices) {
                        if (v.getFeatures() != null && v.getFeatures().contains(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED)) continue;
                        JSONObject o = new JSONObject();
                        o.put("name", v.getName());
                        o.put("lang", v.getLocale().toLanguageTag());
                        o.put("local", !v.isNetworkConnectionRequired());
                        out.put(o);
                    }
                }
            } catch (Exception ignored) { }
            if (out.length() == 0) {
                // Some engines do not list voices; report the languages they can speak instead.
                for (String tag : new String[]{"en-US", "fr-FR", "ta-IN"}) {
                    try {
                        if (tts.isLanguageAvailable(Locale.forLanguageTag(tag)) >= TextToSpeech.LANG_AVAILABLE) {
                            JSONObject o = new JSONObject();
                            o.put("name", "Tablet voice (" + tag + ")");
                            o.put("lang", tag);
                            o.put("local", true);
                            out.put(o);
                        }
                    } catch (Exception ignored) { }
                }
            }
            return out.toString();
        }

        @JavascriptInterface
        public void speak(String text, String lang, float rate, float pitch, String id, String voiceName) {
            if (!ttsReady) {
                pending = new String[]{text, lang, String.valueOf(rate), String.valueOf(pitch), id, voiceName};
                return;
            }
            speakNow(text, lang, rate, pitch, id, voiceName);
        }

        @JavascriptInterface
        public void stop() {
            if (ttsReady) tts.stop();
        }

        @JavascriptInterface
        public void openSettings() {
            runOnUiThread(() -> {
                try {
                    startActivity(new Intent("com.android.settings.TTS_SETTINGS"));
                } catch (Exception ignored) { }
            });
        }
    }

    @Override
    public void onBackPressed() {
        if (web != null && web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        if (web != null) web.saveState(outState);
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (ttsReady) tts.stop();
    }

    @Override
    protected void onDestroy() {
        if (tts != null) tts.shutdown();
        if (web != null) web.destroy();
        super.onDestroy();
    }
}
