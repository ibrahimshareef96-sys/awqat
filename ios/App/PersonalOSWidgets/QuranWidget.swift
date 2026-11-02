import SwiftUI
import WidgetKit

/// One moment of the Quran widget: the day's lines, or nil before the app has given any.
struct QuranEntry: TimelineEntry {
    let date: Date
    let page: String?
    let read: String?
    let revise: String?
}

/// The same day lines the next-prayer widget reads, moving on at each midnight. Nothing here comes from the prayer
/// times, so it shows with a place only guessed too.
enum QuranTimeline {
    static func entries(from snapshot: WidgetSnapshot?, now: Date) -> [QuranEntry] {
        guard let snapshot, !snapshot.days.isEmpty else { return [QuranEntry(date: now, page: nil, read: nil, revise: nil)] }
        let zone = WidgetCalendar.zone(snapshot.tz)
        let moments = [now] + WidgetCalendar.midnights(after: now, count: snapshot.days.count + 1, in: zone)
        return moments.map { date in
            let day = line(for: WidgetCalendar.dayString(date, in: zone), in: snapshot.days)
            // The page to read on does not change with the day; the reading and the revision belong to their own.
            return QuranEntry(date: date, page: (day ?? snapshot.days.first)?.quran.nonEmpty, read: day?.read?.nonEmpty,
                              revise: day?.revise.nonEmpty)
        }
    }

    /// Today's lines; past the last day, the last day's still hold (with the app closed nothing is logged), as on Android.
    private static func line(for today: String, in days: [WidgetSnapshot.Day]) -> WidgetSnapshot.Day? {
        if let day = days.first(where: { $0.date == today }) { return day }
        guard let last = days.last, !last.date.isEmpty, today > last.date else { return nil }
        return last
    }
}

struct QuranProvider: TimelineProvider {
    func placeholder(in context: Context) -> QuranEntry {
        QuranEntry(date: Date(), page: nil, read: nil, revise: nil)
    }

    func getSnapshot(in context: Context, completion: @escaping (QuranEntry) -> Void) {
        completion(QuranTimeline.entries(from: SharedStore.snapshot(), now: Date()).first ?? placeholder(in: context))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<QuranEntry>) -> Void) {
        let entries = QuranTimeline.entries(from: SharedStore.snapshot(), now: Date())
        completion(Timeline(entries: entries, policy: entries.count > 1 ? .atEnd : .never))
    }
}

struct QuranWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: WidgetKinds.quran, provider: QuranProvider()) { entry in
            QuranView(entry: entry)
        }
        .configurationDisplayName("Quran")
        .description("The page to read on, today's pages, and today's revision.")
        .supportedFamilies([.systemSmall])
    }
}

struct QuranView: View {
    let entry: QuranEntry

    var body: some View {
        content
            .containerBackground(for: .widget) { Palette.base }
    }

    @ViewBuilder
    private var content: some View {
        if let page = entry.page {
            VStack(alignment: .leading, spacing: 4) {
                CapsLabel(text: "Quran")
                Text(verbatim: page)
                    .font(Palette.serif(26, relativeTo: .title2))
                    .foregroundStyle(Palette.ivory)
                    .lineLimit(2)
                    .minimumScaleFactor(0.6)
                Spacer(minLength: 2)
                if let read = entry.read {
                    line(read, color: Palette.ivory)
                }
                if let revise = entry.revise {
                    line(revise, color: Palette.softIvory)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .widgetURL(WidgetLinks.mushaf)
        } else {
            Calm(text: "Open the app once", font: Palette.serif(24), alignment: .leading)
                .foregroundStyle(Palette.ivory)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                .widgetURL(WidgetLinks.home)
        }
    }

    private func line(_ text: String, color: Color) -> some View {
        Text(verbatim: text)
            .font(Palette.text(.footnote))
            .foregroundStyle(color)
            .lineLimit(2)
            .minimumScaleFactor(0.7)
    }
}
