package com.proteus.opendraft

import org.junit.Assert.*
import org.junit.Test

class TableReadPlaybackTest {
    private data class Call(val text: String, val voice: String?, val rate: Float, val pitch: Float, val id: String)
    private class Rig {
        val calls = mutableListOf<Call>()
        var granted = true
        var released = 0
        var now = 0L
        val tasks = mutableListOf<Pair<Long, () -> Unit>>()
        val player = TableReadPlayback(object : TableReadPlayback.Speech {
            override fun speak(text: String, voice: String?, rate: Float, pitch: Float, id: String): Boolean {
                calls.add(Call(text, voice, rate, pitch, id)); return true
            }
            override fun stop() {}
        }, object : TableReadPlayback.Audio {
            override fun acquire() = granted
            override fun release() { released++ }
        }, { delay, task -> tasks.add(now + delay to task) }, {})
        fun advance(ms: Long) {
            val until = now + ms
            while (true) {
                val next = tasks.minByOrNull { it.first } ?: break
                if (next.first > until) break
                tasks.remove(next); now = next.first; next.second()
            }
            now = until
        }
        fun line(text: String, voice: String = "reader") = TableReadPlayback.Line(text, voice, 1.2f, 0.9f, 250)
        fun load(vararg lines: TableReadPlayback.Line) = player.load("main", "session", lines.toList(), 0, 0)
    }

    @Test fun advancesTheWholeQueueWithoutWebViewPollingAndKeepsTheCast() {
        val r = Rig()
        r.load(r.line("First line", "narrator"), r.line("Second line", "actor"))
        assertEquals("loading", r.player.status)
        r.player.engineReady(true)
        assertEquals(Call("First line", "narrator", 1.2f, 0.9f, r.calls[0].id), r.calls[0])
        r.player.done(r.calls.last().id)
        r.advance(249); assertEquals(1, r.calls.size)
        r.advance(1); assertEquals("Second line", r.calls.last().text)
        assertEquals("actor", r.calls.last().voice)
        r.player.done(r.calls.last().id)
        assertEquals("idle", r.player.status)
        r.player.resume(); r.advance(100_000)
        assertEquals(2, r.calls.size)
    }

    @Test fun pauseResumesAtTheWordAndRejectsCancelledUtteranceCallbacks() {
        val r = Rig(); r.player.engineReady(true)
        r.load(r.line("First second third"), r.line("Next"))
        val old = r.calls.last().id
        r.player.word(old, 6, 12)
        r.player.pause()
        r.player.done(old); r.player.error(old); r.player.word(old, 0, 5)
        assertEquals("paused", r.player.status); assertEquals(6, r.player.offset)
        r.player.resume()
        assertEquals("second third", r.calls.last().text)
        r.player.done(r.calls.last().id)
        r.player.pause(); r.advance(500)
        assertEquals(2, r.calls.size)
        r.player.resume(); assertEquals("Next", r.calls.last().text)
        r.player.pause(); r.player.jump(0)
        assertEquals("paused", r.player.status); assertEquals(0, r.player.index)
        r.player.resume(); assertEquals("First second third", r.calls.last().text)
    }

    @Test fun focusDenialAndTransientLossNeverOverrideAManualPause() {
        val r = Rig(); r.player.engineReady(true); r.granted = false
        r.load(r.line("Focus test"))
        assertEquals("paused", r.player.status); assertTrue(r.calls.isEmpty())
        r.granted = true; r.player.resume()
        r.player.pause(true); r.player.focusGained()
        assertEquals(2, r.calls.size)
        r.player.pause(true); r.player.pause(); r.player.focusGained()
        assertEquals(2, r.calls.size); assertEquals("paused", r.player.status)
        assertTrue(r.released > 0)
    }

    @Test fun chunksLongLinesWithoutSplittingASurrogatePair() {
        val r = Rig(); r.player.engineReady(true)
        r.load(r.line("x".repeat(3899) + "😀end"))
        assertEquals(3899, r.calls.last().text.length)
        r.player.done(r.calls.last().id)
        assertEquals("😀end", r.calls.last().text)
        r.player.word(r.calls.last().id, 0, 2)
        assertEquals(3899, r.player.offset); assertEquals(3901, r.player.end)
        r.player.word(r.calls.last().id, -1, 9000)
        assertEquals(3899, r.player.offset)
    }

    @Test fun initializationFailureAndSilentEnginesReleasePlayback() {
        val failed = Rig(); failed.player.engineReady(false); failed.load(failed.line("Failure"))
        assertEquals("error", failed.player.status); assertTrue(failed.calls.isEmpty())
        val silent = Rig(); silent.player.engineReady(true); silent.load(silent.line("Silence"))
        silent.advance(45_000)
        assertEquals("error", silent.player.status)
        silent.player.done(silent.calls.last().id)
        assertEquals("error", silent.player.status)
    }

    @Test fun pauseBeforeInitializationAndReplacingAQueueCancelOldWork() {
        val r = Rig(); r.load(r.line("Old"), r.line("Obsolete")); r.player.pause()
        r.player.engineReady(true)
        assertTrue(r.calls.isEmpty())
        r.player.resume(); r.player.done(r.calls.last().id)
        r.player.load("other-window", "replacement", listOf(r.line("Replacement")), 0, 0)
        r.advance(250)
        assertEquals(listOf("Old", "Replacement"), r.calls.map { it.text })
        r.player.done(""); r.player.error("")
        assertEquals("playing", r.player.status)
        r.player.stop(); r.advance(100_000)
        assertEquals("idle", r.player.status)
    }
}
