import SwiftUI
import WidgetKit

@main
struct PersonalOSWidgetsBundle: WidgetBundle {
    var body: some Widget {
        NextPrayerWidget()
        PrayerDayWidget()
        QuranWidget()
        AdhkarWidget()
        AgendaWidget()
        HijriWidget()
        DhikrWidget()
        LiveItemActivity()
        // The Talk control needs iOS 18; the widgets above run from 17.
        if #available(iOS 18.0, *) {
            TalkControl()
        }
    }
}
