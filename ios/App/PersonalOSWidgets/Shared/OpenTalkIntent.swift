import AppIntents
import Foundation

/// The Talk control's action (iOS 18): opens the app on the Talk sheet through the same checked link as a widget.
/// The sheet waits for its Talk button; a link never turns the microphone on. In both targets, as Apple asks of an
/// intent that opens the app from a control.
@available(iOS 18.0, *)
struct OpenTalkIntent: AppIntent {
    static let title: LocalizedStringResource = "Talk to Awqat"
    static let isDiscoverable = false

    /// A fixed literal that is a valid URL, so it is never nil.
    private static let link = URL(string: "awqat://go/talk")!

    init() {}

    func perform() async throws -> some IntentResult & OpensIntent {
        .result(opensIntent: OpenURLIntent(Self.link))
    }
}
