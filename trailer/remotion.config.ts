import { Config } from '@remotion/cli/config'

// Master output: H.264 High, 1080p60 (or 1080x1920 for the vertical cut). The npm render
// scripts render muted and mux the soundtrack with scripts/mux-audio.mjs (AAC 320 kb/s with a
// priming edit list, so sound and picture stay frame-exact); the audio settings below only
// apply to renders started from the Studio UI.
Config.setVideoImageFormat('png')
Config.setCodec('h264')
Config.setCrf(15)
Config.setX264Preset('slow')
Config.setPixelFormat('yuv420p')
Config.setColorSpace('bt709')
Config.setAudioCodec('aac')
Config.setAudioBitrate('320k')
Config.setOverwriteOutput(true)
Config.setChromiumOpenGlRenderer('angle')
Config.setDelayRenderTimeoutInMilliseconds(60000)
