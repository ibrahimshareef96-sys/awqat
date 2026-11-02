import SwiftUI
import WidgetKit

/// The adhkar widget's choices, as Android's AdhkarData makes them: the prayer day under way, and each set said, open
/// now, or later. The app gives the windows; nothing is worked out here.
enum AdhkarPick {
    enum State {
        case said, open, later
    }

    /// The last day whose morning (Fajr) has come, else the first. From the middle of the night both of its sets are
    /// over, so the next day's, still to come, are shown instead.
    static func day(_ days: [WidgetSnapshot.AdhkarDay], at now: Date) -> WidgetSnapshot.AdhkarDay? {
        guard let index = days.lastIndex(where: { $0.morning.start <= now }) ?? (days.isEmpty ? nil : 0) else { return nil }
        let over = days[index].evening.end <= now && index + 1 < days.count
        return days[over ? index + 1 : index]
    }

    static func state(_ window: WidgetSnapshot.AdhkarDay.Window, at now: Date) -> State {
        if window.said { return .said }
        return window.start <= now && now < window.end ? .open : .later
    }

    static func changes(_ days: [WidgetSnapshot.AdhkarDay]) -> [Date] {
        days.flatMap { [$0.morning.start, $0.morning.end, $0.evening.start, $0.evening.end] }
    }
}

struct AdhkarEntry: TimelineEntry {
    enum Content {
        case calm(LocalizedStringKey)
        case sets(morning: AdhkarPick.State, evening: AdhkarPick.State)
    }

    let date: Date
    let content: Content
}

enum AdhkarTimeline {
    private static let entriesMax = 60

    static func entries(from snapshot: WidgetSnapshot?, now: Date) -> [AdhkarEntry] {
        guard let snapshot else { return [AdhkarEntry(date: now, content: .calm("Open the app once"))] }
        // A guessed place's windows are Makkah's: none is shown.
        if snapshot.placeUnset { return [AdhkarEntry(date: now, content: .calm("Set your place"))] }
        let days = snapshot.adhkar ?? []
        let last = AdhkarPick.changes(days).max()
        return WidgetCalendar.moments(AdhkarPick.changes(days), from: now, limit: entriesMax).map { date in
            guard let day = AdhkarPick.day(days, at: date), let last, date < last else {
                return AdhkarEntry(date: date, content: .calm("Open the app once"))
            }
            return AdhkarEntry(date: date, content: .sets(morning: AdhkarPick.state(day.morning, at: date),
                                                          evening: AdhkarPick.state(day.evening, at: date)))
        }
    }
}

struct AdhkarProvider: TimelineProvider {
    func placeholder(in context: Context) -> AdhkarEntry {
        AdhkarEntry(date: Date(), content: .calm("Open the app once"))
    }

    func getSnapshot(in context: Context, completion: @escaping (AdhkarEntry) -> Void) {
        completion(AdhkarTimeline.entries(from: SharedStore.snapshot(), now: Date()).first ?? placeholder(in: context))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<AdhkarEntry>) -> Void) {
        let entries = AdhkarTimeline.entries(from: SharedStore.snapshot(), now: Date())
        completion(Timeline(entries: entries, policy: entries.count > 1 ? .atEnd : .never))
    }
}

struct AdhkarWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: WidgetKinds.adhkar, provider: AdhkarProvider()) { entry in
            AdhkarView(entry: entry)
        }
        .configurationDisplayName("Adhkar")
        .description("Whether the morning and evening adhkar are said, open now, or later.")
        .supportedFamilies([.systemSmall])
    }
}

struct AdhkarView: View {
    let entry: AdhkarEntry

    var body: some View {
        content
            .containerBackground(for: .widget) { Palette.base }
    }

    @ViewBuilder
    private var content: some View {
        switch entry.content {
        case let .calm(text):
            Calm(text: text, font: Palette.serif(24), alignment: .leading)
                .foregroundStyle(Palette.ivory)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                .widgetURL(WidgetLinks.home)
        case let .sets(morning, evening):
            VStack(alignment: .leading, spacing: 8) {
                CapsLabel(text: "Adhkar")
                Spacer(minLength: 0)
                SetLine(name: "Morning", state: morning)
                SetLine(name: "Evening", state: evening)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .widgetURL(WidgetLinks.adhkar)
        }
    }
}

/// A set's name, and below it whether it is said, open now (in the accent), or later.
private struct SetLine: View {
    let name: LocalizedStringKey
    let state: AdhkarPick.State

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(name)
                .font(Palette.text(.caption))
                .foregroundStyle(Palette.softIvory)
            Text(word)
                .font(Palette.serif(22, relativeTo: .title3))
                .foregroundStyle(state == .open ? Palette.champagne : state == .said ? Palette.ivory : Palette.softIvory)
        }
        .lineLimit(1)
        .minimumScaleFactor(0.6)
        .accessibilityElement(children: .combine)
    }

    private var word: LocalizedStringKey {
        switch state {
        case .said: return "Said"
        case .open: return "Open now"
        case .later: return "Later"
        }
    }
}
