# Lucerna

A SvelteKit app wrapped with Capacitor for iOS and Android deployment.

## Development

### Prerequisites

- Node.js (v16 or higher)
- bun

### Local Development

Start the development server:

```sh
npm run dev
# or
bun run dev
```

## Building for Mobile

This project uses Capacitor to build native mobile apps for iOS and Android.

### Prerequisites for Mobile Development

#### For Android Development (Windows/Mac):
- **Java Development Kit (JDK)**: JDK 11 or higher
- **Android Studio**: Latest stable version
- **Android SDK**: API level 22 or higher

#### For iOS Development (Mac only):
- **macOS**: 10.15 or higher
- **Xcode**: Latest stable version (requires macOS)
- **iOS Simulator** or physical iOS device

### Mobile Build Commands

```sh
# Build and sync all platforms
npm run build:sync

# Build and sync only iOS
npm run build:sync:ios

# Build and sync only Android
npm run build:sync:android
```

### Running on Devices/Emulators

#### Android

**On Windows:**
1. Open Android Studio
2. Open the `android` folder in this project
3. Wait for Gradle sync to complete
4. Run on emulator: `npx cap run android`
5. Or open in Android Studio and click "Run"

**On Mac:**
1. Same as Windows, or use command line:
   ```sh
   npx cap open android  # Opens in Android Studio
   npx cap run android   # Runs on connected device/emulator
   ```

#### iOS (Mac only)

**On Mac:**
1. Open Xcode:
   ```sh
   npx cap open ios
   ```

2. In Xcode:
   - Select your target device/simulator
   - Click the play button to build and run

3. Or run directly:
   ```sh
   npx cap run ios
   ```

### Platform-Specific Notes

#### Windows
- Android development works perfectly
- iOS development requires a Mac (you can develop iOS apps on Windows, but building requires macOS)
- Use PowerShell or Command Prompt for all commands

#### Mac
- Full support for both iOS and Android development
- Use Terminal for all commands
- Xcode is required for iOS development

### Troubleshooting

#### Common Issues

1. **Build fails**: Make sure you've run `npm run build:sync` before opening native IDEs

2. **Android Studio issues**:
   - Ensure JDK is properly installed and JAVA_HOME is set
   - Try `File > Invalidate Caches / Restart` in Android Studio

3. **iOS build issues**:
   - Ensure Xcode is updated
   - Run `sudo xcodebuild -license accept` if prompted
   - Clean build folder in Xcode: `Product > Clean Build Folder`

4. **Sync issues**:
   - Delete `node_modules` and reinstall: `rm -rf node_modules && npm install`
   - Run `npx cap sync` after any dependency changes

#### Live Reload (Development)

For faster development with live reload:

1. Start the dev server: `npm run dev`
2. In another terminal: `npx cap run android` or `npx cap run ios`
3. Changes will hot-reload automatically

## Project Structure

- `src/` - SvelteKit application source
- `android/` - Android native project (generated)
- `ios/` - iOS native project (generated)
- `capacitor.config.ts` - Capacitor configuration

## Deployment

### Android
- Build APK/AAB in Android Studio
- Use Google Play Console for distribution

### iOS
- Build in Xcode
- Use App Store Connect for distribution
- Requires Apple Developer Program membership

## Contributing

1. Make changes to the SvelteKit app
2. Test on web: `npm run dev`
3. Build and sync: `npm run build:sync`
4. Test on mobile platforms
