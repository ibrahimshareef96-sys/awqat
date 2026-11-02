# Contributing

Thank you for helping. A few rules keep Awqat what it is.

## The rules

- **No Quran text typed, generated or bundled.** The mushaf is drawn only from the verified page fonts; a dhikr that is
  an ayah opens its page. Du'a and adhkar text comes from the generator scripts in `scripts/`, never typed by hand.
- **Nothing leaves the phone unless the user set it up.** No analytics, no new third-party calls without a reason in
  the pull request and a line in the README's Privacy section.
- **No personal data in tests or comments.** Use fictional names, `example.com`, and round amounts.
- **Licences first.** Do not add a font, image, audio file or dataset unless its licence allows redistribution, and
  add it to THIRD_PARTY_NOTICES.md. Adhan recordings stay out of the repository (docs/adhan.md).
- **Motion is optional.** Honour `prefers-reduced-motion`, and on iOS `accessibilityReduceMotion`.

## Publishing your own build

Change the app id `app.awqat` everywhere it is written, or parts stop working quietly:

- `capacitor.config.ts` (`appId`), `android/app/build.gradle` (`namespace`, `applicationId`) and the Java package
  folder `android/app/src/main/java/app/awqat` with its `package` lines and `proguard-rules.pro`.
- `android/app/src/main/res/values/strings.xml` (`package_name`, `custom_url_scheme`).
- `android/app/src/main/res/xml/shortcuts.xml` (`targetPackage`, and `targetClass` if the Java package moves), or the
  icon's long-press shortcuts open nothing.
- `src/books/coverFiles.ts` (`OWN_FOLDER`), or the camera's temporary photos are never cleared on Android.
- In Xcode: both targets' bundle ids, your team, and the App Group `group.app.awqat` in both `.entitlements` files and
  `ios/App/PersonalOSWidgets/Shared/SharedStore.swift`.

The `awqat://` link scheme can stay as it is.

## Before you open a pull request

```bash
npm ci
npm run typecheck
npm test
```

Every change comes with tests; the suite runs on the `Asia/Dubai` clock so the expected prayer times hold anywhere.
Keep pull requests small and say what you checked on a real device, if anything.
