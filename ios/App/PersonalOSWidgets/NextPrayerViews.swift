import SwiftUI
import WidgetKit

private typealias Links = WidgetLinks

struct NextPrayerView: View {
    let entry: NextPrayerEntry
    @Environment(\.widgetFamily) private var family

    var body: some View {
        content
            .widgetURL(entry.prayer == nil ? Links.home : Links.faith)
            .containerBackground(for: .widget) {
                isAccessory ? Color.clear : Palette.base
            }
    }

    private var isAccessory: Bool {
        family == .accessoryCircular || family == .accessoryRectangular || family == .accessoryInline
    }

    @ViewBuilder
    private var content: some View {
        switch (family, entry.prayer) {
        case (.accessoryInline, let prayer?):
            // "Asr 15:21": the system draws an inline line in its own font, one line, no colours.
            Text(verbatim: "\(prayer.name) \(prayer.time)")
        case (.accessoryInline, nil):
            Text(calmText)
        case (.accessoryCircular, let prayer?):
            CircularPrayer(prayer: prayer, from: entry.date)
        case (.accessoryCircular, nil):
            Calm(text: calmText, font: .system(size: 11, weight: .medium), alignment: .center)
        case (.accessoryRectangular, let prayer?):
            RectangularPrayer(prayer: prayer, from: entry.date)
        case (.accessoryRectangular, nil):
            Calm(text: calmText, font: .system(size: 15, weight: .medium), alignment: .leading)
        case (.systemMedium, let prayer?):
            MediumPrayer(prayer: prayer, entry: entry)
        case (_, let prayer?):
            PrayerColumn(prayer: prayer, from: entry.date)
        case (_, nil):
            Calm(text: calmText, font: Palette.serif(24), alignment: .leading)
                .foregroundStyle(Palette.ivory)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
    }

    /// A guessed place's times are Makkah's, so none of them is shown until the place is set.
    private var calmText: LocalizedStringKey {
        entry.placeUnset ? "Set your place" : "Open the app once"
    }
}

/// The calm state: nothing to show yet, and nothing wrong.
struct Calm: View {
    let text: LocalizedStringKey
    let font: Font
    let alignment: TextAlignment

    var body: some View {
        Text(text)
            .font(font)
            .multilineTextAlignment(alignment)
            .minimumScaleFactor(0.7)
    }
}

/// The small widget, and the left of the medium one.
private struct PrayerColumn: View {
    let prayer: WidgetSnapshot.Prayer
    let from: Date

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            CapsLabel(text: "Next prayer")
            Text(verbatim: prayer.name)
                .font(Palette.serif(32))
                .foregroundStyle(Palette.ivory)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
            Text(verbatim: prayer.time)
                .font(Palette.clock(14))
                .foregroundStyle(Palette.softIvory)
            Spacer(minLength: 4)
            SystemClock.down(to: prayer.date, from: from, font: Palette.clock(26, weight: .light), color: Palette.champagne,
                             alignment: .leading)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    }
}

private struct MediumPrayer: View {
    let prayer: WidgetSnapshot.Prayer
    let entry: NextPrayerEntry

    var body: some View {
        HStack(spacing: 16) {
            PrayerColumn(prayer: prayer, from: entry.date)
            Rectangle()
                .fill(Palette.ivory.opacity(0.14))
                .frame(width: 0.5)
            VStack(alignment: .leading, spacing: 10) {
                if let quran = entry.quran {
                    line(quran, destination: Links.mushaf)
                }
                if let revise = entry.revise {
                    line(revise, destination: Links.revise)
                }
                if let steps = entry.steps {
                    // Steps open nothing of their own: a tap there follows the widget's link.
                    Text(verbatim: steps)
                        .font(.system(size: 13))
                        .foregroundStyle(Palette.softIvory)
                        .lineLimit(2)
                        .minimumScaleFactor(0.8)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    @ViewBuilder
    private func line(_ text: String, destination: URL?) -> some View {
        if let destination {
            Link(destination: destination) {
                Text(verbatim: text)
                    .font(.system(size: 14))
                    .foregroundStyle(Palette.ivory)
                    .lineLimit(2)
                    .minimumScaleFactor(0.8)
            }
        }
    }
}

private struct CircularPrayer: View {
    let prayer: WidgetSnapshot.Prayer
    let from: Date

    var body: some View {
        ZStack {
            AccessoryWidgetBackground()
            VStack(spacing: 0) {
                Text(verbatim: prayer.name)
                    .font(.system(size: 11, weight: .semibold))
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                    .widgetAccentable()
                SystemClock.down(to: prayer.date, from: from, font: Palette.clock(11, weight: .medium), color: .primary,
                                 alignment: .center)
                    .minimumScaleFactor(0.7)
            }
            .padding(.horizontal, 3)
        }
    }
}

private struct RectangularPrayer: View {
    let prayer: WidgetSnapshot.Prayer
    let from: Date

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 6) {
                Text(verbatim: prayer.name)
                    .font(.system(size: 15, weight: .semibold))
                    .lineLimit(1)
                    .widgetAccentable()
                Text(verbatim: prayer.time)
                    .font(Palette.clock(15))
                    .foregroundStyle(.secondary)
            }
            SystemClock.down(to: prayer.date, from: from, font: Palette.clock(24, weight: .medium), color: .primary,
                             alignment: .leading)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
