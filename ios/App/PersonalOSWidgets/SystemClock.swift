import SwiftUI

/// A system-drawn timer in a fixed width. Apple archives a widget or Live Activity view and cannot lay it out again, so
/// `Text(timerInterval:)` claims all the width it can; an invisible string of the widest digits sets the width instead.
struct SystemClock: View {
    let range: ClosedRange<Date>
    let countsDown: Bool
    let font: Font
    var color = Palette.ivory
    var alignment: Alignment = .trailing

    var body: some View {
        Text(verbatim: widest)
            .font(font)
            .hidden()
            .overlay(alignment: alignment) {
                Text(timerInterval: range, countsDown: countsDown)
                    .font(font)
                    .foregroundStyle(color)
                    .multilineTextAlignment(alignment == .leading ? .leading : .trailing)
                    .lineLimit(1)
            }
    }

    /// A count up can pass an hour with nobody there to lay it out again, so it always leaves room for the hours, and
    /// for two digits of them if the eight hours an activity can last would reach ten.
    private var widest: String {
        guard countsDown else {
            return -range.lowerBound.timeIntervalSinceNow + Self.longestLive >= 36_000 ? "00:00:00" : "0:00:00"
        }
        let left = range.upperBound.timeIntervalSinceNow
        if left >= 36_000 { return "00:00:00" }
        return left >= 3_600 ? "0:00:00" : "00:00"
    }

    /// Counting down to `end`. The range can never be upside down: a time already past stays at zero.
    static func down(to end: Date, from start: Date = Date(), font: Font, color: Color = Palette.ivory,
                     alignment: Alignment = .trailing) -> SystemClock {
        SystemClock(range: min(start, end)...end, countsDown: true, font: font, color: color, alignment: alignment)
    }

    /// Counting up from `start`, past the longest a Live Activity can stay on screen, however long ago it began.
    static func up(from start: Date, font: Font, color: Color = Palette.ivory, alignment: Alignment = .trailing) -> SystemClock {
        let end = max(start, Date()).addingTimeInterval(longestLive + 3_600)
        return SystemClock(range: start...end, countsDown: false, font: font, color: color, alignment: alignment)
    }

    /// Apple's eight hours.
    private static let longestLive: TimeInterval = 8 * 3_600
}
