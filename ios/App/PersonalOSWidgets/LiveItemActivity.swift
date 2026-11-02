import ActivityKit
import SwiftUI
import WidgetKit

/// Every presentation of a Live Activity. Compact and minimal only open the app (Apple's rule); the + lives on the Lock
/// Screen and in the expanded island.
struct LiveItemActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: LiveItemAttributes.self) { context in
            let item = LiveItemModel(id: context.attributes.id, state: context.state, isStale: context.isStale)
            LockScreenLive(item: item)
                .activityBackgroundTint(Palette.base)
                .activitySystemActionForegroundColor(Palette.ivory)
                .widgetURL(item.url)
        } dynamicIsland: { context in
            let item = LiveItemModel(id: context.attributes.id, state: context.state, isStale: context.isStale)
            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading, priority: 1) {
                    ExpandedLeading(item: item)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    ExpandedTrailing(item: item)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    ExpandedBottom(item: item)
                }
            } compactLeading: {
                LimitedWidthAware {
                    MinimalLive(item: item)
                } full: {
                    CompactLeading(item: item)
                }
            } compactTrailing: {
                // In limited width Apple suggests one view on the leading side and an empty trailing one, which the
                // system hides, rather than a truncated pair.
                LimitedWidthAware {
                    EmptyView()
                } full: {
                    CompactTrailing(item: item)
                }
            } minimal: {
                MinimalLive(item: item)
            }
            .widgetURL(item.url)
            .keylineTint(Palette.champagne)
        }
    }
}

/// What a presentation needs to know, worked out once.
struct LiveItemModel {
    enum Kind {
        case next, dhikr, timer
    }

    let kind: Kind
    let state: LiveItemAttributes.ContentState
    let isStale: Bool

    init(id: String, state: LiveItemAttributes.ContentState, isStale: Bool) {
        kind = id == "dhikr" ? .dhikr : id == "timer" ? .timer : .next
        self.state = state
        self.isStale = isStale
    }

    var url: URL? { URL(string: state.link) }

    var clockColor: Color { isStale ? Palette.softIvory : Palette.ivory }

    /// How far along the count is, when there is a count.
    var fraction: Double? {
        guard let count = state.count, let of = state.of, of > 0 else { return nil }
        return Double(count) / Double(of)
    }

    /// A key and room left: only then is there anything for a + to do.
    var plusKey: String? {
        state.isFull ? nil : state.key
    }
}

/// Reads `isDynamicIslandLimitedInWidth`, which exists only from iOS 27. Before that the system uses the minimal
/// presentation instead, so `full` is right there.
private struct LimitedWidthAware<Limited: View, Full: View>: View {
    @ViewBuilder let limited: () -> Limited
    @ViewBuilder let full: () -> Full

    var body: some View {
        if #available(iOS 27.0, *) {
            LimitedWidthReader(limited: limited, full: full)
        } else {
            full()
        }
    }
}

@available(iOS 27.0, *)
private struct LimitedWidthReader<Limited: View, Full: View>: View {
    @Environment(\.isDynamicIslandLimitedInWidth) private var isLimited
    let limited: () -> Limited
    let full: () -> Full

    var body: some View {
        if isLimited {
            limited()
        } else {
            full()
        }
    }
}
