package com.proteus.opendraft

import android.app.Application
import android.app.NotificationManager
import android.content.Intent
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.session.MediaSession
import android.os.Bundle
import android.os.Looper
import android.speech.tts.TextToSpeech
import android.speech.tts.Voice
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.Implementation
import org.robolectric.annotation.Implements
import org.robolectric.shadows.ShadowTextToSpeech
import org.robolectric.util.ReflectionHelpers
import java.time.Duration
import java.util.Locale

@Implements(TextToSpeech::class)
class ControlledReadSpeech : ShadowTextToSpeech() {
    @Implementation
    override fun speak(text: CharSequence, mode: Int, params: Bundle?, id: String?): Int {
        spoken.add(text.toString() to (id ?: ""))
        return TextToSpeech.SUCCESS
    }
    companion object { val spoken = mutableListOf<Pair<String, String>>() }
}

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28, 35], shadows = [ControlledReadSpeech::class])
class TableReadServiceTest {
    private val app: Application get() = RuntimeEnvironment.getApplication()
    private fun request(action: String, session: String = "read", owner: String = "main"): JSONObject {
        return JSONObject().put("action", action).put("owner", owner).put("session", session)
    }
    private fun start(session: String = "read"): JSONObject = request("start", session).put("index", 0).put("offset", 0)
        .put("labels", JSONObject().apply { for (key in listOf("title", "play", "pause", "stop", "next", "previous")) put(key, "Translated $key") })
        .put("lines", JSONArray().put(JSONObject().put("text", "Synthetic first line").put("voice", "reader").put("gap", 250))
            .put(JSONObject().put("text", "Synthetic next line").put("voice", "reader").put("gap", 250)))
    private fun send(value: JSONObject) = JSONObject(TableReadService.request(app, value.toString()))
    private fun snapshot() = send(request("snapshot"))

    @Test fun staleNotificationCannotKeepAnEmptyServiceAlive() {
        val intent = Intent(app, TableReadService::class.java).setAction("play").putExtra("session", "obsolete")
        val controller = Robolectric.buildService(TableReadService::class.java, intent).create().startCommand(0, 1)
        assertTrue(shadowOf(controller.get()).isStoppedBySelf)
        controller.destroy()
        assertTrue(shadowOf(ShadowTextToSpeech.getLastTextToSpeechInstance()).isShutdown)
    }

    @Test fun nativeQueueAndMediaControlsWorkWithoutAnyFrontendPollLoop() {
        ControlledReadSpeech.spoken.clear()
        ShadowTextToSpeech.addVoice(Voice("reader", Locale.US, Voice.QUALITY_NORMAL, Voice.LATENCY_NORMAL, false, emptySet()))
        send(start())
        val intent = shadowOf(app).nextStartedService
        val controller = Robolectric.buildService(TableReadService::class.java, intent).create().startCommand(0, 1)
        val service = controller.get()
        val engine = ShadowTextToSpeech.getLastTextToSpeechInstance()
        shadowOf(engine).onInitListener.onInit(TextToSpeech.SUCCESS)
        val looper = shadowOf(Looper.getMainLooper())
        looper.idle()
        assertEquals("playing", snapshot().getString("status"))
        assertEquals("Synthetic first line", ControlledReadSpeech.spoken.last().first)
        val media = ReflectionHelpers.getField<MediaSession>(service, "media")
        // Robolectric's MediaController transport does not deliver Binder
        // commands. Drive the callback actually registered with MediaSession;
        // the real APK scenario separately requires native media-key delivery.
        val callbackHandler = ReflectionHelpers.getField<Any>(media, "mCallback")
        val controls = ReflectionHelpers.getField<MediaSession.Callback>(callbackHandler, "mCallback")
        controls.onPause(); looper.idle()
        assertEquals("paused", snapshot().getString("status"))
        assertTrue(shadowOf(engine).isStopped)
        controls.onPlay(); looper.idle()
        val focus = ReflectionHelpers.getField<AudioFocusRequest>(service, "focus")
        val listener = ReflectionHelpers.getField<AudioManager.OnAudioFocusChangeListener>(focus, "mFocusListener")
        listener.onAudioFocusChange(AudioManager.AUDIOFOCUS_LOSS_TRANSIENT)
        assertEquals("paused", snapshot().getString("status"))
        listener.onAudioFocusChange(AudioManager.AUDIOFOCUS_GAIN)
        assertEquals("playing", snapshot().getString("status"))
        listener.onAudioFocusChange(AudioManager.AUDIOFOCUS_LOSS_TRANSIENT)
        controls.onPause()
        listener.onAudioFocusChange(AudioManager.AUDIOFOCUS_GAIN)
        assertEquals("paused", snapshot().getString("status"))
        controls.onPlay(); looper.idle()
        val current = ControlledReadSpeech.spoken.last().second
        shadowOf(engine).utteranceProgressListener.onDone(current)
        looper.idleFor(Duration.ofMillis(250))
        assertEquals("Synthetic next line", ControlledReadSpeech.spoken.last().first)
        assertEquals(1, snapshot().getInt("index"))
        val notification = shadowOf(app.getSystemService(NotificationManager::class.java)).allNotifications.single()
        assertEquals("Translated title", notification.extras.getString("android.title"))
        assertFalse(notification.extras.toString().contains("Synthetic"))
        controls.onCustomAction("stop", null); looper.idle()
        assertEquals("idle", snapshot().getString("status"))
        controller.destroy()
        assertTrue(shadowOf(engine).isShutdown)
    }

    @Test fun pendingPauseAndWindowOwnershipPreventUnwantedPlayback() {
        send(start())
        send(request("pause"))
        val controller = Robolectric.buildService(TableReadService::class.java, shadowOf(app).nextStartedService).create().startCommand(0, 1)
        val engine = ShadowTextToSpeech.getLastTextToSpeechInstance()
        shadowOf(engine).onInitListener.onInit(TextToSpeech.SUCCESS)
        val looper = shadowOf(Looper.getMainLooper()); looper.idle()
        assertEquals("paused", snapshot().getString("status"))
        assertFalse(send(request("snapshot", owner = "other-window")).getBoolean("owned"))
        send(request("stop", owner = "other-window")); looper.idle()
        assertEquals("paused", snapshot().getString("status"))
        send(request("stop", session = "obsolete")); looper.idle()
        assertEquals("paused", snapshot().getString("status"))
        controller.get().onTaskRemoved(null)
        assertEquals("idle", snapshot().getString("status"))
        controller.destroy()
    }
}
