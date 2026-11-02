import SwiftUI
import WidgetKit

// MARK: - Pieces

/// The item's clock if it has one: `endsAt` counts down and wins, `startedAt` counts up.
private struct LiveClock: View {
    let state: LiveItemAttributes.ContentState
    let font: Font
    var color = Palette.ivory

    var body: some View {
        if let end = state.endsAt {
            SystemClock.down(to: end, font: font, color: color)
        } else if let start = state.startedAt {
            SystemClock.up(from: start, font: font, color: color)
        }
    }
}

/// The count as digits. It moves with the system's own digit roll unless the user has asked for less motion.
private struct CountDigits: View {
    let count: Int
    let font: Font
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        Text(verbatim: "\(count)")
            .font(font)
            .foregroundStyle(Palette.ivory)
            .lineLimit(1)
            .minimumScaleFactor(0.6)
            .contentTransition(reduceMotion ? .identity : .numericText(value: Double(count)))
    }
}

/// "12" large, "of 100" small beside it.
private struct CountOfLine: View {
    let state: LiveItemAttributes.ContentState
    let size: CGFloat

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            CountDigits(count: state.count ?? 0, font: Palette.serif(size))
            if let of = state.of {
                Text(verbatim: "of \(of)")
                    .font(Palette.clock(13))
                    .foregroundStyle(Palette.softIvory)
                    .lineLimit(1)
            }
        }
    }
}

private struct TitleAndDetail: View {
    let state: LiveItemAttributes.ContentState
    let size: CGFloat

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(verbatim: state.title)
                .font(Palette.serif(size))
                .foregroundStyle(Palette.ivory)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
            CapsLabel(text: state.detail, color: Palette.champagne)
        }
    }
}

private struct HairlineProgress: View {
    let fraction: Double

    var body: some View {
        ProgressView(value: max(0, min(1, fraction)))
            .progressViewStyle(.linear)
            .tint(Palette.champagne)
    }
}

// MARK: - Lock Screen

struct LockScreenLive: View {
    let item: LiveItemModel

    var body: some View {
        Group {
            if item.kind == .dhikr {
                dhikr
            } else {
                HStack(alignment: .center, spacing: 12) {
                    TitleAndDetail(state: item.state, size: 32)
                    Spacer(minLength: 8)
                    LiveClock(state: item.state, font: Palette.clock(40, weight: .thin), color: item.clockColor)
                }
            }
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 18)
    }

    private var dhikr: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .center, spacing: 12) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(verbatim: item.state.title)
                        .font(.system(size: 14))
                        .foregroundStyle(Palette.softIvory)
                        .lineLimit(2)
                    CountOfLine(state: item.state, size: 46)
                }
                Spacer(minLength: 8)
                if let key = item.plusKey {
                    Button(intent: CountDhikrLiveIntent(key: key)) {
                        PlusDisc(diameter: 58)
                    }
                    .buttonStyle(.plain)
                }
            }
            if let fraction = item.fraction {
                HairlineProgress(fraction: fraction)
            }
        }
    }
}

// MARK: - Expanded island

struct ExpandedLeading: View {
    let item: LiveItemModel

    var body: some View {
        Group {
            if item.kind == .dhikr {
                CountOfLine(state: item.state, size: 42)
            } else {
                TitleAndDetail(state: item.state, size: 28)
            }
        }
        .padding(.leading, 8)
        .frame(maxHeight: .infinity, alignment: .center)
    }
}

struct ExpandedTrailing: View {
    let item: LiveItemModel

    var body: some View {
        Group {
            if item.kind == .dhikr {
                if let key = item.plusKey {
                    Button(intent: CountDhikrLiveIntent(key: key)) {
                        PlusDisc(diameter: 54)
                    }
                    .buttonStyle(.plain)
                }
            } else {
                LiveClock(state: item.state, font: Palette.clock(32, weight: .thin), color: item.clockColor)
            }
        }
        .padding(.trailing, 8)
        .frame(maxHeight: .infinity, alignment: .center)
    }
}

struct ExpandedBottom: View {
    let item: LiveItemModel

    var body: some View {
        if item.kind == .dhikr {
            VStack(alignment: .leading, spacing: 8) {
                Text(verbatim: item.state.title)
                    .font(.system(size: 13))
                    .foregroundStyle(Palette.softIvory)
                    .lineLimit(1)
                if let fraction = item.fraction {
                    HairlineProgress(fraction: fraction)
                }
            }
            .padding(.horizontal, 8)
        }
    }
}

// MARK: - Compact and minimal island

struct CompactLeading: View {
    let item: LiveItemModel

    var body: some View {
        switch item.kind {
        case .next:
            // A prayer's name is short by nature, and it is the point of the glance.
            Text(verbatim: item.state.title)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(Palette.champagne)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
                .frame(maxWidth: 62, alignment: .leading)
                .padding(.leading, 2)
        case .dhikr:
            Ring(fraction: item.fraction ?? 0, lineWidth: 3)
                .frame(width: 18, height: 18)
                .padding(.leading, 2)
        case .timer:
            Image(systemName: "timer")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(Palette.champagne)
                .padding(.leading, 2)
        }
    }
}

struct CompactTrailing: View {
    let item: LiveItemModel

    var body: some View {
        Group {
            if item.kind == .dhikr {
                CountDigits(count: item.state.count ?? 0, font: Palette.clock(15, weight: .medium))
            } else {
                LiveClock(state: item.state, font: Palette.clock(14, weight: .medium), color: item.clockColor)
            }
        }
        .padding(.trailing, 2)
    }
}

/// Also the limited-width compact view, where Apple asks for something that fits a 28-point circle.
struct MinimalLive: View {
    let item: LiveItemModel

    var body: some View {
        switch item.kind {
        case .next:
            countdownRing
        case .dhikr:
            ZStack {
                Ring(fraction: item.fraction ?? 0, lineWidth: 2.5)
                CountDigits(count: item.state.count ?? 0, font: Palette.clock(10, weight: .semibold))
                    .padding(3)
            }
            .frame(width: 26, height: 26)
        case .timer:
            Image(systemName: "timer")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(Palette.champagne)
        }
    }

    /// No clock fits here: a system ring running down to the time, around the prayer's first letter.
    @ViewBuilder
    private var countdownRing: some View {
        ZStack {
            if let end = item.state.endsAt {
                let start = min(item.state.countdownFrom ?? Date(), end)
                ProgressView(timerInterval: start...end, countsDown: true, label: { EmptyView() },
                             currentValueLabel: { EmptyView() })
                    .progressViewStyle(.circular)
                    .tint(Palette.champagne)
            }
            Text(verbatim: String(item.state.title.prefix(1)))
                .font(Palette.serif(14))
                .foregroundStyle(Palette.ivory)
        }
        .frame(width: 26, height: 26)
    }
}
