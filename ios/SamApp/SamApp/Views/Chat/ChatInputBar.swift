import SwiftUI
import UIKit
import PhotosUI
import AVFoundation

/// Lightweight draft that carries text, images, and optional audio.
struct ChatDraft {
    let text: String
    let imageData: [Data]
    let audioURL: URL?
    let audioDuration: TimeInterval?
}

struct ChatInputBar: View {
    @Binding var text: String
    var onSend: (ChatDraft) -> Void

    // Photos
    @State private var selectedPhotos: [PhotosPickerItem] = []
    @State private var loadedImages: [(Data, UIImage)] = []
    @State private var showPhotoPicker = false

    // Audio recording
    @State private var recorder: AudioRecorderHelper?
    @State private var recordedURL: URL?
    @State private var recordedDuration: TimeInterval?

    // Gesture state (recording via long-press)
    @GestureState private var isHolding: Bool = false
    @GestureState private var isRecordingGesture: Bool = false
    @GestureState private var recorderOffset: CGFloat = 0
    @State private var lastRecorderOffset: CGFloat = 0
    @State private var recorderStartTimeStamp: Date = .now
    @State private var disableBottomBar: Bool = false

    private var hasText: Bool {
        !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private var canSend: Bool {
        hasText || !loadedImages.isEmpty || recordedURL != nil
    }

    /// The action button shows paperplane when there's content to send, mic otherwise.
    private var showSendMode: Bool {
        canSend
    }

    var mainActionSymbol: String {
        if showSendMode { return "paperplane.fill" }
        return isRecordingGesture ? "waveform" : "mic.fill"
    }

    var body: some View {
        VStack(spacing: 0) {
            // Attachment previews
            if !loadedImages.isEmpty || recordedURL != nil {
                attachmentPreviews
            }

            // Input bar
            HStack(spacing: 10) {
                // Left capsule: menu button + text field
                HStack(spacing: 6) {
                    AnimatedMenuButton(
                        isRecording: isRecordingGesture,
                        disableBottomBar: $disableBottomBar
                    ) {
                        showPhotoPicker = true
                    }

                    TextField("Message", text: $text, axis: .vertical)
                        .lineLimit(1...5)
                        .opacity(isRecordingGesture ? 0 : 1)
                        .overlay(alignment: .trailing) {
                            if isRecordingGesture {
                                HStack(spacing: 0) {
                                    Text(recorderStartTimeStamp, style: .timer)
                                        .font(.callout)
                                        .fontWeight(.medium)
                                        .foregroundStyle(.gray)

                                    Spacer(minLength: 0)

                                    SlideToCancelText(text: "Slide to cancel")
                                }
                                .padding(.trailing, 10)
                            }
                        }
                        .animation(.interpolatingSpring(duration: 0.3), value: isRecordingGesture)
                }
                .padding(.horizontal, 12)
                .frame(minHeight: 48)
                .background(.ultraThinMaterial, in: .capsule)
                .mask {
                    Rectangle()
                        .padding(-50)
                        .padding(.trailing, abs(recorderOffset))
                }
                .shadow(radius: 1)

                // Right action button
                Image(systemName: mainActionSymbol)
                    .font(.system(size: 20, weight: .medium))
                    .foregroundStyle(.white)
                    .contentTransition(.symbolEffect(.replace, options: .default.speed(1.2)))
                    .frame(width: 48, height: 48)
                    .background(.blue.gradient, in: .circle)
                    .scaleEffect(isHolding ? 1.28 : 1)
                    .offset(x: recorderOffset)
                    // Tap to send (when there's content)
                    .gesture(sendGesture, isEnabled: showSendMode)
                    // Long-press to record (when idle)
                    .gesture(
                        LongPressGesture(minimumDuration: 0.3)
                            .sequenced(before: DragGesture(minimumDistance: 10))
                            .updating($isHolding) { _, out, _ in
                                out = true
                            }
                            .updating($isRecordingGesture) { value, out, _ in
                                if case .second(_, _) = value {
                                    out = true
                                }
                            }
                            .updating($recorderOffset) { value, out, _ in
                                if case let .second(_, gesture) = value, let gesture {
                                    let translation = gesture.translation.width
                                    out = max(min(translation, 0), -200)
                                }
                            },
                        isEnabled: !showSendMode
                    )
            }
            .padding(.horizontal, 15)
            .padding(.vertical, 8)
            .animation(.interpolatingSpring(duration: 0.4), value: isHolding)
            .animation(.interactiveSpring(duration: 0.3), value: recorderOffset == 0)
            .onChange(of: isRecordingGesture) { oldValue, newValue in
                if newValue {
                    recorderStartTimeStamp = .now
                    startRecording()
                } else {
                    if -lastRecorderOffset > 50 {
                        // Discarded
                        disableBottomBar = true
                        discardRecording()
                    } else {
                        // Kept
                        finishRecording()
                    }
                    lastRecorderOffset = 0
                }
            }
            .onChange(of: recorderOffset) { _, newValue in
                if isRecordingGesture {
                    lastRecorderOffset = newValue
                }
            }
            .overlay {
                if disableBottomBar {
                    Rectangle()
                        .foregroundStyle(.clear)
                        .contentShape(.rect)
                        .transition(.identity)
                }
            }
        }
        .background(.bar)
        .photosPicker(
            isPresented: $showPhotoPicker,
            selection: $selectedPhotos,
            maxSelectionCount: 5,
            matching: .images
        )
        .onChange(of: selectedPhotos) { _, newItems in
            Task { await loadPhotos(newItems) }
        }
    }

    // MARK: - Send gesture

    private var sendGesture: some Gesture {
        TapGesture(count: 1).onEnded { _ in
            send()
        }
    }

    // MARK: - Attachment previews

    private var attachmentPreviews: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(Array(loadedImages.enumerated()), id: \.offset) { index, pair in
                    ZStack(alignment: .topTrailing) {
                        Image(uiImage: pair.1)
                            .resizable()
                            .aspectRatio(contentMode: .fill)
                            .frame(width: 60, height: 60)
                            .clipShape(RoundedRectangle(cornerRadius: 8))

                        Button {
                            loadedImages.remove(at: index)
                            selectedPhotos.remove(at: index)
                        } label: {
                            Image(systemName: "xmark.circle.fill")
                                .font(.caption)
                                .foregroundStyle(.white)
                                .background(Circle().fill(.black.opacity(0.5)))
                        }
                        .offset(x: 4, y: -4)
                    }
                }

                if recordedURL != nil {
                    ZStack(alignment: .topTrailing) {
                        Label(
                            durationText(recordedDuration),
                            systemImage: "waveform"
                        )
                        .font(.caption)
                        .padding(8)
                        .background(Color(.systemGray5))
                        .clipShape(RoundedRectangle(cornerRadius: 8))

                        Button {
                            recordedURL = nil
                            recordedDuration = nil
                        } label: {
                            Image(systemName: "xmark.circle.fill")
                                .font(.caption)
                                .foregroundStyle(.white)
                                .background(Circle().fill(.black.opacity(0.5)))
                        }
                        .offset(x: 4, y: -4)
                    }
                }
            }
            .padding(.horizontal, 15)
            .padding(.top, 8)
        }
    }

    // MARK: - Actions

    private func send() {
        let draft = ChatDraft(
            text: text.trimmingCharacters(in: .whitespacesAndNewlines),
            imageData: loadedImages.map(\.0),
            audioURL: recordedURL,
            audioDuration: recordedDuration
        )
        guard !draft.text.isEmpty || !draft.imageData.isEmpty || draft.audioURL != nil else { return }

        text = ""
        loadedImages = []
        selectedPhotos = []
        recordedURL = nil
        recordedDuration = nil

        onSend(draft)
    }

    private func loadPhotos(_ items: [PhotosPickerItem]) async {
        var results: [(Data, UIImage)] = []
        for item in items {
            if let data = try? await item.loadTransferable(type: Data.self),
               let image = UIImage(data: data) {
                results.append((data, image))
            }
        }
        await MainActor.run { loadedImages = results }
    }

    // MARK: - Audio recording

    private func startRecording() {
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(.playAndRecord, mode: .default)
            try session.setActive(true)
        } catch {
            print("[ChatInputBar] Audio session error: \(error)")
            return
        }

        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString)
            .appendingPathExtension("aac")

        let settings: [String: Any] = [
            AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
            AVSampleRateKey: 44100,
            AVNumberOfChannelsKey: 1,
            AVEncoderBitRateKey: 128000,
        ]

        do {
            let helper = AudioRecorderHelper()
            helper.recorder = try AVAudioRecorder(url: url, settings: settings)
            helper.recorder?.record()
            recorder = helper
        } catch {
            print("[ChatInputBar] Recording error: \(error)")
        }
    }

    private func finishRecording() {
        guard let r = recorder?.recorder else { return }
        r.stop()
        recordedURL = r.url
        recordedDuration = r.currentTime
        recorder = nil
    }

    private func discardRecording() {
        guard let r = recorder?.recorder else { return }
        r.stop()
        r.deleteRecording()
        recorder = nil
    }

    private func durationText(_ d: TimeInterval?) -> String {
        guard let d, d > 0 else { return "Audio" }
        return String(format: "%d:%02d", Int(d) / 60, Int(d) % 60)
    }
}

