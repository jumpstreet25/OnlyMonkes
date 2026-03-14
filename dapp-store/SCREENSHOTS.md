# Screenshots Needed for dApp Store

Place 4 screenshots in `assets/screenshots/` named:
- `screenshot_1.png`
- `screenshot_2.png`
- `screenshot_3.png`
- `screenshot_4.png`

## Required Dimensions
- Minimum: 320 × 568px
- Recommended: 1080 × 1920px (portrait, 9:16)
- Format: PNG or JPG

## Suggested Screens to Capture

1. **screenshot_1.png** — Main group chat with active conversation (messages, reactions, GIFs)
2. **screenshot_2.png** — AI Agent trading signal response (type `/ta $SOL` to trigger)
3. **screenshot_3.png** — Live Audio Room screen (start a room first)
4. **screenshot_4.png** — DM inbox or Community tab showing member list with NFT avatars

## How to Take Screenshots
1. Connect Seeker via USB
2. `adb shell screencap -p /sdcard/screen.png`
3. `adb pull /sdcard/screen.png dapp-store/assets/screenshots/screenshot_1.png`

Or just screenshot directly on device and AirDrop/transfer to Mac.

## Banner Image
`assets/banner.png` is currently the app header graphic (408 KB).
The dApp Store recommends a 1024×500px banner. Consider creating a proper one.
