import SwiftUI
import WidgetKit

/// One moment of the agenda widget. A meeting's title is private: this widget is home screen only (systemMedium),
/// never a Lock Screen accessory, and the title is marked privacy sensitive besides.
struct AgendaEntry: TimelineEntry {
    struct Next {
        let when: String
        let title: String
        let before: String?
        let after: String?
        let placeUnset: Bool
    }

    enum Content {
        case calm(LocalizedStringKey, URL?)
        case meeting(Next)
    }

    let date: Date
    let content: Content
}

/// As Android's AgendaData: the meeting on now or the next to begin, named "Now", "Today" or "Tomorrow".
enum AgendaTimeline {
    private static let entriesMax = 40

    static func entries(from snapshot: WidgetSnapshot?, now: Date) -> [AgendaEntry] {
        guard let snapshot, let calendar = snapshot.calendar else {
            return [AgendaEntry(date: now, content: .calm("Open the app once", WidgetLinks.home))]
        }
        guard calendar else { return [AgendaEntry(date: now, content: .calm("Connect a calendar", WidgetLinks.agenda))] }
        let meetings = snapshot.meetings ?? []
        let zone = WidgetCalendar.zone(snapshot.tz)
        let changes = meetings.flatMap { [$0.startDate, $0.endDate] } + WidgetCalendar.midnights(after: now, count: 2, in: zone)
        return WidgetCalendar.moments(changes, from: now, limit: entriesMax).map { date in
            AgendaEntry(date: date, content: content(meetings, at: date, zone: zone, placeUnset: snapshot.placeUnset))
        }
    }

    private static func content(_ meetings: [WidgetSnapshot.Meeting], at date: Date, zone: TimeZone,
                                placeUnset: Bool) -> AgendaEntry.Content {
        guard let next = meetings.filter({ $0.endDate > date }).min(by: { $0.start < $1.start }) else {
            return .calm("No meetings today or tomorrow", WidgetLinks.agenda)
        }
        return .meeting(.init(when: when(next, at: date, zone: zone), title: String(next.title.prefix(60)),
                              before: next.before?.nonEmpty, after: next.after?.nonEmpty, placeUnset: placeUnset))
    }

    private static func when(_ meeting: WidgetSnapshot.Meeting, at date: Date, zone: TimeZone) -> String {
        if meeting.startDate <= date && date < meeting.endDate { return "Now" }
        let today = WidgetCalendar.dayString(date, in: zone)
        let tomorrow = WidgetCalendar.midnights(after: date, count: 1, in: zone).first
            .map { WidgetCalendar.dayString($0, in: zone) }
        if meeting.date == today { return "Today \(meeting.time)" }
        if meeting.date == tomorrow { return "Tomorrow \(meeting.time)" }
        return meeting.time
    }
}

struct AgendaProvider: TimelineProvider {
    func placeholder(in context: Context) -> AgendaEntry {
        AgendaEntry(date: Date(), content: .calm("Open the app once", WidgetLinks.home))
    }

    func getSnapshot(in context: Context, completion: @escaping (AgendaEntry) -> Void) {
        completion(AgendaTimeline.entries(from: SharedStore.snapshot(), now: Date()).first ?? placeholder(in: context))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<AgendaEntry>) -> Void) {
        let entries = AgendaTimeline.entries(from: SharedStore.snapshot(), now: Date())
        completion(Timeline(entries: entries, policy: entries.count > 1 ? .atEnd : .never))
    }
}

struct AgendaWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: WidgetKinds.agenda, provider: AgendaProvider()) { entry in
            AgendaView(entry: entry)
        }
        .configurationDisplayName("Next meeting")
        .description("Your next meeting today or tomorrow, with the prayers around it.")
        .supportedFamilies([.systemMedium])
    }
}

struct AgendaView: View {
    let entry: AgendaEntry

    var body: some View {
        content
            .containerBackground(for: .widget) { Palette.base }
    }

    @ViewBuilder
    private var content: some View {
        switch entry.content {
        case let .calm(text, link):
            VStack(alignment: .leading, spacing: 6) {
                CapsLabel(text: "Next meeting")
                Calm(text: text, font: Palette.serif(24, relativeTo: .title2), alignment: .leading)
                    .foregroundStyle(Palette.ivory)
                    .lineLimit(2)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .widgetURL(link)
        case let .meeting(next):
            meeting(next)
                .widgetURL(WidgetLinks.agenda)
        }
    }

    private func meeting(_ next: AgendaEntry.Next) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline) {
                CapsLabel(text: "Next meeting")
                Spacer(minLength: 6)
                Text(verbatim: next.when)
                    .font(Palette.digits(.subheadline))
                    .foregroundStyle(Palette.champagne)
                    .lineLimit(1)
            }
            Text(verbatim: next.title)
                .font(Palette.serif(24, relativeTo: .title2))
                .foregroundStyle(Palette.ivory)
                .lineLimit(2)
                .minimumScaleFactor(0.7)
                .privacySensitive()
            Spacer(minLength: 0)
            Rectangle()
                .fill(Palette.ivory.opacity(0.14))
                .frame(height: 0.5)
            if next.placeUnset {
                Text("Set your place")
                    .font(Palette.text(.footnote))
                    .foregroundStyle(Palette.softIvory)
            } else if next.before != nil || next.after != nil {
                HStack(alignment: .top, spacing: 12) {
                    around("Before", next.before)
                    around("After", next.after)
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private func around(_ label: String, _ prayer: String?) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            CapsLabel(text: label)
            Text(verbatim: prayer ?? "")
                .font(Palette.text(.footnote))
                .foregroundStyle(Palette.ivory)
        }
        .lineLimit(1)
        .minimumScaleFactor(0.7)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