/// Wraps AVAudioRecorder so it can be stored in @State (reference type).
private final class AudioRecorderHelper {
    var recorder: AVAudioRecorder?
}

// MARK: - Animated Menu Button

private struct AnimatedMenuButton: View {
    var isRecording: Bool
    @Binding var disableBottomBar: Bool
    var action: () -> ()
    @State private var keyFrameTrigger: Bool = false
    @State private var isTrashOpen: Bool = false

    var body: some View {
        Button(action: action) {
            ZStack {
                if isRecording || disableBottomBar {
                    Image(systemName: "mic")
                        .font(.system(size: 20, weight: .medium))
                        .foregroundStyle(Color.primary)
                        .transition(.scale(scale: 0.5).combined(with: .opacity))
                        .keyframeAnimator(initialValue: KeyFrame(), trigger: keyFrameTrigger) { content, frame in
                            content
                                .scaleEffect(frame.scale, anchor: .bottom)
                                .rotationEffect(.init(degrees: frame.rotation))
                                .offset(y: frame.offset)
                                .opacity(frame.opacity)
                        } keyframes: { _ in
                            CubicKeyframe(KeyFrame(offset: -50, rotation: 360), duration: 0.25)
                            CubicKeyframe(KeyFrame(scale: 0.5, offset: 0, rotation: 360), duration: 0.25)
                            CubicKeyframe(KeyFrame(opacity: 0, scale: 0.5, offset: 0, rotation: 360), duration: 0.1)
                        }
                } else {
                    Image(systemName: "plus")
                        .font(.system(size: 20, weight: .medium))
                        .foregroundStyle(Color.primary)
                        .transition(.scale(scale: 0.5).combined(with: .opacity))
                }

                CustomTrashCanView(isTrashOpen)
                    .keyframeAnimator(initialValue: KeyFrame(opacity: 0, scale: 0.5), trigger: keyFrameTrigger) { content, frame in
                        content
                            .scaleEffect(frame.scale)
                            .opacity(frame.opacity)
                    } keyframes: { _ in
                        CubicKeyframe(KeyFrame(scale: 1), duration: 0.2)
                        CubicKeyframe(KeyFrame(scale: 1), duration: 0.5)
                        CubicKeyframe(KeyFrame(opacity: 0, scale: 0.5), duration: 0.2)
                    }
            }
            .frame(width: 30)
        }
        .allowsHitTesting(!isRecording)
        .animation(.easeInOut(duration: 0.3), value: isRecording)
        .animation(.easeInOut(duration: 0.3), value: disableBottomBar)
        .onChange(of: disableBottomBar) { _, newValue in
            if newValue {
                keyFrameTrigger.toggle()
                Task { @MainActor in
                    isTrashOpen = true
                    try? await Task.sleep(for: .seconds(0.5))
                    isTrashOpen = false
                    try? await Task.sleep(for: .seconds(0.2))
                    disableBottomBar = false
                }
            }
        }
    }

