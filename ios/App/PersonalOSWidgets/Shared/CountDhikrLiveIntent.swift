import ActivityKit
import AppIntents
import Foundation
import WidgetKit

/// The + on a dhikr Live Activity. Apple runs a LiveActivityIntent in the app's process, launching it without opening
/// it, and asks for the type in the app target; the extension needs it too, to build the button.
struct CountDhikrLiveIntent: LiveActivityIntent {
    static let title: LocalizedStringResource = "Count one"
    static let isDiscoverable = false

    @Parameter(title: "Key")
    var key: String

    init() {}

    init(key: String) {
        self.key = key
    }

    func perform() async throws -> some IntentResult {
        let key = key
        await LiveLine.enqueue { await Self.tap(key: key) }.value
        return .result()
    }

    /// Adds to pendingTaps, moves the count on screen, and at its number the activity ends itself.
    private static func tap(key: String) async {
        let up = LiveItemAttributes.up(id: "dhikr")
        let state = up.map { LiveItemAttributes.state(of: $0) }
        let shown = state?.key == key ? state : nil
        let counted = SharedStore.count(key: key, shown: shown?.count, of: shown?.of)
        WidgetCenter.shared.reloadTimelines(ofKind: WidgetKinds.dhikr)
        guard let up, let shown else { return }
        // Nil means the other surface got there first: this one shows its number too and ends.
        let next = (counted ?? shown.of).map { shown.counted($0) } ?? shown
        if next.isFull {
            let content = LiveItemAttributes.content(id: "dhikr", state: next)
            await up.end(content, dismissalPolicy: .after(Date().addingTimeInterval(5)))
        } else {
            await LiveItemAttributes.send(next, to: up)
        }
    }
}
