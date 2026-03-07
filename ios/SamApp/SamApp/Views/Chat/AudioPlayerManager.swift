import Foundation
import AVFoundation
import Observation

@Observable
final class AudioPlayerManager: NSObject, AVAudioPlayerDelegate {
    var currentlyPlayingId: String?
    var isPlaying: Bool = false
    var progress: Double = 0
    var duration: TimeInterval = 0

    private var player: AVAudioPlayer?
    private var displayLink: CADisplayLink?

    func play(id: String, url: URL) {
        // If tapping the same item, toggle pause/resume
        if currentlyPlayingId == id, let player, player.isPlaying {
            player.pause()
            isPlaying = false
            stopDisplayLink()
            return
        }
        if currentlyPlayingId == id, let player, !player.isPlaying {
            player.play()
            isPlaying = true
            startDisplayLink()
            return
        }

        // New item — stop previous and start fresh
        stop()

        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playback, mode: .default)
            try session.setActive(true)
        } catch {
            print("[AudioPlayer] Session error: \(error)")
        }

        do {
            let p = try AVAudioPlayer(contentsOf: url)
            p.delegate = self
            p.play()
            player = p
            currentlyPlayingId = id
            isPlaying = true
            duration = p.duration
            progress = 0
            startDisplayLink()
        } catch {
            print("[AudioPlayer] Playback error: \(error)")
        }
    }

    func playStreaming(id: String, url: URL) {
        // For remote URLs, download first then play
        if currentlyPlayingId == id, let player {
            if player.isPlaying {
                player.pause()
                isPlaying = false
                stopDisplayLink()
            } else {
                player.play()
                isPlaying = true
                startDisplayLink()
            }
            return
        }

        stop()
        currentlyPlayingId = id
        isPlaying = false
        progress = 0

        Task {
            do {
                let (data, _) = try await URLSession.shared.data(from: url)
                let ext = url.pathExtension.isEmpty ? "aac" : url.pathExtension
                let tempURL = FileManager.default.temporaryDirectory
                    .appendingPathComponent("audio-\(id.hashValue)")
                    .appendingPathExtension(ext)
                try data.write(to: tempURL)
                await MainActor.run {
                    self.play(id: id, url: tempURL)
                }
            } catch {
                await MainActor.run {
                    print("[AudioPlayer] Download error: \(error)")
                    self.currentlyPlayingId = nil
                }
            }
        }
    }

    func stop() {
        player?.stop()
        player = nil
        stopDisplayLink()
        currentlyPlayingId = nil
        isPlaying = false
        progress = 0
        duration = 0
    }

    // MARK: - AVAudioPlayerDelegate

    func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        stopDisplayLink()
        isPlaying = false
        progress = 0
        currentlyPlayingId = nil
    }

    // MARK: - Progress tracking

    private func startDisplayLink() {
        stopDisplayLink()
        let link = CADisplayLink(target: self, selector: #selector(updateProgress))
        link.preferredFrameRateRange = .init(minimum: 15, maximum: 30)
        link.add(to: .main, forMode: .common)
        displayLink = link
    }

    private func stopDisplayLink() {
        displayLink?.invalidate()
        displayLink = nil
    }

    @objc private func updateProgress() {
        guard let player, player.duration > 0 else { return }
        progress = player.currentTime / player.duration
    }
}
