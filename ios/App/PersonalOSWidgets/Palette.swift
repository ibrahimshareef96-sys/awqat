import SwiftUI

/// The surfaces' look, from docs/live-surfaces.md: dark base, ivory text, champagne the one accent. No gradients.
enum Palette {
    static let base = Color(red: 14 / 255, green: 14 / 255, blue: 19 / 255)
    static let ivory = Color(red: 236 / 255, green: 230 / 255, blue: 216 / 255)
    static let softIvory = ivory.opacity(0.62)
    static let champagne = Color(red: 226 / 255, green: 204 / 255, blue: 154 / 255)

    /// The app's own serif, bundled in the extension so a prayer's name reads as it does in the app.
    static func serif(_ size: CGFloat) -> Font {
        .custom("InstrumentSerif-Regular", size: size)
    }

    static func clock(_ size: CGFloat, weight: Font.Weight = .regular) -> Font {
        .system(size: size, weight: weight).monospacedDigit()
    }
}

/// A short line in spaced capitals, as the app sets its labels.
struct CapsLabel: View {
    let text: String
    var color = Palette.softIvory

    var body: some View {
        Text(verbatim: text)
            .font(.system(size: 11, weight: .medium))
            .textCase(.uppercase)
            .tracking(1.4)
            .foregroundStyle(color)
            .lineLimit(1)
    }
}

/// A count as a ring. Drawn, not a Gauge, so it looks the same in the island as anywhere else.
struct Ring: View {
    let fraction: Double
    var lineWidth: CGFloat = 2.5

    var body: some View {
        ZStack {
            Circle().stroke(Palette.champagne.opacity(0.25), lineWidth: lineWidth)
            Circle()
                .trim(from: 0, to: max(0, min(1, fraction)))
                .stroke(Palette.champagne, style: StrokeStyle(lineWidth: lineWidth, lineCap: .round))
                .rotationEffect(.degrees(-90))
        }
    }
}

/// The + itself: a champagne disc, big enough to hit without looking.
struct PlusDisc: View {
    let diameter: CGFloat

    var body: some View {
        ZStack {
            Circle().fill(Palette.champagne)
            Image(systemName: "plus")
                .font(.system(size: diameter * 0.42, weight: .medium))
                .foregroundStyle(Palette.base)
        }
        .frame(width: diameter, height: diameter)
    }
}
