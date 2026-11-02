import SwiftUI
import WidgetKit

/// The prayer day widget's choices, as Android's PrayerDayData makes them: the day under way, its prayer under way,
/// the next prayer, and whose iqama to show. It only picks from the lists the app gave.
enum PrayerDayPick {
    typealias Day = WidgetSnapshot.PrayerDay
    typealias Prayer = WidgetSnapshot.PrayerDay.Prayer

    /// The last day whose first prayer has come, else the first.
    static func day(_ days: [Day], at now: Date) -> Day? {
        days.last { ($0.prayers.first?.date ?? .distantFuture) <= now } ?? days.first
    }

    /// The prayer whose time has come and is not over yet; none between sunrise and Dhuhr.
    static func current(_ day: Day, at now: Date) -> Int? {
        day.prayers.lastIndex { $0.date <= now && ($0.end.map { now < $0 } ?? true) }
    }

    static func next(_ days: [Day], at now: Date) -> Prayer? {
        days.flatMap(\.prayers).filter { $0.date > now }.min { $0.at < $1.at }
    }

    /// The prayer under way's iqama while it is still ahead, else the next prayer's (Jumu'ah has none).
    static func iqama(_ day: Day, current: Int?, next: Prayer?, at now: Date) -> Prayer? {
        if let current, let at = day.prayers[current].iqamaDate, at > now { return day.prayers[current] }
        if let next, let at = next.iqamaDate, at > now { return next }
        return nil
    }

    /// Every moment the widget changes: each prayer, the end of its time, and each iqama.
    static func changes(_ days: [Day]) -> [Date] {
        days.flatMap(\.prayers).flatMap { [$0.date, $0.end, $0.iqamaDate].compactMap { $0 } }
    }
}

struct PrayerDayEntry: TimelineEntry {
    struct Model {
        let hijri: String?
        let prayers: [WidgetSnapshot.PrayerDay.Prayer]
        let current: Int?
        let next: WidgetSnapshot.PrayerDay.Prayer
        let iqama: WidgetSnapshot.PrayerDay.Prayer?
    }

    enum State {
        case calm(LocalizedStringKey)
        case day(Model)
    }

    let date: Date
    let state: State
}

enum PrayerDayTimeline {
    /// Some four days of changes (about 14 a day); when they run out WidgetKit asks again.
    private static let entriesMax = 60

    static func entries(from snapshot: WidgetSnapshot?, now: Date) -> [PrayerDayEntry] {
        guard let snapshot else { return [PrayerDayEntry(date: now, state: .calm("Open the app once"))] }
        // A guessed place's times are Makkah's: none of them is shown.
        if snapshot.placeUnset { return [PrayerDayEntry(date: now, state: .calm("Set your place"))] }
        let days = snapshot.prayerDays ?? []
        return WidgetCalendar.moments(PrayerDayPick.changes(days), from: now, limit: entriesMax)
            .map { PrayerDayEntry(date: $0, state: state(days, at: $0)) }
    }

    private static func state(_ days: [WidgetSnapshot.PrayerDay], at date: Date) -> PrayerDayEntry.State {
        guard let day = PrayerDayPick.day(days, at: date), let next = PrayerDayPick.next(days, at: date) else {
            return .calm("Open the app once")
        }
        let current = PrayerDayPick.current(day, at: date)
        return .day(.init(hijri: day.hijri?.text, prayers: Array(day.prayers.prefix(5)), current: current, next: next,
                          iqama: PrayerDayPick.iqama(day, current: current, next: next, at: date)))
    }
}

struct PrayerDayProvider: TimelineProvider {
    func placeholder(in context: Context) -> PrayerDayEntry {
        PrayerDayEntry(date: Date(), state: .calm("Open the app once"))
    }

    func getSnapshot(in context: Context, completion: @escaping (PrayerDayEntry) -> Void) {
        completion(PrayerDayTimeline.entries(from: SharedStore.snapshot(), now: Date()).first ?? placeholder(in: context))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<PrayerDayEntry>) -> Void) {
        let entries = PrayerDayTimeline.entries(from: SharedStore.snapshot(), now: Date())
        // Calm throughout: it waits for the app's next snapshot, which reloads it.
        let showsDay = entries.contains { if case .day = $0.state { return true } else { return false } }
        completion(Timeline(entries: entries, policy: showsDay ? .atEnd : .never))
    }
}

struct PrayerDayWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: WidgetKinds.prayerDay, provider: PrayerDayProvider()) { entry in
            PrayerDayView(entry: entry)
        }
        .configurationDisplayName("Prayer day")
        .description("Today's five prayers, the Hijri date, and the next prayer counting down.")
        .supportedFamilies([.systemMedium])
    }
}

struct PrayerDayView: View {
    let entry: PrayerDayEntry

    var body: some View {
        content
            .containerBackground(for: .widget) { Palette.base }
    }

    @ViewBuilder
    private var content: some View {
        switch entry.state {
        case let .calm(text):
            Calm(text: text, font: Palette.serif(24), alignment: .leading)
                .foregroundStyle(Palette.ivory)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                .widgetURL(WidgetLinks.home)
        case let .day(model):
            day(model)
                .widgetURL(WidgetLinks.faith)
        }
    }

    private func day(_ model: PrayerDayEntry.Model) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            CapsLabel(text: model.hijri ?? "Today")
            HStack(spacing: 4) {
                ForEach(Array(model.prayers.enumerated()), id: \.offset) { index, prayer in
                    PrayerCell(prayer: prayer, marked: index == model.current)
                }
            }
            Spacer(minLength: 0)
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                if let iqama = model.iqama, let time = iqama.iqamaTime {
                    Text(verbatim: "\(iqama.name) iqama \(time)")
                        .font(Palette.text(.footnote))
                        .foregroundStyle(Palette.softIvory)
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                }
                Spacer(minLength: 4)
                Text(verbatim: "\(model.next.name) in")
                    .font(Palette.text(.footnote))
                    .foregroundStyle(Palette.softIvory)
                    .lineLimit(1)
                SystemClock.down(to: model.next.date, from: entry.date, font: Palette.digits(.subheadline),
                                 color: Palette.champagne)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

/// One prayer: its name above its time, in the accent when it is under way.
private struct PrayerCell: View {
    let prayer: WidgetSnapshot.PrayerDay.Prayer
    let marked: Bool

    var body: some View {
        VStack(spacing: 2) {
            Text(verbatim: prayer.name)
                .font(Palette.text(.caption2, weight: marked ? .semibold : .regular))
                .foregroundStyle(marked ? Palette.champagne : Palette.softIvory)
            Text(verbatim: prayer.time)
                .font(Palette.serif(22, relativeTo: .title3))
                .foregroundStyle(marked ? Palette.champagne : Palette.ivory)
        }
        .lineLimit(1)
        .minimumScaleFactor(0.5)
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(marked ? .isSelected : [])
    }
}