    @ViewBuilder
    func CustomTrashCanView(_ isOpen: Bool) -> some View {
        VStack(spacing: 2) {
            VStack(spacing: 0) {
                UnevenRoundedRectangle(
                    topLeadingRadius: 10,
                    bottomLeadingRadius: 0,
                    bottomTrailingRadius: 0,
                    topTrailingRadius: 10
                )
                .frame(width: 15, height: 6)

                Capsule()
                    .frame(height: 4)
            }
            .compositingGroup()
            .rotationEffect(.init(degrees: isOpen ? -90 : 0), anchor: .bottomLeading)
            .offset(y: isOpen ? 10 : 0)

            UnevenRoundedRectangle(
                topLeadingRadius: 0,
                bottomLeadingRadius: 5,
                bottomTrailingRadius: 5,
                topTrailingRadius: 0
            )
            .frame(width: 20, height: 20)
        }
        .frame(width: 25)
        .foregroundStyle(.gray)
        .compositingGroup()
        .scaleEffect(0.8)
        .animation(.easeInOut(duration: 0.3), value: isOpen)
    }

    @Animatable
    struct KeyFrame {
        var opacity: CGFloat = 1
        var scale: CGFloat = 1
        var offset: CGFloat = 0
        var rotation: CGFloat = 0
    }
}
