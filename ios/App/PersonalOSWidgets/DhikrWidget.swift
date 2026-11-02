import AppIntents
import SwiftUI
import WidgetKit

/// The + on the home-screen counter. Runs in the extension: the shared store is all it needs, and the app stays closed.
struct CountDhikrIntent: AppIntent {
    static let title: LocalizedStringResource = "Count one"
    static let isDiscoverable = false

    @Parameter(title: "Key")
    var key: String

    init() {}

    init(key: String) {
        self.key = key
    }

    func perform() async throws -> some IntentResult {
        _ = SharedStore.count(key: key, shown: nil, of: nil)
        WidgetCenter.shared.reloadTimelines(ofKind: WidgetKinds.dhikr)
        return .result()
    }
}

struct DhikrEntry: TimelineEntry {
    enum State {
        case noSnapshot
        case nothingToCount
        case counting(key: String, name: String, count: Int, of: Int)
    }

    let date: Date
    let state: State

    /// The shown count is the snapshot's plus what the app has not taken yet, so a snapshot sent before a drain cannot
    /// rewind it, and neither surface has to rewrite what the app wrote.
    static func now() -> DhikrEntry {
        guard let snapshot = SharedStore.snapshot() else { return DhikrEntry(date: Date(), state: .noSnapshot) }
        guard let dhikr = snapshot.dhikr else { return DhikrEntry(date: Date(), state: .nothingToCount) }
        let count = min(dhikr.of, dhikr.n + SharedStore.waiting(for: dhikr.key))
        return DhikrEntry(date: Date(), state: .counting(key: dhikr.key, name: dhikr.name, count: count, of: dhikr.of))
    }
}

struct DhikrProvider: TimelineProvider {
    func placeholder(in context: Context) -> DhikrEntry {
        DhikrEntry(date: Date(), state: .noSnapshot)
    }

    func getSnapshot(in context: Context, completion: @escaping (DhikrEntry) -> Void) {
        completion(DhikrEntry.now())
    }

    /// Nothing here moves with time: a tap or the app's next snapshot reloads it.
    func getTimeline(in context: Context, completion: @escaping (Timeline<DhikrEntry>) -> Void) {
        completion(Timeline(entries: [DhikrEntry.now()], policy: .never))
    }
}

struct DhikrWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: WidgetKinds.dhikr, provider: DhikrProvider()) { entry in
            DhikrView(entry: entry)
        }
        .configurationDisplayName("Dhikr")
        .description("Count the dhikr open now, without opening the app.")
        .supportedFamilies([.systemSmall])
    }
}

struct DhikrView: View {
    let entry: DhikrEntry
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        content
            .containerBackground(for: .widget) { Palette.base }
    }

    @ViewBuilder
    private var content: some View {
        switch entry.state {
        case .noSnapshot:
            calm("Open the app once")
        case .nothingToCount:
            calm("Nothing to count now")
        case let .counting(key, name, count, of):
            counting(key: key, name: name, count: count, of: of)
                .widgetURL(URL(string: "awqat://go/modes"))
        }
    }

    private func calm(_ text: LocalizedStringKey) -> some View {
        Text(text)
            .font(Palette.serif(24))
            .foregroundStyle(Palette.ivory)
            .minimumScaleFactor(0.7)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .widgetURL(URL(string: "awqat://go/home"))
    }

    private func counting(key: String, name: String, count: Int, of: Int) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(verbatim: name)
                .font(.system(size: 13))
                .foregroundStyle(Palette.softIvory)
                .lineLimit(2)
                .minimumScaleFactor(0.8)
            Spacer(minLength: 4)
            HStack(alignment: .bottom) {
                VStack(alignment: .leading, spacing: 0) {
                    Text(verbatim: "\(count)")
                        .font(Palette.serif(44))
                        .foregroundStyle(Palette.ivory)
                        .lineLimit(1)
                        .minimumScaleFactor(0.6)
                        .contentTransition(reduceMotion ? .identity : .numericText(value: Double(count)))
                    Text(verbatim: "of \(of)")
                        .font(Palette.clock(12))
                        .foregroundStyle(Palette.softIvory)
                }
                Spacer(minLength: 4)
                if count < of {
                    Button(intent: CountDhikrIntent(key: key)) {
                        PlusDisc(diameter: 48)
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }
}
