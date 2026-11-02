import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  /** Change this to your own reverse-domain id before you publish a build (android/app/build.gradle and Xcode too). */
  appId: "app.awqat",
  appName: "Awqat",
  webDir: "dist",
  /** The WebView's own colour before the page paints: Itqan's ink, never a white flash. */
  backgroundColor: "#0B0A0D",
  /** Never log plugin calls, even in a debug build: they carry calendar addresses and session tokens. */
  loggingBehavior: "none",
  android: { allowMixedContent: false, webContentsDebuggingEnabled: false },
  plugins: {
    SystemBars: { insetsHandling: "css", initialViewportFitValueHint: "cover", style: "DARK" },
    LocalNotifications: { smallIcon: "ic_stat_orb", iconColor: "#F7F5F0" },
  },
};

export default config;
