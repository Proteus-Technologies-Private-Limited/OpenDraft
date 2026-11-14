package com.proteus.opendraft

import android.media.AudioFormat
import android.speech.tts.*
import java.util.Locale

/** TEST APK ONLY. Real TTS binder/audio callbacks with synthetic tones, no
 * network voice downloads. Never copied into a production APK. */
class TableReadTestSpeech : TextToSpeechService() {
    @Volatile private var cancelled = false
    override fun onIsLanguageAvailable(language: String, country: String, variant: String) =
        if (language == "eng" || language == "en") TextToSpeech.LANG_COUNTRY_AVAILABLE else TextToSpeech.LANG_NOT_SUPPORTED
    override fun onLoadLanguage(language: String, country: String, variant: String) = onIsLanguageAvailable(language, country, variant)
    override fun onGetLanguage() = arrayOf("eng", "USA", "")
    override fun onGetVoices() = listOf(Voice("ci-test", Locale.US, Voice.QUALITY_NORMAL, Voice.LATENCY_NORMAL, false, emptySet()))
    override fun onGetDefaultVoiceNameFor(language: String, country: String, variant: String) = "ci-test"
    override fun onIsValidVoiceName(voice: String) = if (voice == "ci-test") TextToSpeech.SUCCESS else TextToSpeech.ERROR
    override fun onLoadVoice(voice: String) = onIsValidVoiceName(voice)
    override fun onStop() { cancelled = true }
    override fun onSynthesizeText(request: SynthesisRequest, callback: SynthesisCallback) {
        cancelled = false
        callback.start(16000, AudioFormat.ENCODING_PCM_16BIT, 1)
        val pcm = ByteArray(640)
        for (i in 0 until 320) {
            val value = (kotlin.math.sin(i * 2 * Math.PI * 220 / 16000) * 2000).toInt()
            pcm[i * 2] = value.toByte(); pcm[i * 2 + 1] = (value shr 8).toByte()
        }
        val text = request.charSequenceText.toString()
        for (chunk in 0 until 200) {
            if (cancelled) return
            if (chunk % 20 == 0 && text.isNotEmpty()) {
                val start = minOf(text.lastIndex, chunk * text.length / 200)
                callback.rangeStart(chunk * 320, start, minOf(text.length, start + 1))
            }
            if (callback.audioAvailable(pcm, 0, pcm.size) != TextToSpeech.SUCCESS) return
            Thread.sleep(20)
        }
        callback.done()
    }
}
