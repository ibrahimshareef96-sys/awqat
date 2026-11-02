import SwiftUI
import WidgetKit

/// One day of the Hijri date on the Lock Screen, as the app worked it out (Umm al-Qura); nil when it has none for the day.
struct HijriEntry: TimelineEntry {
    let date: Date
    let hijri: WidgetSnapshot.PrayerDay.Hijri?
    var placeUnset = false
}

/// The day's Hijri date from the snapshot's prayer days, moving on at each midnight.
enum HijriTimeline {
    static func entries(from snapshot: WidgetSnapshot?, now: Date) -> [HijriEntry] {
        guard let snapshot else { return [HijriEntry(date: now, hijri: nil)] }
        if snapshot.placeUnset { return [HijriEntry(date: now, hijri: nil, placeUnset: true)] }
        let days = snapshot.prayerDays ?? []
        let zone = WidgetCalendar.zone(snapshot.tz)
        let moments = [now] + WidgetCalendar.midnights(after: now, count: days.count, in: zone)
        return moments.map { date in
            let today = WidgetCalendar.dayString(date, in: zone)
            return HijriEntry(date: date, hijri: days.first { $0.date == today }?.hijri)
        }
    }
}

struct HijriProvider: TimelineProvider {
    func placeholder(in context: Context) -> HijriEntry {
        HijriEntry(date: Date(), hijri: nil)
    }

    func getSnapshot(in context: Context, completion: @escaping (HijriEntry) -> Void) {
        completion(HijriTimeline.entries(from: SharedStore.snapshot(), now: Date()).first ?? placeholder(in: context))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<HijriEntry>) -> Void) {
        let entries = HijriTimeline.entries(from: SharedStore.snapshot(), now: Date())
        completion(Timeline(entries: entries, policy: entries.count > 1 ? .atEnd : .never))
    }
}

struct HijriWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: WidgetKinds.hijri, provider: HijriProvider()) { entry in
            HijriView(entry: entry)
        }
        .configurationDisplayName("Hijri date")
        .description("Today's Hijri date, by calculation.")
        .supportedFamilies([.accessoryCircular, .accessoryInline])
    }
}

struct HijriView: View {
    let entry: HijriEntry
    @Environment(\.widgetFamily) private var family

    var body: some View {
        content
            .widgetURL(entry.hijri == nil ? WidgetLinks.home : WidgetLinks.faith)
            .containerBackground(for: .widget) { Color.clear }
    }

    @ViewBuilder
    private var content: some View {
        switch (family, entry.hijri) {
        case (.accessoryInline, let hijri?):
            Text(verbatim: hijri.text)
        case (.accessoryInline, nil):
            Text(calmText)
        case (_, let hijri?):
            ZStack {
                AccessoryWidgetBackground()
                VStack(spacing: 0) {
                    Text(verbatim: "\(hijri.day)")
                        .font(.system(size: 22, weight: .semibold))
                        .widgetAccentable()
                    Text(verbatim: hijri.month)
                        .font(.system(size: 9, weight: .medium))
                        .multilineTextAlignment(.center)
                        .lineLimit(2)
                }
                .minimumScaleFactor(0.6)
                .padding(.horizontal, 4)
                .accessibilityElement(children: .combine)
            }
        case (_, nil):
            ZStack {
                AccessoryWidgetBackground()
                Calm(text: calmText, font: .system(size: 10, weight: .medium), alignment: .center)
                    .padding(.horizontal, 4)
            }
        }
    }

    private var calmText: LocalizedStringKey {
        entry.placeUnset ? "Set your place" : "Open the app once"
    }
}
