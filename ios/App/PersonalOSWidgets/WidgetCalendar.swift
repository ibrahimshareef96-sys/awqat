import Foundation

/// Days and midnights on the clock of the place the snapshot was made for, shared by the widgets whose lines move on
/// at midnight. Native holds no prayer logic: these only say which day it is.
enum WidgetCalendar {
    /// Bounded by what the snapshot can hold, so a corrupt far-off time cannot keep the extension here.
    static let daysMax = 16

    static func zone(_ tz: String?) -> TimeZone {
        tz.flatMap { TimeZone(identifier: $0) } ?? .current
    }

    /// YYYY-MM-DD, as the app writes its dates.
    static func dayString(_ date: Date, in zone: TimeZone) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.timeZone = zone
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: date)
    }

    /// The next `count` midnights after `now`, at most daysMax.
    static func midnights(after now: Date, count: Int, in zone: TimeZone) -> [Date] {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = zone
        let today = calendar.startOfDay(for: now)
        let days = max(0, min(count, daysMax))
        guard days > 0 else { return [] }
        return (1...days).compactMap { calendar.date(byAdding: .day, value: $0, to: today) }
    }

    /// Each moment once, in order, from `now` on; at most `limit` of them.
    static func moments(_ dates: [Date], from now: Date, limit: Int) -> [Date] {
        Array(Set([now] + dates.filter { $0 > now }).sorted().prefix(limit))
    }
}
