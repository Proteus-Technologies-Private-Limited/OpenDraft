package com.proteus.opendraft

/** Queue and cursor live outside the WebView. Call only from the main looper. */
internal class TableReadPlayback(
    private val speech: Speech,
    private val audio: Audio,
    private val later: (Long, () -> Unit) -> Unit,
    private val changed: () -> Unit,
) {
    interface Speech {
        fun speak(text: String, voice: String?, rate: Float, pitch: Float, id: String): Boolean
        fun stop()
    }
    interface Audio {
        fun acquire(): Boolean
        fun release()
    }
    data class Line(val text: String, val voice: String?, val rate: Float, val pitch: Float, val gap: Long)
    var owner = ""; private set
    var session = ""; private set
    var status = "idle"; private set
    var index = 0; private set
    var offset = 0; private set
    var end = 0; private set
    var total = 0; private set
    private var lines = emptyList<Line>()
    private var ready = false
    private var failed = false
    private var generation = 0L
    private var utterance = ""
    private var chunkStart = 0
    private var chunkLength = 0
    private var interrupted = false

    fun load(owner: String, session: String, lines: List<Line>, index: Int, offset: Int, paused: Boolean = false) {
        stop()
        this.owner = owner
        this.session = session
        this.lines = lines.toList()
        total = lines.size
        this.index = index.coerceIn(0, lines.lastIndex)
        this.offset = offset.coerceIn(0, lines[this.index].text.length)
        end = this.offset
        if (failed) fail() else if (paused) { status = "paused"; changed() } else resume()
    }

    fun engineReady(success: Boolean) {
        ready = success
        failed = !success
        if (!success) { fail(); return }
        if (status == "loading") resume()
    }

    fun resume() {
        if (lines.isEmpty() || status == "playing") return
        interrupted = false
        if (!ready) { status = "loading"; changed(); return }
        if (!audio.acquire()) { status = "paused"; changed(); return }
        status = "playing"
        speak()
    }

    fun pause(forInterruption: Boolean = false) {
        if (status != "playing" && status != "loading") {
            if (!forInterruption) { interrupted = false; audio.release() }
            return
        }
        interrupted = forInterruption
        generation++
        utterance = ""
        speech.stop()
        audio.release()
        status = "paused"
        changed()
    }

    fun focusGained() { if (interrupted && status == "paused") resume() }

    fun stop() {
        generation++
        utterance = ""
        interrupted = false
        speech.stop()
        audio.release()
        lines = emptyList()
        status = "idle"
        offset = 0; end = 0
        changed()
    }

    fun jump(target: Int) {
        if (lines.isEmpty()) return
        val wasPlaying = status == "playing" || status == "loading"
        pause()
        index = target.coerceIn(0, lines.lastIndex)
        offset = 0; end = 0
        if (wasPlaying) resume() else changed()
    }

    private fun speak() {
        if (index >= lines.size) { index = 0; stop(); return }
        val line = lines[index]
        if (offset >= line.text.length) { advance(line.gap); return }
        chunkStart = offset
        // Android limits each utterance. Do not cut a UTF-16 surrogate pair.
        var limit = minOf(line.text.length, offset + 3900)
        if (limit < line.text.length && Character.isHighSurrogate(line.text[limit - 1])) limit--
        if (limit < line.text.length) {
            val space = line.text.lastIndexOf(' ', limit - 1)
            if (space > offset + 1950) limit = space + 1
        }
        chunkLength = limit - offset
        utterance = "${++generation}:$index:$offset"
        changed()
        if (!speech.speak(line.text.substring(offset, limit), line.voice, line.rate, line.pitch, utterance)) fail()
        val id = utterance
        later((chunkLength * 240L / line.rate).toLong().coerceIn(30_000L, 3_600_000L) + 15_000L) {
            if (id.isNotEmpty() && utterance == id && status == "playing") fail()
        }
    }

    fun word(id: String, start: Int, finish: Int) {
        if (id.isEmpty() || id != utterance || status != "playing" || start < 0 || finish < start || finish > chunkLength) return
        offset = chunkStart + start
        end = chunkStart + finish
        changed()
    }

    fun done(id: String) {
        if (id.isEmpty() || id != utterance || status != "playing") return
        utterance = ""
        offset = chunkStart + chunkLength
        end = offset
        if (offset < lines[index].text.length) speak() else advance(lines[index].gap)
    }

    private fun advance(gap: Long) {
        index++
        offset = 0; end = 0
        if (index >= lines.size) { index = 0; stop(); return }
        changed()
        val token = ++generation
        later(gap) { if (generation == token && status == "playing") speak() }
    }

    fun error(id: String) { if (id.isNotEmpty() && id == utterance && status == "playing") fail() }

    private fun fail() { stop(); status = "error"; changed() }
}
