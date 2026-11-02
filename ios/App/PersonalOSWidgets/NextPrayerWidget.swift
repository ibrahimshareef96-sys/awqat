import SwiftUI
import WidgetKit

/// One moment of the next-prayer widget. No prayer means the snapshot is missing, unreadable, has run out, or the place
/// is only guessed (`placeUnset`: then it says "Set your place").
struct NextPrayerEntry: TimelineEntry {
    let date: Date
    let prayer: WidgetSnapshot.Prayer?
    let quran: String?
    let revise: String?
    let steps: String?
    var placeUnset = false
}

/// Native holds no prayer logic beyond this: the next time from the list it was given, with an entry at each one and at
/// each midnight so the widget moves on by itself with the app closed.
enum NextPrayerTimeline {
    /// About a week. When these run out WidgetKit asks again and the next week of the snapshot follows.
    private static let prayersMax = 40

    static func entries(from snapshot: WidgetSnapshot?, now: Date) -> [NextPrayerEntry] {
        guard let snapshot else {
            return [NextPrayerEntry(date: now, prayer: nil, quran: nil, revise: nil, steps: nil)]
        }
        if snapshot.placeUnset {
            return [NextPrayerEntry(date: now, prayer: nil, quran: nil, revise: nil, steps: nil, placeUnset: true)]
        }
        let prayers = snapshot.prayers.filter { $0.date > now }.sorted { $0.at < $1.at }
        let window = prayers.prefix(prayersMax).map(\.date)
        let zone = WidgetCalendar.zone(snapshot.tz)
        let moments = Set([now] + window + midnights(after: now, through: window.last, in: zone))
        return moments.sorted().map { entry(at: $0, prayers: prayers, snapshot: snapshot, zone: zone) }
    }

    private static func entry(at date: Date, prayers: [WidgetSnapshot.Prayer], snapshot: WidgetSnapshot,
                              zone: TimeZone) -> NextPrayerEntry {
        let today = WidgetCalendar.dayString(date, in: zone)
        let day = snapshot.days.first { $0.date == today }
        // The page to read on does not change at midnight; the revision and the steps belong to their own day.
        let quran = day?.quran ?? snapshot.days.first?.quran
        let steps = snapshot.days.first?.date == today ? snapshot.steps : nil
        return NextPrayerEntry(date: date, prayer: prayers.first { $0.date > date }, quran: quran?.nonEmpty,
                               revise: day?.revise.nonEmpty, steps: steps?.nonEmpty)
    }

    private static func midnights(after now: Date, through last: Date?, in zone: TimeZone) -> [Date] {
        guard let last else { return [] }
        return WidgetCalendar.midnights(after: now, count: WidgetCalendar.daysMax, in: zone).filter { $0 < last }
    }
}

extension String {
    /// Nil for an empty line, so a widget can leave it out.
    var nonEmpty: String? { isEmpty ? nil : self }
}

struct NextPrayerProvider: TimelineProvider {
    func placeholder(in context: Context) -> NextPrayerEntry {
        NextPrayerEntry(date: Date(), prayer: nil, quran: nil, revise: nil, steps: nil)
    }

    func getSnapshot(in context: Context, completion: @escaping (NextPrayerEntry) -> Void) {
        let now = Date()
        completion(NextPrayerTimeline.entries(from: SharedStore.snapshot(), now: now).first ?? placeholder(in: context))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<NextPrayerEntry>) -> Void) {
        let entries = NextPrayerTimeline.entries(from: SharedStore.snapshot(), now: Date())
        // With nothing to count down to, it waits for the app's next snapshot, which reloads it.
        let hasPrayer = entries.contains { $0.prayer != nil }
        completion(Timeline(entries: entries, policy: hasPrayer ? .atEnd : .never))
    }
}

struct NextPrayerWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: WidgetKinds.nextPrayer, provider: NextPrayerProvider()) { entry in
            NextPrayerView(entry: entry)
        }
        .configurationDisplayName("Next prayer")
        .description("The next prayer counting down, the page to read on, and today's revision.")
        .supportedFamilies([.systemSmall, .systemMedium, .accessoryCircular, .accessoryRectangular, .accessoryInline])
    }
}
