package com.proteus.opendraft

import android.app.*
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.MediaMetadata
import android.media.session.MediaSession
import android.media.session.PlaybackState
import android.os.*
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import org.json.JSONObject

/** System-voice reads continue without JavaScript, including between lines. */
class TableReadService : Service() {
    private val handler = Handler(Looper.getMainLooper())
    private lateinit var playback: TableReadPlayback
    private lateinit var media: MediaSession
    private lateinit var audio: AudioManager
    private lateinit var focus: AudioFocusRequest
    private lateinit var wake: PowerManager.WakeLock
    private var speech: TextToSpeech? = null
    private var labels = JSONObject()
    private var loadingQueue = false
    private var hasFocus = false
    private var focusRequested = false
    private var focusSuspended = false
    private var lastNotification = ""

    override fun onCreate() {
        super.onCreate()
        instance = this
        labels = pending?.labels ?: JSONObject()
        audio = getSystemService(AudioManager::class.java)
        wake = getSystemService(PowerManager::class.java).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "OpenDraft:TableRead")
        wake.setReferenceCounted(false)
        val attributes = AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA)
            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build()
        focus = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN).setAudioAttributes(attributes)
            .setWillPauseWhenDucked(true).setOnAudioFocusChangeListener({ value ->
                if (focusRequested) when (value) {
                    AudioManager.AUDIOFOCUS_GAIN -> { hasFocus = true; focusSuspended = false; playback.focusGained() }
                    AudioManager.AUDIOFOCUS_LOSS_TRANSIENT, AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK -> {
                        hasFocus = false; focusSuspended = true; playback.pause(true)
                    }
                    AudioManager.AUDIOFOCUS_LOSS -> { focusSuspended = false; playback.pause() }
                }
            }, handler).build()
        playback = TableReadPlayback(object : TableReadPlayback.Speech {
            override fun speak(text: String, voice: String?, rate: Float, pitch: Float, id: String): Boolean {
                return try {
                    val engine = speech ?: return false
                    val selected = if (voice.isNullOrEmpty()) engine.defaultVoice ?: engine.voices?.firstOrNull { !it.isNetworkConnectionRequired }
                        else engine.voices?.find { it.name == voice }
                    if (selected == null || selected.isNetworkConnectionRequired || engine.setVoice(selected) == TextToSpeech.ERROR) return false
                    engine.setSpeechRate(rate); engine.setPitch(pitch)
                    // Bounded even if a vendor engine never reports completion.
                    wake.acquire(60 * 60 * 1000L)
                    engine.speak(text, TextToSpeech.QUEUE_FLUSH, null, id) == TextToSpeech.SUCCESS
                } catch (_: RuntimeException) { false }
            }
            override fun stop() { try { speech?.stop() } catch (_: RuntimeException) { /* engine disconnected */ } }
        }, object : TableReadPlayback.Audio {
            override fun acquire(): Boolean {
                if (!hasFocus) hasFocus = audio.requestAudioFocus(focus) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
                if (hasFocus) focusRequested = true
                return hasFocus
            }
            override fun release() {
                if (!focusSuspended) {
                    if (focusRequested) audio.abandonAudioFocusRequest(focus)
                    hasFocus = false; focusRequested = false
                }
                if (wake.isHeld) wake.release()
            }
        }, { delay, action -> handler.postDelayed({ action() }, delay) }, { update() })
        media = MediaSession(this, "OpenDraft Table Read")
        media.setCallback(object : MediaSession.Callback() {
            override fun onPlay() = control("play")
            override fun onPause() = control("pause")
            override fun onStop() = control("stop")
            override fun onSkipToNext() = control("next")
            override fun onSkipToPrevious() = control("previous")
        }, handler)
        media.isActive = true
        // Android requires this immediately after startForegroundService, before TTS binds.
        startForeground(NOTIFICATION, notification())
        speech = try { TextToSpeech(applicationContext) { result -> handler.post {
            playback.engineReady(result == TextToSpeech.SUCCESS)
        } }.also { engine ->
            engine.setAudioAttributes(attributes)
            engine.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                override fun onStart(id: String?) {}
                override fun onDone(id: String?) { handler.post { playback.done(id ?: "") } }
                @Deprecated("Deprecated in Java")
                override fun onError(id: String?) { handler.post { playback.error(id ?: "") } }
                override fun onError(id: String?, code: Int) { handler.post { playback.error(id ?: "") } }
                override fun onRangeStart(id: String?, start: Int, end: Int, frame: Int) {
                    handler.post { playback.word(id ?: "", start, end) }
                }
            })
        } } catch (_: RuntimeException) { handler.post { playback.engineReady(false) }; null }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == START) {
            val entry = synchronized(lock) {
                pending?.takeIf { it.session == intent.getStringExtra("session") }?.also { pending = null }
            }
            if (entry != null) {
                labels = entry.labels
                // A new start can arrive while the preceding read is stopping.
                startForeground(NOTIFICATION, notification())
                focusSuspended = false
                loadingQueue = true
                try { playback.load(entry.owner, entry.session, entry.lines, entry.index, entry.offset, entry.paused) }
                finally { loadingQueue = false }
                update()
            } else if (playback.status == "idle") stopSelf(startId)
        } else if (intent != null && intent.getStringExtra("session") == playback.session) {
            control(intent.action ?: "")
        } else if (playback.status == "idle" || playback.status == "error") {
            // A stale notification must not keep an empty service alive.
            stopSelf(startId)
        }
        return START_NOT_STICKY // Never restore private script text after process death.
    }

    private fun control(action: String, index: Int = 0) {
        focusSuspended = false
        when (action) {
            "play" -> playback.resume()
            "pause" -> playback.pause()
            "stop", "release" -> playback.stop()
            "next" -> playback.jump(playback.index + 1)
            "previous" -> playback.jump(playback.index - 1)
            "jump" -> playback.jump(index)
        }
    }

    private fun update() {
        if (loadingQueue) return
        val state = JSONObject().put("session", playback.session).put("owner", playback.owner)
            .put("status", playback.status).put("index", playback.index)
            .put("offset", playback.offset).put("end", playback.end)
        synchronized(lock) {
            val current = JSONObject(cached)
            if (pending == null && current.optString("owner") == playback.owner && current.optString("session") == playback.session) cached = state.toString()
        }
        if (pending != null) return
        val key = "${playback.session}:${playback.status}:${playback.index}"
        if (key == lastNotification) return
        lastNotification = key
        val status = when (playback.status) {
            "playing" -> PlaybackState.STATE_PLAYING
            "loading" -> PlaybackState.STATE_BUFFERING
            "paused" -> PlaybackState.STATE_PAUSED
            "error" -> PlaybackState.STATE_ERROR
            else -> PlaybackState.STATE_STOPPED
        }
        media.setPlaybackState(PlaybackState.Builder().setActions(PlaybackState.ACTION_PLAY or PlaybackState.ACTION_PAUSE
            or PlaybackState.ACTION_STOP or PlaybackState.ACTION_SKIP_TO_NEXT or PlaybackState.ACTION_SKIP_TO_PREVIOUS)
            .setState(status, PlaybackState.PLAYBACK_POSITION_UNKNOWN, if (status == PlaybackState.STATE_PLAYING) 1f else 0f).build())
        media.setMetadata(MediaMetadata.Builder().putString(MediaMetadata.METADATA_KEY_TITLE, label("title"))
            .putString(MediaMetadata.METADATA_KEY_ARTIST, "${playback.index + 1} / ${playback.total}")
            .putLong(MediaMetadata.METADATA_KEY_TRACK_NUMBER, (playback.index + 1).toLong())
            .putLong(MediaMetadata.METADATA_KEY_NUM_TRACKS, playback.total.toLong()).build())
        if (playback.status == "idle" || playback.status == "error") {
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
        } else getSystemService(NotificationManager::class.java).notify(NOTIFICATION, notification())
    }

    private fun label(key: String) = labels.optString(key).ifEmpty { "OpenDraft" }
    private fun notification(): Notification {
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(NotificationChannel(CHANNEL, label("title"), NotificationManager.IMPORTANCE_LOW))
        val builder = Notification.Builder(this, CHANNEL).setSmallIcon(android.R.drawable.ic_btn_speak_now)
            .setContentTitle(label("title")).setContentText(if (::playback.isInitialized) "${playback.index + 1} / ${playback.total}" else "")
            .setVisibility(Notification.VISIBILITY_PRIVATE).setOnlyAlertOnce(true)
            .setOngoing(::playback.isInitialized && playback.status == "playing")
        packageManager.getLaunchIntentForPackage(packageName)?.let {
            builder.setContentIntent(PendingIntent.getActivity(this, 0, it, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE))
        }
        if (::playback.isInitialized) {
            val toggle = if (playback.status == "playing" || playback.status == "loading") "pause" else "play"
            for ((action, icon) in listOf("previous" to android.R.drawable.ic_media_previous,
                toggle to if (toggle == "pause") android.R.drawable.ic_media_pause else android.R.drawable.ic_media_play,
                "next" to android.R.drawable.ic_media_next, "stop" to android.R.drawable.ic_menu_close_clear_cancel)) {
                val intent = Intent(this, TableReadService::class.java).setAction(action).putExtra("session", playback.session)
                    .setData(android.net.Uri.parse("opendraft-tableread:${playback.session}:$action"))
                val pendingIntent = PendingIntent.getService(this, action.hashCode(), intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
                builder.addAction(Notification.Action.Builder(icon, label(action), pendingIntent).build())
                if (action == "stop") builder.setDeleteIntent(pendingIntent)
            }
        }
        return builder.setStyle(Notification.MediaStyle().setMediaSession(media.sessionToken).setShowActionsInCompactView(0, 1, 2)).build()
    }

    override fun onBind(intent: Intent?) = null
    override fun onTaskRemoved(rootIntent: Intent?) { control("stop") }
    override fun onDestroy() {
        instance = null
        loadingQueue = true
        focusSuspended = false
        val failed = playback.status == "error"
        playback.stop()
        try { speech?.shutdown() } catch (_: RuntimeException) { /* disconnected vendor engine */ }
        speech = null
        media.isActive = false; media.release()
        handler.removeCallbacksAndMessages(null)
        synchronized(lock) {
            val current = JSONObject(cached)
            if (pending == null && !failed && current.optString("owner") == playback.owner && current.optString("session") == playback.session) cached = current.put("status", "idle").toString()
        }
        super.onDestroy()
    }

    companion object {
        private const val START = "opendraft.tableRead.start"
        private const val CHANNEL = "table-read"
        private const val NOTIFICATION = 131
        private val lock = Any()
        private val main = Handler(Looper.getMainLooper())
        @Volatile private var instance: TableReadService? = null
        @Volatile private var cached = "{\"status\":\"idle\"}"
        @Volatile private var pending: Entry? = null
        private data class Entry(val owner: String, val session: String, val lines: List<TableReadPlayback.Line>, val index: Int, val offset: Int, val labels: JSONObject, var paused: Boolean = false)

        /** Called only by the origin-checked Tauri command, never a JS interface. */
        fun request(context: Context, raw: String): String {
            require(raw.length <= 4_000_000)
            val request = JSONObject(raw)
            val owner = request.getString("owner")
            val session = request.optString("session")
            when (request.getString("action")) {
                "start" -> {
                    require(session.length in 1..100)
                    val values = request.getJSONArray("lines")
                    require(values.length() in 1..50_000)
                    var length = 0
                    val lines = (0 until values.length()).map { i ->
                        val line = values.getJSONObject(i)
                        val text = line.getString("text")
                        length += text.length
                        require(length <= 2_000_000)
                        val rate = line.optDouble("rate", 1.0); val pitch = line.optDouble("pitch", 1.0)
                        require(rate.isFinite() && pitch.isFinite())
                        TableReadPlayback.Line(text, if (line.isNull("voice")) null else line.optString("voice").takeIf { it.isNotEmpty() },
                            rate.coerceIn(0.25, 4.0).toFloat(), pitch.coerceIn(0.25, 2.0).toFloat(), line.optLong("gap", 200).coerceIn(0, 1000))
                    }
                    val labels = request.getJSONObject("labels")
                    for (key in listOf("title", "play", "pause", "stop", "next", "previous")) require(labels.getString(key).length in 1..200)
                    val entry = Entry(owner, session, lines, request.optInt("index"), request.optInt("offset"), labels)
                    synchronized(lock) {
                        pending = entry
                        cached = JSONObject().put("owner", owner).put("session", session).put("status", "loading").toString()
                    }
                    try {
                        context.applicationContext.startForegroundService(Intent(context, TableReadService::class.java)
                            .setAction(START).putExtra("session", session))
                    } catch (_: RuntimeException) {
                        synchronized(lock) {
                            if (pending === entry) { pending = null; cached = JSONObject(cached).put("status", "error").toString() }
                        }
                        main.post { instance?.playback?.stop() }
                    }
                }
                "snapshot" -> Unit
                else -> {
                    val action = request.getString("action")
                    require(action in listOf("play", "pause", "stop", "release", "jump"))
                    val release = action == "release"
                    val target = if (release) JSONObject(cached).takeIf { it.optString("owner") == owner }?.optString("session") ?: "" else session
                    synchronized(lock) {
                        pending?.takeIf { it.owner == owner && it.session == target }?.let {
                            if (action == "pause" || action == "play") {
                                it.paused = action == "pause"
                                cached = JSONObject(cached).put("status", if (it.paused) "paused" else "loading").toString()
                            }
                        }
                    }
                    main.post {
                    val service = instance
                    synchronized(lock) {
                        if (pending?.owner == owner && pending?.session == target && action in listOf("stop", "release")) {
                            pending = null
                            cached = JSONObject(cached).put("status", "idle").toString()
                        }
                    }
                    if (service != null && service.playback.owner == owner && service.playback.session == target) {
                        service.control(action, request.optInt("index"))
                    }
                    }
                }
            }
            val state = JSONObject(cached)
            return if (state.optString("owner") == owner && state.optString("session") == session) state.toString()
                else "{\"status\":\"idle\",\"owned\":false}"
        }
    }
}
